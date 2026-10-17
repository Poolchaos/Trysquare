/**
 * Mode B: the review runs in your own terminal, not in a subprocess.
 *
 * The app writes the exact prompt for a stage to a file, prints the command
 * that starts a session you control on it, and then waits for the answer to
 * appear as a file beside it. That is the whole engine.
 *
 * It exists for the cases Mode A cannot serve: a model this machine's CLI
 * cannot spawn, an account whose limits are better spent interactively, or a
 * reviewer who wants to watch the reasoning rather than read a transcript
 * afterwards. What it must not become is a looser review. The prompt is
 * composed by the same code, the answer is validated by the same schema, and
 * the pipeline's reconciliation runs over it unchanged, so an answer that
 * skipped a hunk is refused here exactly as it would be there.
 *
 * Usage is recorded as zero rather than estimated. The tokens were spent in
 * someone else's session and this process has no honest way to count them; a
 * guess would corrupt the one number the user makes decisions with.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewStage } from "@/lib/domain/enums";
import type { EngineEvent } from "@/lib/engine/events";
import { composeSystemPrompt } from "@/lib/rulesets/compose";
import type { ImportedDirective, ImportedRule } from "@/lib/rulesets/model";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import { StageFailedError } from "@/server/engine/headless";
import { StageOutputUnreadableError } from "@/server/review/engine-runner";
import type { StageRequest, StageResponse } from "@/server/review/pipeline";
import type { ReviewEngine } from "./adapter";
import { MINIMUM_CLI_VERSION, resolveCli, type CliCommand } from "./cli";
import { aliasRefusal, isFullModelId } from "@/lib/models/model-id";
import { READ_ONLY_TOOLS } from "@/lib/engine/command";

export interface InteractiveEngineOptions {
  /** Where the prompt and answer files live: the review's bundle directory. */
  exchangeDir: string;
  /** The directory the person should run their session in. */
  worktreeRoot: string;
  model: string;
  directives: readonly ImportedDirective[];
  rules: readonly ImportedRule[];
  /** How long to wait for an answer before calling the stage failed. */
  timeoutMs: number;
  /** How often to look for the answer file. */
  pollMs?: number | undefined;
  /** The CLI the printed command runs; resolved as a review resolves it. */
  claudePath?: string | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((stage: ReviewStage, event: EngineEvent) => void) | undefined;
}

export interface ExchangeFiles {
  /** The document a person reads: instructions, question, where to reply. */
  prompt: string;
  /** The same instructions alone, for the session's system prompt. */
  system: string;
  answer: string;
}

/**
 * Names a call by the question it asks. S3 asks several questions under one
 * stage name, and named by stage alone the second batch overwrote the first's
 * prompt and read the first's answer straight back. Named by the question, a
 * different one never reads another's answer, and the same one asked again on
 * resume finds the answer a person saved after the first attempt timed out.
 */
export function callIdFor(request: {
  stage: ReviewStage;
  batchNumber?: number | undefined;
  systemPrompt: string;
  prompt: string;
}): string {
  return createHash("sha256")
    .update(
      [request.stage, String(request.batchNumber ?? ""), request.systemPrompt, request.prompt].join(
        "\0",
      ),
    )
    .digest("hex")
    .slice(0, 12);
}

/** One set of files per question, named by `callIdFor`. */
export function exchangeFilesFor(
  exchangeDir: string,
  stage: ReviewStage,
  batchNumber: number | undefined,
  callId: string,
): ExchangeFiles {
  const base = `${stage}${batchNumber === undefined ? "" : `-b${batchNumber}`}-${callId}`;
  return {
    prompt: join(exchangeDir, `${base}-prompt.md`),
    system: join(exchangeDir, `${base}-system.md`),
    answer: join(exchangeDir, `${base}-output.json`),
  };
}

/**
 * The file a person is asked to read.
 *
 * Everything the stage needs is in one document, in the order it is used: how
 * to run it, the rules it is judged against, the question, and the shape the
 * answer must take. A file that made someone assemble a prompt from three
 * places would be a worse contract than the subprocess it replaces.
 */
export function renderExchangeDocument(input: {
  stage: ReviewStage;
  systemPrompt: string;
  prompt: string;
  answerPath: string;
  worktreeRoot: string;
  model: string;
}): string {
  return [
    `# ${input.stage}`,
    "",
    "Run this stage in your own session, then save the answer as JSON to:",
    "",
    `    ${input.answerPath}`,
    "",
    `Work from \`${input.worktreeRoot}\`, which is a read-only checkout of the`,
    "commits under review. Do not edit anything in it: the review verifies its",
    "findings against those exact bytes.",
    "",
    "## Instructions",
    "",
    input.systemPrompt,
    "",
    "## The question",
    "",
    input.prompt,
    "",
  ].join("\n");
}

/**
 * The arguments that start a session on one call's files.
 *
 * The same isolation a headless stage gets: read-only tools, no settings or
 * MCP servers from the reviewed repository, the instructions as the system
 * prompt from a file. The prompt itself stays out of argv, where Windows caps
 * a command line at 32,767 characters; the session is told where to read it.
 * `--add-dir` lets it read the exchange directory, which is outside the
 * worktree, and `--` ends the options, since `--add-dir` and `--tools` take
 * every value that follows them.
 */
export function launchArgsFor(input: {
  model: string;
  exchangeDir: string;
  files: ExchangeFiles;
}): string[] {
  return [
    "--add-dir",
    input.exchangeDir,
    "--model",
    input.model,
    "--tools",
    READ_ONLY_TOOLS.join(","),
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--system-prompt-file",
    input.files.system,
    "--",
    `Read ${input.files.prompt} and answer the question in it exactly as it asks.`,
  ];
}

const posixQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
/**
 * PowerShell also ends a single-quoted string at the typographic quotes
 * U+2018 to U+201B, so each is doubled like the ASCII one (an apostrophe in
 * a name such as D'Angelo, typed on a phone, broke the command; measured).
 */
const powershellQuote = (value: string) =>
  `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;

/**
 * The command to paste, for both shells a person here is likely to have open.
 * Every value is single-quoted, the one form neither shell expands inside.
 */
export function launchCommandsFor(
  cli: CliCommand,
  worktreeRoot: string,
  args: readonly string[],
): { posix: string; powershell: string } {
  const argv = [cli.command, ...cli.prefixArgs, ...args];
  return {
    posix: `cd ${posixQuote(worktreeRoot)} && ${argv.map(posixQuote).join(" ")}`,
    powershell:
      `Set-Location -LiteralPath ${powershellQuote(worktreeRoot)}; ` +
      `& ${argv.map(powershellQuote).join(" ")}`,
  };
}

export function createInteractiveEngine(options: InteractiveEngineOptions): ReviewEngine {
  const pollMs = options.pollMs ?? 1000;

  const run = async (request: StageRequest): Promise<StageResponse> => {
    const schema = stageSchemaFor(request.stage);
    const systemPrompt =
      request.systemPrompt ||
      composeSystemPrompt({
        directives: options.directives,
        rules: options.rules,
        stage: request.stage,
        includeFullRules: request.stage === "s3_adversarial",
        outputContract: outputContractFor(schema),
      });

    // Mode B starts nothing itself: a person runs the printed command. So the
    // CLI is looked up, which reads the filesystem, and not run, which would
    // be a spawn; when none is found the command names `claude` and the
    // person's own PATH decides.
    let cli: CliCommand;
    try {
      cli = resolveCli(options.claudePath);
    } catch {
      cli = { command: "claude", prefixArgs: [], display: "claude" };
    }

    // The same refusal a headless stage makes: a review stored before review
    // creation checked aliases must not hand a person `--model opus`.
    if (!isFullModelId(options.model)) {
      throw new StageFailedError(
        "spawn",
        `Refused to start the stage: ${aliasRefusal(options.model)}`,
      );
    }

    await mkdir(options.exchangeDir, { recursive: true });
    const files = exchangeFilesFor(
      options.exchangeDir,
      request.stage,
      request.batchNumber,
      callIdFor({ ...request, systemPrompt }),
    );
    const promptPath = files.prompt;
    const answerPath = files.answer;

    await writeWhole(files.system, systemPrompt);
    await writeWhole(
      promptPath,
      renderExchangeDocument({
        stage: request.stage,
        systemPrompt,
        prompt: request.prompt,
        answerPath,
        worktreeRoot: options.worktreeRoot,
        model: options.model,
      }),
    );

    // The only way a person learns what to do next, so it goes through the
    // same channel as the engine's own progress and lands in the activity
    // feed rather than in a log nobody has open.
    const commands = launchCommandsFor(
      cli,
      options.worktreeRoot,
      launchArgsFor({ model: options.model, exchangeDir: options.exchangeDir, files }),
    );
    options.onEvent?.(request.stage, {
      kind: "text",
      text:
        `${request.stage} is waiting for you. In PowerShell:\n${commands.powershell}\n` +
        `In bash or zsh:\n${commands.posix}\n` +
        `then save the JSON answer to ${answerPath}. The command needs Claude Code ` +
        `${MINIMUM_CLI_VERSION} or newer, for --system-prompt-file.`,
    });

    const raw = await waitForAnswer(answerPath, {
      timeoutMs: options.timeoutMs,
      pollMs,
      stage: request.stage,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    // An answer that is refused is moved aside, or the same question asked
    // again on resume would read it back and fail the same way for ever.
    const setAside = async () => {
      await rename(
        answerPath,
        answerPath.replace(/-output\.json$/, `-output.rejected-${Date.now()}.json`),
      );
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await setAside();
      throw new StageOutputUnreadableError(
        request.stage,
        error instanceof Error ? error.message : String(error),
        raw.slice(0, 200),
      );
    }

    // Validated here as well as in the pipeline, so the failure names the file
    // a person just wrote rather than surfacing later as a pipeline complaint
    // about an answer they cannot see.
    const checked = schema.safeParse(parsed);
    if (!checked.success) {
      await setAside();
      throw new StageOutputUnreadableError(
        request.stage,
        `${answerPath} did not match the ${request.stage} schema: ` +
          `${checked.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`,
        raw.slice(0, 200),
      );
    }

    return {
      output: checked.data,
      // No session of ours: the conversation belongs to the person running it.
      sessionId: "",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        costEquivalentUsd: 0,
      },
    };
  };

  return { mode: "interactive", run, chainSessionId: () => undefined };
}

/**
 * Writes a file under a temporary name and renames it into place, so whoever
 * is watching for it never opens it half written. A prompt read while it was
 * still being written lost the candidate labels its answer must quote back
 * (Windows CI, run 39014903213).
 */
async function writeWhole(path: string, text: string): Promise<void> {
  const partial = `${path}.writing-${process.pid}`;
  await writeFile(partial, text, "utf8");
  await rename(partial, path);
}

/**
 * Waits for the answer file, and gives up rather than waiting forever.
 *
 * A hang is a failure, not a wait (01 section 6). The timeout is the same
 * stage timeout Mode A uses, which is generous for a person but finite, and
 * cancelling the review stops the wait immediately rather than after it.
 */
async function waitForAnswer(
  path: string,
  options: { timeoutMs: number; pollMs: number; stage: ReviewStage; signal?: AbortSignal },
): Promise<string> {
  const deadline = Date.now() + options.timeoutMs;
  let lastSeen: string | undefined;

  for (;;) {
    if (options.signal?.aborted) {
      throw new StageFailedError("cancelled", "The stage was cancelled.");
    }

    try {
      const contents = await readFile(path, "utf8");
      // A file caught mid-write is empty or truncated, and reading it as an
      // answer would fail the stage over the reader's timing rather than the
      // writer's content. So an answer counts once two reads a poll apart
      // agree: a person's editor may save in more than one write.
      if (contents.trim() !== "") {
        if (contents === lastSeen) return contents;
        lastSeen = contents;
      }
    } catch {
      // Not written yet, which is the normal case for most of this loop.
    }

    if (Date.now() >= deadline) {
      throw new StageFailedError(
        "timeout",
        `No answer appeared at ${path} within ${Math.round(options.timeoutMs / 60_000)} minutes. ` +
          `Save the answer there and resume the review: the same question is asked from the ` +
          `same files, so it is read at once.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

/**
 * Mode B: the review runs in your own terminal, not in a subprocess.
 *
 * The app writes the exact prompt for a stage to a file, prints the one-line
 * command that feeds it to a session you control, and then waits for the
 * answer to appear as a file beside it. That is the whole engine.
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

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  signal?: AbortSignal | undefined;
  onEvent?: ((stage: ReviewStage, event: EngineEvent) => void) | undefined;
}

export function promptPathFor(exchangeDir: string, stage: ReviewStage): string {
  return join(exchangeDir, `${stage}-prompt.md`);
}

export function answerPathFor(exchangeDir: string, stage: ReviewStage): string {
  return join(exchangeDir, `${stage}-output.json`);
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

/** The command that starts a session on this stage's prompt. */
export function launchCommandFor(promptPath: string, model: string, worktreeRoot: string): string {
  return `cd ${JSON.stringify(worktreeRoot)} && claude --model ${model} "$(cat ${JSON.stringify(promptPath)})"`;
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

    await mkdir(options.exchangeDir, { recursive: true });
    const promptPath = promptPathFor(options.exchangeDir, request.stage);
    const answerPath = answerPathFor(options.exchangeDir, request.stage);

    await writeFile(
      promptPath,
      renderExchangeDocument({
        stage: request.stage,
        systemPrompt,
        prompt: request.prompt,
        answerPath,
        worktreeRoot: options.worktreeRoot,
        model: options.model,
      }),
      "utf8",
    );

    // The only way a person learns what to do next, so it goes through the
    // same channel as the engine's own progress and lands in the activity
    // feed rather than in a log nobody has open.
    options.onEvent?.(request.stage, {
      kind: "text",
      text:
        `${request.stage} is waiting for you. Run:\n` +
        `${launchCommandFor(promptPath, options.model, options.worktreeRoot)}\n` +
        `then save the JSON answer to ${answerPath}`,
    });

    const raw = await waitForAnswer(answerPath, {
      timeoutMs: options.timeoutMs,
      pollMs,
      stage: request.stage,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
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

  for (;;) {
    if (options.signal?.aborted) {
      throw new StageFailedError("cancelled", "The stage was cancelled.");
    }

    try {
      const contents = await readFile(path, "utf8");
      // A file caught mid-write is empty or truncated, and reading it as an
      // answer would fail the stage over the reader's timing rather than the
      // writer's content.
      if (contents.trim() !== "") return contents;
    } catch {
      // Not written yet, which is the normal case for most of this loop.
    }

    if (Date.now() >= deadline) {
      throw new StageFailedError(
        "timeout",
        `No answer appeared at ${path} within ${Math.round(options.timeoutMs / 60_000)} minutes. ` +
          `The ${options.stage} stage is still waiting for one; resuming the review picks up ` +
          `where it stopped.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

/**
 * The headless engine: runs a review stage by spawning the Claude Code CLI.
 *
 * Subprocess hygiene mirrors verify.sh's doctrine, for the same reason: a
 * process that prints an error and exits zero, or that hangs, must be a
 * failure rather than something the pipeline shrugs at.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { StageErrorClass } from "@/lib/domain/enums";
import { buildChildEnv, buildStageArgs, type StageCommandOptions } from "@/lib/engine/command";
import type { EngineEvent, ResultEvent } from "@/lib/engine/events";
import { StreamDecoder } from "./stream";

export class StageFailedError extends Error {
  constructor(
    readonly errorClass: StageErrorClass,
    message: string,
    readonly detail: { exitCode?: number | null; stderr?: string; logPath?: string } = {},
  ) {
    super(message);
    this.name = "StageFailedError";
  }
}

export interface StageRunOptions extends StageCommandOptions {
  /** Working directory: the review worktree, or its parent for a linked review. */
  cwd: string;
  timeoutMs: number;
  /** Transcript destination. Written as it arrives so a crash keeps evidence. */
  logPath: string;
  /** Path to the CLI, overridable so tests can substitute a fake. */
  claudePath?: string;
  signal?: AbortSignal;
  onEvent?: (event: EngineEvent) => void;
}

export interface StageOutcome {
  result: ResultEvent;
  sessionId: string;
  /** The toolset the CLI reported, so the read-only claim is verifiable. */
  toolsGranted: string[];
  rateLimit?: { status: string; resetsAt?: number; limitType?: string };
  /** Set when the transcript could not be written. The run still stands. */
  transcriptError?: string;
}

/** Messages the CLI produces when usage limits stop a run. */
const LIMIT_MARKERS = [
  /rate limit/i,
  /usage limit/i,
  /limit reached/i,
  /quota/i,
  /too many requests/i,
];

/** Runtime failures that can accompany a zero exit code. */
const RUNTIME_ERROR_MARKERS = [
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find module/,
  /Unhandled [Rr]ejection/,
  /FATAL ERROR/,
];

export function classifyFailure(stderr: string, exitCode: number | null): StageErrorClass {
  if (LIMIT_MARKERS.some((pattern) => pattern.test(stderr))) return "limit";
  if (RUNTIME_ERROR_MARKERS.some((pattern) => pattern.test(stderr))) return "spawn";
  if (exitCode === null) return "spawn";
  return "unknown";
}

export async function runStage(options: StageRunOptions): Promise<StageOutcome> {
  const args = buildStageArgs(options);
  const command = options.claudePath ?? "claude";

  await mkdir(dirname(options.logPath), { recursive: true });
  const log = createWriteStream(options.logPath, { flags: "a" });

  // A write stream opens asynchronously and can fail at any point: the disk
  // fills, the path is not writable, the directory disappears. Without a
  // handler that becomes an uncaught exception, which would take down the
  // server rather than failing one stage. The transcript is evidence, not the
  // review itself, so losing it is reported and does not abort the run.
  let logError: Error | null = null;
  log.on("error", (error: Error) => {
    logError = error;
  });

  log.write(`# ${command} ${args.map((a) => JSON.stringify(a)).join(" ")}\n# cwd=${options.cwd}\n`);

  return new Promise<StageOutcome>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      // Session markers are removed here; without that the CLI refuses to run
      // when the app was started from a Claude Code terminal.
      env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"] as const,
      windowsHide: true,
    });

    const decoder = new StreamDecoder();
    let stderr = "";
    let result: ResultEvent | null = null;
    let sessionId = "";
    let toolsGranted: string[] = [];
    let rateLimit: StageOutcome["rateLimit"];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.end();
      fn();
    };

    // A hang is a failure, not something to wait out.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new StageFailedError(
            "timeout",
            `The stage produced no result within ${Math.round(options.timeoutMs / 1000)}s and was stopped.`,
            { logPath: options.logPath },
          ),
        ),
      );
    }, options.timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      finish(() =>
        reject(
          new StageFailedError("cancelled", "The stage was cancelled.", {
            logPath: options.logPath,
          }),
        ),
      );
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const handle = (event: EngineEvent) => {
      switch (event.kind) {
        case "init":
          sessionId = event.sessionId;
          toolsGranted = event.tools;
          break;
        case "rate-limit":
          rateLimit = {
            status: event.status,
            ...(event.resetsAt === undefined ? {} : { resetsAt: event.resetsAt }),
            ...(event.limitType === undefined ? {} : { limitType: event.limitType }),
          };
          break;
        case "result":
          result = event.result;
          sessionId ||= event.result.session_id;
          break;
        default:
          break;
      }
      options.onEvent?.(event);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      log.write(chunk);
      for (const event of decoder.push(chunk)) handle(event);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      log.write(chunk);
    });

    child.on("error", (error) => {
      finish(() =>
        reject(
          new StageFailedError("spawn", `Could not start "${command}": ${error.message}`, {
            logPath: options.logPath,
          }),
        ),
      );
    });

    child.on("close", (code) => {
      for (const event of decoder.flush()) handle(event);
      options.signal?.removeEventListener("abort", onAbort);

      finish(() => {
        const malformed = decoder.malformedLines();
        if (malformed.length > 0) {
          reject(
            new StageFailedError(
              "invalid_output",
              `The CLI emitted ${malformed.length} line(s) that were not valid JSON, ` +
                `so the transcript has a hole and cannot be trusted.`,
              { exitCode: code, stderr, logPath: options.logPath },
            ),
          );
          return;
        }

        if (!result) {
          // No result event means the run did not finish, whatever the exit
          // code says. Exiting zero without a result is still a failure.
          const errorClass = classifyFailure(stderr, code);
          reject(
            new StageFailedError(
              errorClass,
              errorClass === "limit"
                ? `The run stopped at a usage limit: ${stderr.trim() || "no detail given"}`
                : `The CLI exited with code ${code} before producing a result. ${stderr.trim()}`,
              { exitCode: code, stderr, logPath: options.logPath },
            ),
          );
          return;
        }

        if (result.is_error) {
          const errorClass = classifyFailure(`${stderr} ${result.result ?? ""}`, code);
          reject(
            new StageFailedError(
              errorClass,
              `The run reported an error: ${result.result ?? result.subtype}`,
              { exitCode: code, stderr, logPath: options.logPath },
            ),
          );
          return;
        }

        resolve({
          result,
          sessionId,
          toolsGranted,
          ...(rateLimit === undefined ? {} : { rateLimit }),
          ...(logError === null ? {} : { transcriptError: (logError as Error).message }),
        });
      });
    });
  });
}

/**
 * Fails if the CLI granted a tool the stage did not ask for.
 *
 * The init event reports the effective toolset, so "the model could only
 * read" is a checkable claim rather than a promise made by a flag.
 */
export function assertToolsAreReadOnly(
  granted: readonly string[],
  allowed: readonly string[],
): void {
  const unexpected = granted.filter((tool) => !allowed.includes(tool));
  if (unexpected.length > 0) {
    throw new StageFailedError(
      "invalid_output",
      `The CLI granted tools this stage did not allow: ${unexpected.join(", ")}. ` +
        `A review stage must be able to read and nothing else.`,
    );
  }
}

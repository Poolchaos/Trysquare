/**
 * The stage runner that drives the real CLI.
 *
 * Sits between the pipeline, which knows what a stage means, and the engine,
 * which knows how to run one. Its jobs are to compose the prompt, get a JSON
 * object back out of a text answer, keep the session strategy honest, and
 * check the read-only claim on every call rather than once at the start.
 */

import { join } from "node:path";
import type { z } from "zod";
import type { ReviewStage } from "@/lib/domain/enums";
import { READ_ONLY_TOOLS } from "@/lib/engine/command";
import type { EngineEvent } from "@/lib/engine/events";
import { usageOf } from "@/lib/engine/events";
import { composeSystemPrompt } from "@/lib/rulesets/compose";
import type { ImportedDirective, ImportedRule } from "@/lib/rulesets/model";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import type { ReviewEngine } from "@/server/engine/adapter";
import { assertToolsAreReadOnly, runStage } from "@/server/engine/headless";
import type { StageRequest, StageResponse } from "./pipeline";

export class StageOutputUnreadableError extends Error {
  constructor(
    readonly stage: ReviewStage,
    readonly detail: string,
    readonly rawExcerpt: string,
  ) {
    super(
      `The ${stage} stage did not return a JSON object (${detail}). ` +
        `A stage answer that cannot be read is a failed stage, not an empty result. ` +
        `First 200 characters of what came back: ${rawExcerpt}`,
    );
    this.name = "StageOutputUnreadableError";
  }
}

/**
 * Pulls a single JSON object out of a model's text answer.
 *
 * Models wrap JSON in code fences, or preface it with a sentence, and both are
 * recoverable. What is not recoverable is anything else: this returns a
 * failure rather than a best guess, because a partially understood answer is
 * more dangerous than none.
 *
 * The scan tracks string state so a brace inside a string literal, which is
 * common in code excerpts and regex patterns, does not end the object early.
 */
export function extractJsonObject(
  text: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "the answer was empty" };

  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
  const candidates = fenced?.[1] ? [fenced[1], trimmed] : [trimmed];

  for (const candidate of candidates) {
    const slice = firstBalancedObject(candidate);
    if (slice === null) continue;
    try {
      return { ok: true, value: JSON.parse(slice) };
    } catch (error) {
      return {
        ok: false,
        reason: `the JSON did not parse: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  return { ok: false, reason: "no JSON object was found in the answer" };
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Stages that share one session.
 *
 * S1 to S4 build on each other: what the comprehension pass understood is
 * what the adversarial pass hunts through. S5 is deliberately excluded. It
 * runs fresh, with no access to the reasoning that produced the findings it
 * is asked to refute, because a verifier that can see the argument for a
 * finding is not an independent check on it.
 */
const CHAINED_STAGES: readonly ReviewStage[] = [
  "s1_risk",
  "s2_comprehension",
  "s3_adversarial",
  "s4_deletions",
];

export interface EngineRunnerOptions {
  worktreeRoot: string;
  logsDir: string;
  /** Full model id. Aliases resolve to a previous generation. */
  model: string;
  timeoutMs: number;
  /** How hard the model is asked to think. Unset leaves it to the CLI. */
  effort?: string | undefined;
  /** USD-equivalent ceiling per CLI call. Unset passes no flag. */
  maxBudgetUsd?: number | undefined;
  directives: readonly ImportedDirective[];
  rules: readonly ImportedRule[];
  claudePath?: string | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((stage: ReviewStage, event: EngineEvent) => void) | undefined;
  /** Called after every stage, so usage is recorded even if a later one fails. */
  onStageComplete?:
    | ((info: {
        stage: ReviewStage;
        sessionId: string;
        attempt: number;
        usage: {
          inputTokens: number;
          outputTokens: number;
          cacheCreationTokens: number;
          cacheReadTokens: number;
          costEquivalentUsd: number;
        };
      }) => void)
    | undefined;
}

export function createEngineRunner(options: EngineRunnerOptions): ReviewEngine {
  let chainSession: string | undefined;

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

    const isChained = CHAINED_STAGES.includes(request.stage);
    const resume = request.resumeSessionId ?? (isChained ? chainSession : undefined);

    const outcome = await runStage({
      prompt: request.prompt,
      systemPrompt,
      model: options.model,
      outputFormat: "stream-json",
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: options.maxBudgetUsd }),
      cwd: options.worktreeRoot,
      timeoutMs: options.timeoutMs,
      logPath: join(options.logsDir, `${request.stage}.log`),
      ...(options.claudePath === undefined ? {} : { claudePath: options.claudePath }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(resume === undefined ? {} : { resumeSessionId: resume }),
      ...(options.onEvent === undefined
        ? {}
        : { onEvent: (event: EngineEvent) => options.onEvent?.(request.stage, event) }),
    });

    // Checked on every call, not once: a session that gained a tool part way
    // through would otherwise pass unnoticed.
    assertToolsAreReadOnly(outcome.toolsGranted, READ_ONLY_TOOLS);

    if (isChained) chainSession = outcome.sessionId;

    const usage = usageOf(outcome.result);
    options.onStageComplete?.({
      stage: request.stage,
      sessionId: outcome.sessionId,
      attempt: 1,
      usage,
    });

    const extracted = extractJsonObject(outcome.result.result ?? "");
    if (extracted.ok && schema.safeParse(extracted.value).success) {
      return { output: extracted.value, sessionId: outcome.sessionId, usage };
    }

    // One repair round, and only one. Models routinely fix a shape when told
    // precisely what was wrong with it, so refusing to ask wastes the whole
    // stage over a missing field. Asking twice, on the other hand, is how a
    // stage quietly turns into an argument that burns the budget, so a second
    // failure is final.
    const complaint = extracted.ok
      ? describeSchemaFailure(schema, extracted.value)
      : `your answer was not a JSON object: ${extracted.reason}`;

    const repair = await runStage({
      prompt: [
        "Your previous answer could not be used.",
        "",
        complaint,
        "",
        "Send the corrected answer now: a single JSON object matching the schema",
        "you were given, and nothing else. Do not repeat the analysis, and do not",
        "change any judgement you already made; only fix the shape.",
      ].join("\n"),
      systemPrompt,
      model: options.model,
      outputFormat: "stream-json",
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: options.maxBudgetUsd }),
      cwd: options.worktreeRoot,
      timeoutMs: options.timeoutMs,
      logPath: join(options.logsDir, `${request.stage}.repair.log`),
      resumeSessionId: outcome.sessionId,
      ...(options.claudePath === undefined ? {} : { claudePath: options.claudePath }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onEvent === undefined
        ? {}
        : { onEvent: (event: EngineEvent) => options.onEvent?.(request.stage, event) }),
    });

    assertToolsAreReadOnly(repair.toolsGranted, READ_ONLY_TOOLS);
    if (isChained) chainSession = repair.sessionId;

    const repairUsage = usageOf(repair.result);
    options.onStageComplete?.({
      stage: request.stage,
      sessionId: repair.sessionId,
      attempt: 2,
      usage: repairUsage,
    });

    const repaired = extractJsonObject(repair.result.result ?? "");
    if (!repaired.ok) {
      throw new StageOutputUnreadableError(
        request.stage,
        `${extracted.ok ? "the shape was wrong" : extracted.reason}, and the repair also failed: ${repaired.reason}`,
        (repair.result.result ?? "").slice(0, 200),
      );
    }

    // The pipeline validates too. Returning here without checking would push
    // a still-wrong shape one layer down before it failed.
    const validated = schema.safeParse(repaired.value);
    if (!validated.success) {
      throw new StageOutputUnreadableError(
        request.stage,
        `the repaired answer still did not match the schema: ${summariseIssues(validated.error)}`,
        JSON.stringify(repaired.value).slice(0, 200),
      );
    }

    return {
      output: repaired.value,
      sessionId: repair.sessionId,
      usage: {
        inputTokens: usage.inputTokens + repairUsage.inputTokens,
        cacheCreationTokens: usage.cacheCreationTokens + repairUsage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens + repairUsage.cacheReadTokens,
        outputTokens: usage.outputTokens + repairUsage.outputTokens,
        costEquivalentUsd: usage.costEquivalentUsd + repairUsage.costEquivalentUsd,
      },
    };
  };

  return { mode: "headless", run, chainSessionId: () => chainSession };
}

function summariseIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Names exactly what was wrong, so the repair round has something to act on. */
function describeSchemaFailure(schema: z.ZodType, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (parsed.success) return "the answer was valid";
  return `your answer did not match the required schema: ${summariseIssues(parsed.error)}`;
}

/**
 * The shapes the Claude Code CLI emits on `--output-format stream-json`.
 *
 * Every schema here was derived from real CLI output captured on 2026-07-30
 * with Claude Code 2.1.71, not from documentation. They are deliberately
 * permissive about fields the app does not use (`.passthrough()`), because a
 * new field appearing upstream must not break a review, while the fields the
 * app does rely on are required so a change to those fails loudly instead of
 * silently producing undefined.
 */

import { z } from "zod";

/** Emitted once at startup. Reports the toolset actually in effect. */
export const systemInitSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
    cwd: z.string(),
    model: z.string(),
    tools: z.array(z.string()),
    permissionMode: z.string().optional(),
    claude_code_version: z.string().optional(),
    apiKeySource: z.string().optional(),
  })
  .passthrough();

const contentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    id: z.string().optional(),
  })
  .passthrough();

export const assistantEventSchema = z
  .object({
    type: z.literal("assistant"),
    session_id: z.string(),
    message: z
      .object({
        content: z.array(contentBlockSchema).default([]),
        model: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const userEventSchema = z
  .object({
    type: z.literal("user"),
    session_id: z.string(),
  })
  .passthrough();

/**
 * Live rate-limit state. This is how a review learns it is approaching a
 * limit before the run fails, and what the pause screen shows.
 */
export const rateLimitEventSchema = z
  .object({
    type: z.literal("rate_limit_event"),
    rate_limit_info: z
      .object({
        status: z.string(),
        /** Unix seconds. */
        resetsAt: z.number().optional(),
        rateLimitType: z.string().optional(),
        overageStatus: z.string().optional(),
        isUsingOverage: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const usageSchema = z
  .object({
    input_tokens: z.number().default(0),
    output_tokens: z.number().default(0),
    cache_creation_input_tokens: z.number().default(0),
    cache_read_input_tokens: z.number().default(0),
  })
  .passthrough();

const modelUsageEntrySchema = z
  .object({
    inputTokens: z.number().default(0),
    outputTokens: z.number().default(0),
    costUSD: z.number().default(0),
    contextWindow: z.number().optional(),
  })
  .passthrough();

/** The final event of a run. Its absence means the run did not finish. */
export const resultEventSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean(),
    session_id: z.string(),
    result: z.string().optional(),
    duration_ms: z.number().optional(),
    num_turns: z.number().optional(),
    total_cost_usd: z.number().default(0),
    usage: usageSchema.optional(),
    modelUsage: z.record(z.string(), modelUsageEntrySchema).optional(),
    permission_denials: z.array(z.object({ tool_name: z.string() }).passthrough()).default([]),
  })
  .passthrough();

export type SystemInitEvent = z.infer<typeof systemInitSchema>;
export type AssistantEvent = z.infer<typeof assistantEventSchema>;
export type RateLimitEvent = z.infer<typeof rateLimitEventSchema>;
export type ResultEvent = z.infer<typeof resultEventSchema>;

/** What the job manager consumes. Raw CLI events are narrowed into these. */
export type EngineEvent =
  | { kind: "init"; sessionId: string; model: string; tools: string[]; cwd: string }
  | { kind: "text"; text: string }
  | { kind: "tool-use"; tool: string; input: unknown }
  | { kind: "rate-limit"; status: string; resetsAt?: number; limitType?: string }
  | { kind: "result"; result: ResultEvent }
  | { kind: "unknown"; raw: unknown };

/**
 * Narrows one parsed CLI event into an EngineEvent.
 *
 * Unrecognised events become `unknown` rather than throwing: the CLI may add
 * event types, and a review must not fail because of one it has not seen.
 * The events the app depends on are validated strictly.
 */
export function toEngineEvent(raw: unknown): EngineEvent {
  if (typeof raw !== "object" || raw === null) return { kind: "unknown", raw };
  const type = (raw as { type?: unknown }).type;

  if (type === "system") {
    const parsed = systemInitSchema.safeParse(raw);
    if (parsed.success) {
      return {
        kind: "init",
        sessionId: parsed.data.session_id,
        model: parsed.data.model,
        tools: parsed.data.tools,
        cwd: parsed.data.cwd,
      };
    }
    return { kind: "unknown", raw };
  }

  if (type === "assistant") {
    const parsed = assistantEventSchema.safeParse(raw);
    if (!parsed.success) return { kind: "unknown", raw };
    for (const block of parsed.data.message.content) {
      // Thinking blocks are deliberately not surfaced: they are long, carry a
      // signature, and are not part of the review's output contract.
      if (block.type === "tool_use" && block.name) {
        return { kind: "tool-use", tool: block.name, input: block.input };
      }
      if (block.type === "text" && typeof block.text === "string") {
        return { kind: "text", text: block.text };
      }
    }
    return { kind: "unknown", raw };
  }

  if (type === "rate_limit_event") {
    const parsed = rateLimitEventSchema.safeParse(raw);
    if (!parsed.success) return { kind: "unknown", raw };
    const info = parsed.data.rate_limit_info;
    return {
      kind: "rate-limit",
      status: info.status,
      ...(info.resetsAt === undefined ? {} : { resetsAt: info.resetsAt }),
      ...(info.rateLimitType === undefined ? {} : { limitType: info.rateLimitType }),
    };
  }

  if (type === "result") {
    const parsed = resultEventSchema.safeParse(raw);
    if (!parsed.success) return { kind: "unknown", raw };
    return { kind: "result", result: parsed.data };
  }

  return { kind: "unknown", raw };
}

export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costEquivalentUsd: number;
}

export function usageOf(result: ResultEvent): StageUsage {
  return {
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    costEquivalentUsd: result.total_cost_usd,
  };
}

/** The context window the model actually reported, never assumed. */
export function contextWindowOf(result: ResultEvent): number | undefined {
  const entries = Object.values(result.modelUsage ?? {});
  return entries[0]?.contextWindow;
}

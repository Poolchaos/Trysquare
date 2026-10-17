/**
 * Whether a model runs at the effort a review asks for (4.7, D-122).
 *
 * The bundled CLI 2.1.301 runs xhigh as high on a model its own table does
 * not mark as supporting it, and says nothing, so a review asking for xhigh
 * there would record an effort it never had. These are the models that table
 * marks, read from the binary; any other is offered high and below. The other
 * tiers are left to the model, as they were before xhigh was offered.
 */

import type { ReviewEffort } from "@/lib/domain/enums";

const XHIGH_MODELS: ReadonlySet<string> = new Set([
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-opus-4-7",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
]);

/** The id without its context window, which does not change the model: `claude-fable-5[1m]`. */
function baseId(model: string): string {
  return model.trim().replace(/\[[^\]]*\]$/, "");
}

export function effortRunsOn(model: string, effort: ReviewEffort): boolean {
  return effort !== "xhigh" || XHIGH_MODELS.has(baseId(model));
}

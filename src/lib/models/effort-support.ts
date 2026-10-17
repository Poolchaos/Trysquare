/**
 * Whether a model runs at the effort a review asks for (4.7, D-122, corrected
 * by D-123).
 *
 * The bundled CLI 2.1.301 runs xhigh on every model but a fixed list of older
 * ones, and on those it sends high, or no effort at all, without a word, so a
 * review asking for xhigh there would record an effort it never had. The list
 * is the CLI's own check, read from the binary: claude-3 models, Opus 4.0 to
 * 4.6, Sonnet 4.0 to 4.6 and Haiku 4.5. Measured against a local stand-in for
 * the API: Fable, Opus and Sonnet 5 send xhigh; Opus 4.6 sends high; Sonnet
 * 4.5 sends none. The other tiers are left to the model, as they were before
 * xhigh was offered.
 */

import type { ReviewEffort } from "@/lib/domain/enums";

const NO_XHIGH: ReadonlySet<string> = new Set([
  "claude-opus-4",
  "claude-opus-4-0",
  "claude-opus-4-1",
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4",
  "claude-sonnet-4-0",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);

/**
 * The id without what does not change the model: its context window
 * (`claude-fable-5[1m]`) and a release date (`claude-haiku-4-5-20251001`).
 * Sonnet 4.0's dated id has no minor version, so `claude-sonnet-4` stands for
 * it in the list.
 */
function baseId(model: string): string {
  return model
    .trim()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "");
}

export function effortRunsOn(model: string, effort: ReviewEffort): boolean {
  if (effort !== "xhigh") return true;
  const id = baseId(model);
  return !id.includes("claude-3-") && !NO_XHIGH.has(id);
}

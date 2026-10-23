/**
 * Whether a model id names one model rather than a family.
 *
 * The CLI accepts an alias ("fable", "opus", "sonnet", per its own `--help`)
 * as "the latest model" of a family, and an alias has been observed to
 * resolve to a previous generation. So only an id that carries a version is
 * stored or passed on: `claude-` followed somewhere by a number, which fits
 * every id in the registry (`claude-fable-5[1m]`) and the older naming that
 * puts the version first (`claude-3-5-sonnet-<date>`). A rule that says what
 * an id must be, rather than a list of aliases, also refuses aliases nobody
 * has listed yet, such as `sonnet[1m]` or `claude-fable`. The number is
 * looked for before any context suffix: the 1 of `[1m]` let
 * `claude-opus[1m]` pass (D-181 item 3).
 */
import { z } from "zod";

const FULL_ID = /claude-[^\d]*\d/i;
const CONTEXT_SUFFIX = /\[[^\]]*\]$/;

export function isFullModelId(id: string): boolean {
  return FULL_ID.test(id.trim().replace(CONTEXT_SUFFIX, ""));
}

export function aliasRefusal(id: string): string {
  return (
    `"${id}" does not name a single model. Aliases resolve to whatever the CLI considers ` +
    `current for a family, which can be a previous generation. Use a full id such as ` +
    `"claude-fable-5[1m]".`
  );
}

/**
 * Candidates the app no longer offers, removed at start. Haiku could never
 * run a review (mechanical-only) and is not offered at all (D-184). Refused
 * by id at start too: with its row gone it resolves as an unregistered
 * model, which runs full-context.
 */
export const RETIRED_MODEL_IDS: readonly string[] = ["claude-haiku-4-5-20251001"];

function retiredRefusal(id: string): string {
  return (
    `${id} is no longer offered for reviews: it is not trusted to judge code. ` +
    `Pick a model probed for review work.`
  );
}

/** The model a review's start or pre-flight names. */
export const reviewModelSchema = z
  .string()
  .min(1)
  .superRefine((model, context) => {
    if (!isFullModelId(model)) context.addIssue({ code: "custom", message: aliasRefusal(model) });
    else if (RETIRED_MODEL_IDS.includes(model))
      context.addIssue({ code: "custom", message: retiredRefusal(model) });
  });

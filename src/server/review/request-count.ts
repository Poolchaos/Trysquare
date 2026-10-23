/**
 * Counts the requests a review will make before it is started, by the rules
 * the run itself divides its work by: the profile's rule batches, each fitted
 * to the window by `fitBatch` against its own system prompt and its own
 * files' prompt, exactly as the pipeline fits them (WP-F).
 *
 * Beside `content.ts` because it renders the adversarial prompt to size it.
 * Pure: nothing is read or written.
 */

import type { ReviewProfile } from "@/lib/domain/enums";
import { estimateTokens, fitBatch } from "@/lib/review/budget";
import { planRequests, type RequestPlan } from "@/lib/review/request-plan";
import { planRuleBatches } from "@/lib/rulesets/compose";
import type { ImportedRule } from "@/lib/rulesets/model";
import { renderAdversarialPrompt, type StageContentInput } from "./content";

export function countRequests(input: {
  /** As the run builds it, sweep hits under their qualified paths. */
  content: StageContentInput;
  /** Qualified paths, as the ledger holds them. */
  files: readonly string[];
  rules: readonly ImportedRule[];
  profile: ReviewProfile;
  contextWindow: number | undefined;
  /** S3's system prompt for a batch's rules, composed as the run composes it. */
  systemPromptFor: (rules: readonly ImportedRule[]) => string;
}): RequestPlan {
  const plan = planRuleBatches(input.rules, input.files, input.profile);
  const sizes = new Map<string, number>();
  const promptTokens = (files: readonly string[]) => {
    const key = files.join("\0");
    let size = sizes.get(key);
    if (size === undefined) {
      size = estimateTokens(renderAdversarialPrompt(input.content, { files }));
      sizes.set(key, size);
    }
    return size;
  };

  let groups = 0;
  let split = false;
  for (const batch of plan.batches) {
    const fit = fitBatch(
      batch.files,
      estimateTokens(input.systemPromptFor(batch.rules)),
      promptTokens,
      input.contextWindow,
    );
    groups += fit.groups.length;
    if (fit.kind === "split") split = true;
  }
  return planRequests({ passes: plan.batches.length, groups, split });
}

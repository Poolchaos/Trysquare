/**
 * The requests a review makes, by stage (proof-and-steps plan, WP-F).
 *
 * Every stage that asks a model asks once, S4 and S5 even with nothing to
 * ask about, but S3, whose rule batches may each be split to fit the window.
 * S6 is app code. The second verifier's request is made only when S5 proves
 * a finding, so its one is the most it makes. Any request can need one more
 * if its answer comes back in the wrong shape, which no count can know.
 */

import type { ReviewStage } from "@/lib/domain/enums";

/** Every stage that asks a model. */
export type ModelStage = Exclude<ReviewStage, "s6_audit">;

export interface RequestPlan {
  byStage: Record<ModelStage, number>;
  /** S3's rule batches, before any is split to fit the window. */
  passes: number;
  total: number;
  /** A batch was split to fit the window, so the S3 count is an estimate. */
  split: boolean;
}

export function planRequests(s3: { passes: number; groups: number; split: boolean }): RequestPlan {
  const byStage: Record<ModelStage, number> = {
    s1_risk: 1,
    s2_comprehension: 1,
    s3_adversarial: s3.groups,
    s4_deletions: 1,
    s5_verification: 1,
    s5b_second_verification: 1,
  };
  const total = Object.values(byStage).reduce((sum, count) => sum + count, 0);
  return { byStage, passes: s3.passes, total, split: s3.split };
}

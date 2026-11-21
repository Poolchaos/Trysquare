/**
 * Which reviews the dashboard's Needs you lists, and what each row says.
 *
 * It listed the reviews awaiting a decision and said nothing was waiting
 * over one stopped at the usage limit. A paused, interrupted or failed
 * review goes on only when a person presses Resume, so it is listed too,
 * each row saying which it is (D-259).
 */

import { RESUMABLE_REVIEW_STATUSES } from "@/lib/domain/state-machines";

export const NEEDS_YOU_STATUSES = ["awaiting_confirmation", ...RESUMABLE_REVIEW_STATUSES] as const;
export type NeedsYouStatus = (typeof NEEDS_YOU_STATUSES)[number];

export function needsAPerson(status: string): status is NeedsYouStatus {
  return (NEEDS_YOU_STATUSES as readonly string[]).includes(status);
}

export function needsYouLine(row: {
  status: NeedsYouStatus;
  decided: number;
  total: number;
}): string {
  switch (row.status) {
    case "awaiting_confirmation":
      return row.total > 0 ? `${row.decided} of ${row.total} decided` : "no findings";
    // Not "Resume to go on": pressed before the limit clears, it pauses again.
    // A colon, which stays with the words before it where a phone wraps the
    // line: a dot between the halves began the second one.
    case "paused_limit":
      return "paused at the usage limit: Resume once it clears";
    case "interrupted":
      return "interrupted: Resume to go on";
    case "failed":
      return "failed: Resume to go on";
  }
}

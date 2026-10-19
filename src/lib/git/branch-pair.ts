/**
 * Two branches to compare, never one against itself: the change is empty,
 * and a review of nothing reads exactly like a review that found nothing
 * wrong. The new review screen keeps both pairs apart, and the routes refuse
 * either pair the screen did not (D-144).
 */
export function apart(pair: { fromBranch: string; intoBranch: string }): boolean {
  return pair.fromBranch !== pair.intoBranch;
}

export const COMPARED_WITH_ITSELF = {
  path: ["intoBranch"],
  message: "is the branch under review: compared against itself the change is empty",
};

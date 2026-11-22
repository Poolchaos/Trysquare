/** Everything the home screen states, counted from what this machine ran. */

import { isMine } from "@/lib/settings/identities";
import { readScoreboard } from "@/server/db/repositories/scoreboard";
import { identitiesInEffect } from "@/server/identities";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const board = readScoreboard(db);
    // Whose branch each recent review was of, by the emails a branch list
    // goes by (D-69, D-297). Asked only when a review holds an author. A git
    // config that cannot be read is said in git's words with the board, not
    // in place of it: the home screen needs git for nothing else.
    let identities: string[] = [];
    let identitiesProblem: string | null = null;
    if (board.recent.some((row) => row.author !== null)) {
      try {
        identities = await identitiesInEffect(db);
      } catch (error) {
        identitiesProblem = error instanceof Error ? error.message : String(error);
      }
    }
    return ok({
      ...board,
      recent: board.recent.map((row) => ({
        ...row,
        mine: row.author !== null && isMine(row.author.email, identities),
      })),
      identitiesProblem,
    });
  });
}

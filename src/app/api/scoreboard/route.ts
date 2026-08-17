/** Everything the home screen states, counted from what this machine ran. */

import { readScoreboard } from "@/server/db/repositories/scoreboard";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    return ok(readScoreboard(db));
  });
}

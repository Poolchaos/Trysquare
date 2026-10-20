/**
 * Which CLI reviews run through, its version, and whether it is signed in
 * and to what.
 *
 * Worth surfacing because the difference is money: an API-key login bills per
 * token, and someone who set one up for something else would otherwise not
 * find out until a bill arrived. Runs `claude --version` and `claude auth
 * status` locally and spends nothing.
 */

import { readCliStatus } from "@/server/engine/probe";
import { handler, ok } from "@/server/api/respond";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const claudePath = process.env.TRYSQUARE_CLAUDE_PATH;
    return ok({
      cli: await readCliStatus(claudePath === undefined ? {} : { claudePath }),
    });
  });
}

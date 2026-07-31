/**
 * Whether the CLI is logged in, and whether runs draw on a subscription.
 *
 * Worth surfacing because the difference is money: an API-key login bills per
 * token, and someone who set one up for something else would otherwise not
 * find out until a bill arrived. Runs `claude auth status` locally and spends
 * nothing.
 */

import { readAuthStatus } from "@/server/engine/probe";
import { handler, ok } from "@/server/api/respond";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const claudePath = process.env.TRYSQUARE_CLAUDE_PATH;
    return ok({
      auth: await readAuthStatus(claudePath === undefined ? {} : { claudePath }),
    });
  });
}

/**
 * Which CLI reviews run through, its version, and whether it is signed in
 * and to what, with the command that signs it in.
 *
 * Worth surfacing because the difference is money: an API-key login bills per
 * token, and someone who set one up for something else would otherwise not
 * find out until a bill arrived. Runs `claude --version` and `claude auth
 * status` locally and spends nothing.
 *
 * As every review sees it, headless or interactive, each reading no settings
 * (D-174).
 */

import { handler, ok } from "@/server/api/respond";
import { cliReadiness } from "@/server/cli-readiness";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { cli, signIn } = await cliReadiness(runtime().db);
    // The sign-in command is shown when it is signed out, for the person to
    // run; never run here (MVP 6.3, D-159).
    return ok({ cli, signIn });
  });
}

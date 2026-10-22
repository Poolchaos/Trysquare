/**
 * Which CLI reviews run through, its version, and whether it is signed in
 * and to what, with the command that signs it in.
 *
 * Worth surfacing because the difference is money: an API-key login bills per
 * token, and someone who set one up for something else would otherwise not
 * find out until a bill arrived. Runs `claude --version` and `claude auth
 * status` locally and spends nothing.
 *
 * As a headless review sees it, or with `?reader=interactive` as an
 * interactive review's commands, run in the person's terminal, see it: they
 * read the person's user settings, and a review here reads none (D-169).
 */

import { handler, ok } from "@/server/api/respond";
import { cliReadiness } from "@/server/cli-readiness";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(request?: Request): Promise<Response> {
  return handler(async () => {
    const reader =
      request !== undefined && new URL(request.url).searchParams.get("reader") === "interactive"
        ? "interactive"
        : "headless";
    const { cli, signIn } = await cliReadiness(runtime().db, reader);
    // The sign-in command is shown when it is signed out, for the person to
    // run; never run here (MVP 6.3, D-159).
    return ok({ cli, signIn });
  });
}

/**
 * A project's own checks: its tests and e2e, run on a throwaway copy of the
 * branch under review once a person turns them on (WP-I, D-191, D-192).
 */

import { projectChecksSchema } from "@/lib/projects/checks";
import { getProjectChecks, setProjectChecks } from "@/server/db/repositories/project-checks";
import { requireProject } from "@/server/db/repositories/projects";
import { handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    requireProject(db, id);
    return ok({ checks: getProjectChecks(db, id) });
  });
}

/** The whole set at once, so what is stored is always one that was checked whole. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    requireProject(db, id);
    setProjectChecks(db, id, await readJson(request, projectChecksSchema));
    return ok({ checks: getProjectChecks(db, id) });
  });
}

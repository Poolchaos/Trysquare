/** Removing a dependency link. Reviews already run keep their linked history. */

import { requireProject, unlinkDependency } from "@/server/db/repositories/projects";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; linkId: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id, linkId } = await context.params;
    requireProject(db, id);
    unlinkDependency(db, id, linkId);
    return ok({ removed: linkId });
  });
}

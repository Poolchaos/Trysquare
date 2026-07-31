/** One project, with its dependency links and its reviews. */

import { listDependencyLinks, requireProject } from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    return ok({
      project: requireProject(db, id),
      links: listDependencyLinks(db, id),
      reviews: listReviewsForProject(db, id),
    });
  });
}

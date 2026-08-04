/**
 * Where this app keeps things, and how much of it there is.
 *
 * The data directory is the answer to "where did my reviews go": everything
 * this app owns lives under it, so the screen names the real path rather than
 * leaving someone to guess at a default that an environment variable may have
 * moved.
 */

import { exportsDir } from "@/lib/paths";
import { listProjects } from "@/server/db/repositories/projects";
import { listActiveReviews, listReviewsForProject } from "@/server/db/repositories/reviews";
import { listRulesets } from "@/server/db/repositories/rulesets";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const projects = listProjects(db);

    return ok({
      dataDir,
      exportsDir: exportsDir(dataDir),
      counts: {
        projects: projects.length,
        reviews: projects.reduce(
          (total, project) => total + listReviewsForProject(db, project.id).length,
          0,
        ),
        rulesets: listRulesets(db).length,
      },
      running: listActiveReviews(db).length,
    });
  });
}

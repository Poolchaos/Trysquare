/**
 * Creating a review, and listing them.
 *
 * Creating one is where the commits are pinned, so it fetches first and then
 * resolves the tips from the refs that fetch produced (D-27). A stale pin is
 * the worst failure this app can have: the run completes, the report reads as
 * authoritative, and it describes code the branch has already moved past. A
 * fetch that fails therefore blocks creation rather than falling back.
 */

import { z } from "zod";
import { reviewEffortSchema, reviewProfileSchema } from "@/lib/domain/enums";
import {
  listDependencyLinks,
  recordFetch,
  requireProject,
} from "@/server/db/repositories/projects";
import { createReview, listActiveReviews } from "@/server/db/repositories/reviews";
import { fetchAll, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { created, handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";
import { listProjects } from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";

export const dynamic = "force-dynamic";

const body = z.object({
  projectId: z.string().min(1),
  fromBranch: z.string().min(1),
  intoBranch: z.string().min(1),
  model: z.string().min(1),
  profileId: reviewProfileSchema.default("full-context"),
  effort: reviewEffortSchema.default("high"),
  intent: z.string().optional(),
  linked: z
    .object({
      projectId: z.string().min(1),
      fromBranch: z.string().min(1),
      intoBranch: z.string().min(1),
    })
    .optional(),
});

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const reviews = listProjects(db).flatMap((project) =>
      listReviewsForProject(db, project.id).map((review) => ({
        ...review,
        projectName: project.name,
      })),
    );
    reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok({ reviews, active: listActiveReviews(db).map((review) => review.id) });
  });
}

export function POST(request: Request): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const input = await readJson(request, body);
    const project = requireProject(db, input.projectId);

    // Fetched immediately before pinning, so the commits recorded are the tips
    // the remote has now rather than whatever the last clone left behind.
    await fetchAll(project.clonePath);
    recordFetch(db, project.id);
    const pins = await pin(project.clonePath, input.fromBranch, input.intoBranch);

    let linked;
    if (input.linked) {
      const dependency = requireProject(db, input.linked.projectId);
      const isLinked = listDependencyLinks(db, project.id).some(
        (link) => link.dependencyProjectId === dependency.id,
      );
      if (!isLinked) {
        throw Response.json(
          {
            error: `${dependency.name} is not a dependency of ${project.name}.`,
            code: "NotLinked",
          },
          { status: 400 },
        );
      }
      // Both sides fetched before either is pinned, so the pair describes one
      // moment rather than two.
      await fetchAll(dependency.clonePath);
      recordFetch(db, dependency.id);
      linked = {
        ...input.linked,
        projectId: dependency.id,
        ...(await pin(dependency.clonePath, input.linked.fromBranch, input.linked.intoBranch)),
      };
    }

    const review = createReview(db, {
      projectId: project.id,
      fromBranch: input.fromBranch,
      intoBranch: input.intoBranch,
      ...pins,
      model: input.model,
      profileId: input.profileId,
      engineMode: "headless",
      effort: input.effort,
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(linked === undefined ? {} : { linked }),
    });

    return created({ review });
  });
}

async function pin(repoDir: string, fromBranch: string, intoBranch: string) {
  return {
    fromCommit: await resolveCommit(repoDir, fromBranch),
    intoCommit: await resolveCommit(repoDir, intoBranch),
    mergeBaseCommit: await mergeBase(repoDir, intoBranch, fromBranch),
  };
}

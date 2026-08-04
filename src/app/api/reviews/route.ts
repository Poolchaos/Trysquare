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
import { engineModeSchema, reviewEffortSchema, reviewProfileSchema } from "@/lib/domain/enums";
import {
  listDependencyLinks,
  recordFetch,
  requireProject,
} from "@/server/db/repositories/projects";
import { appendRunNote, createReview, listActiveReviews } from "@/server/db/repositories/reviews";
import { getModel } from "@/server/db/repositories/models";
import { resolveProfile } from "@/lib/review/profiles";
import { fetchAll, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { created, handler, ok, readJson } from "@/server/api/respond";
import { detectMerged } from "@/server/review/merged";
import { runtime } from "@/server/runtime";
import { listProjects } from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";

export const dynamic = "force-dynamic";

const body = z.object({
  projectId: z.string().min(1),
  fromBranch: z.string().min(1),
  intoBranch: z.string().min(1),
  model: z.string().min(1),
  // No default: absent means "whatever the model is registered for", which is
  // not the same request as explicitly asking for full-context.
  profileId: reviewProfileSchema.optional(),
  engineMode: engineModeSchema.optional(),
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

    // Checked when the list is opened rather than on a timer: there is no
    // moment a background poll would be right for, and a stale badge is worse
    // than a late one (D-19).
    await detectMerged(
      db,
      listProjects(db).flatMap((project) => listReviewsForProject(db, project.id)),
    );

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

    // How the work is divided follows from the model, not from a default. The
    // registry knows what each model can absorb; asking for more than that is
    // refused, and asking for less is a deliberate downgrade that is recorded.
    const registered = getModel(db, input.model);
    // Parsed rather than asserted: the column is text, and a profile this code
    // does not know is treated as an unregistered model, which is visible in
    // the run note, instead of throwing out of review creation.
    const registeredProfile = reviewProfileSchema.safeParse(registered?.profileId);
    const resolution = resolveProfile({
      model: input.model,
      modelProfile: registeredProfile.success ? registeredProfile.data : null,
      ...(input.profileId === undefined ? {} : { requested: input.profileId }),
    });
    if (!resolution.ok) {
      throw Response.json({ error: resolution.message, code: resolution.code }, { status: 400 });
    }

    const review = createReview(db, {
      projectId: project.id,
      fromBranch: input.fromBranch,
      intoBranch: input.intoBranch,
      ...pins,
      model: input.model,
      profileId: resolution.profile,
      engineMode: input.engineMode ?? "headless",
      effort: input.effort,
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(linked === undefined ? {} : { linked }),
    });

    // Two independent facts, not branches of one: an unregistered model can
    // also carry an explicit downgrade, and folding them together once wrote
    // a note claiming full-context on a review that ran decomposed.
    if (!registeredProfile.success) {
      appendRunNote(db, review.id, {
        kind: "note",
        message:
          `${input.model} is not in the model registry, so its profile is unknown and ` +
          `full-context was assumed as the baseline. Probe the model to have its own ` +
          `profile used instead.`,
      });
    }
    if ((input.engineMode ?? "headless") === "interactive") {
      appendRunNote(db, review.id, {
        kind: "note",
        message:
          "Interactive engine: each stage's prompt is written to the bundle and this app " +
          "waits for you to save the answer beside it. Tokens are spent in your own session, " +
          "so the usage recorded here stays at zero.",
      });
    }
    if (resolution.downgradedFrom !== null) {
      appendRunNote(db, review.id, {
        kind: "note",
        message:
          `Profile downgraded from ${resolution.downgradedFrom} to ${resolution.profile} ` +
          `on purpose. The same rules are applied; they are divided into more, smaller requests.`,
      });
    }

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

/**
 * Creating a review, and listing them.
 *
 * Creating one is where the commits are pinned, so it fetches first and then
 * resolves the tips from the refs that fetch produced (D-27). A stale pin is
 * the worst failure this app can have: the run completes, the report reads as
 * authoritative, and it describes code the branch has already moved past. A
 * fetch that fails therefore blocks creation rather than falling back.
 */

import { apart, COMPARED_WITH_ITSELF } from "@/lib/git/branch-pair";
import { z } from "zod";
import {
  engineModeSchema,
  isSelectableEffort,
  reviewEffortSchema,
  reviewProfileSchema,
} from "@/lib/domain/enums";
import {
  listDependencyLinks,
  recordFetch,
  requireClonedProject,
} from "@/server/db/repositories/projects";
import { appendRunNote, createReview, listActiveReviews } from "@/server/db/repositories/reviews";
import { getModel } from "@/server/db/repositories/models";
import { effortRunsOn } from "@/lib/models/effort-support";
import { reviewModelSchema } from "@/lib/models/model-id";
import { resolveProfile } from "@/lib/review/profiles";
import { fetchAll, mergeBase, readChangeSet, resolveBranch } from "@/server/gitops/repo";
import { created, failed, handler, ok, readJson } from "@/server/api/respond";
import { detectMerged } from "@/server/review/merged";
import { findingTallies } from "@/server/db/repositories/findings";
import { runtime } from "@/server/runtime";
import {
  billingNotShown,
  billingShownSchema,
  cliNotReady,
  cliReadiness,
} from "@/server/cli-readiness";
import { listProjects } from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";

export const dynamic = "force-dynamic";

const body = z
  .object({
    projectId: z.string().min(1),
    fromBranch: z.string().min(1),
    intoBranch: z.string().min(1),
    model: reviewModelSchema,
    // No default: absent means "whatever the model is registered for", which is
    // not the same request as explicitly asking for full-context.
    profileId: reviewProfileSchema.optional(),
    engineMode: engineModeSchema.optional(),
    effort: reviewEffortSchema.default("high"),
    intent: z.string().optional(),
    billingShown: billingShownSchema,
    linked: z
      .object({
        projectId: z.string().min(1),
        fromBranch: z.string().min(1),
        intoBranch: z.string().min(1),
      })
      .refine(apart, COMPARED_WITH_ITSELF)
      .optional(),
  })
  .refine(apart, COMPARED_WITH_ITSELF);

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

    // One grouped query for the whole list rather than one per row.
    const tallies = findingTallies(db);
    const reviews = listProjects(db).flatMap((project) =>
      listReviewsForProject(db, project.id).map((review) => ({
        ...review,
        projectName: project.name,
        findings: tallies.get(review.id) ?? { total: 0, confirmed: 0, dismissed: 0, killed: 0 },
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
    // Ready, or the fetch below runs inside a clone still being written
    // (review of the D-133 fixes).
    const project = requireClonedProject(db, input.projectId);

    // Read before anything is fetched, so a dependency that names nothing, is
    // not cloned yet or is not linked is refused without a fetch from the
    // network first (review of the D-134 fixes).
    const dependency =
      input.linked === undefined ? undefined : requireClonedProject(db, input.linked.projectId);
    if (
      dependency &&
      !listDependencyLinks(db, project.id).some(
        (link) => link.dependencyProjectId === dependency.id,
      )
    ) {
      throw Response.json(
        {
          error: `${dependency.name} is not a dependency of ${project.name}.`,
          code: "NotLinked",
        },
        { status: 400 },
      );
    }

    // The free checks, before anything is fetched: a review the CLI cannot
    // run is refused with the reason, creating nothing, rather than started
    // and failed at its first stage (MVP 6.2). Asked first, not last, so a
    // refusal waits on no fetch (review of the 6.2 changes). The interactive
    // engine starts no CLI.
    const headless = (input.engineMode ?? "headless") === "headless";
    const readiness = headless ? await cliReadiness(db) : null;
    if (readiness?.refusal) throw cliNotReady(readiness);
    // Asked here as well as at Start, so a page refused for it leaves no draft.
    const unshown = readiness === null ? null : billingNotShown(readiness, input.billingShown);
    if (unshown !== null) throw unshown;

    // Fetched immediately before pinning, so the commits recorded are the tips
    // the remotes have now rather than whatever the last clone left behind.
    // Both sides are fetched before either is pinned, so the pair describes
    // one moment rather than two. At once: they are separate clones, and the
    // fetch queue serialises only one clone's fetches (D-181 item 7).
    const sides = dependency === undefined ? [project] : [project, dependency];
    const fetched = await Promise.allSettled(
      sides.map(async (side) => {
        await fetchAll(side.clonePath);
        recordFetch(db, side.id);
      }),
    );
    // Settled, not raced: the answer waits for both, and a failed primary is
    // the one reported, as when they ran in turn.
    for (const outcome of fetched) if (outcome.status === "rejected") throw outcome.reason;
    const pins = await pin(project.clonePath, input.fromBranch, input.intoBranch);
    const linked =
      dependency && input.linked
        ? {
            ...input.linked,
            projectId: dependency.id,
            ...(await pin(dependency.clonePath, input.linked.fromBranch, input.linked.intoBranch)),
          }
        : undefined;
    // A side whose change is empty, a branch never committed to or one
    // already merged, is a review of no change, which ran and read as clean
    // (D-145). Judged by the change set the review would read: commits that
    // add up to nothing, an empty commit or one and its revert, passed a
    // check by commits alone (D-146).
    for (const side of [
      {
        ...pins,
        clonePath: project.clonePath,
        fromBranch: input.fromBranch,
        intoBranch: input.intoBranch,
        whose: "",
      },
      ...(linked && dependency
        ? [{ ...linked, clonePath: dependency.clonePath, whose: `${dependency.name}'s ` }]
        : []),
    ]) {
      let empty = side.fromCommit === side.mergeBaseCommit;
      if (!empty) {
        try {
          empty =
            (await readChangeSet(side.clonePath, side.mergeBaseCommit, side.fromCommit)).files
              .length === 0;
        } catch (error) {
          // A diff that disagrees with git's own list of changed files, or git
          // refusing: the request's to fix, in git's words, as the pre-flight
          // answers it, not the server failing (D-147).
          return failed(error, 400);
        }
      }
      if (empty) {
        throw Response.json(
          {
            error: `${side.whose}${side.fromBranch} changes nothing against ${side.intoBranch}: a review of no change reads as clean.`,
            code: "EmptyChange",
          },
          { status: 400 },
        );
      }
    }

    // How the work is divided follows from the model, not from a default. The
    // registry knows what each model can absorb; asking for more than that is
    // refused, and asking for less is a deliberate downgrade that is recorded.
    // Refused for every model, on cost: up to 5.59 times high per call by the
    // CLI's own index, across five stages, unattended (D-125). Enforced here
    // as well as in the picker, because a rule only the screen knows is not a
    // rule.
    if (!isSelectableEffort(input.effort)) {
      throw Response.json(
        {
          error:
            `The ${input.effort} effort tier is not available for reviews. The CLI prices it ` +
            `at up to 5.59 times high for every call, and a review makes many, unattended. ` +
            `Choose high, which is the recommended tier.`,
          code: "EffortNotAvailable",
        },
        { status: 400 },
      );
    }
    if (!effortRunsOn(input.model, input.effort)) {
      throw Response.json(
        {
          error:
            `The CLI runs ${input.model} at high or at no effort when asked for ` +
            `${input.effort}, without saying so, so a review there would record an effort it ` +
            `never had. Choose high, or a newer model.`,
          code: "EffortNotSupported",
        },
        { status: 400 },
      );
    }

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
    fromCommit: await resolveBranch(repoDir, fromBranch),
    intoCommit: await resolveBranch(repoDir, intoBranch),
    mergeBaseCommit: await mergeBase(repoDir, intoBranch, fromBranch),
  };
}

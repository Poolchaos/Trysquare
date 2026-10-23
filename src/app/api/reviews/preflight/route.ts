/**
 * What a review would examine, before anyone pays for it.
 *
 * Read-only and free: git and arithmetic, no model calls, nothing written.
 * That is the whole point. A review is expensive enough that being able to see
 * the size of it beforehand, and to notice that a branch pair is empty or
 * enormous, is worth a round trip.
 *
 * The pins here are advisory. Creating a review fetches and pins again (D-27),
 * because the answer must be taken at the moment the review is made, not the
 * moment someone looked at a panel. The screen says so.
 */

import { apart, COMPARED_WITH_ITSELF } from "@/lib/git/branch-pair";
import { z } from "zod";
import { REVIEW_PROFILES, reviewProfileSchema } from "@/lib/domain/enums";
import type { ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
import { repoSlug } from "@/lib/git/url";
import { estimateTokens } from "@/lib/review/budget";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import { runSweeps } from "@/lib/review/sweep";
import { composeSystemPrompt, planRuleBatches } from "@/lib/rulesets/compose";
import { isJudgmentProfile, resolveProfile } from "@/lib/review/profiles";
import { availabilityOf } from "@/lib/models/availability";
import { reviewModelSchema } from "@/lib/models/model-id";
import { getModel } from "@/server/db/repositories/models";
import { recordFetch, requireClonedProject } from "@/server/db/repositories/projects";
import { loadRuleset } from "@/server/db/repositories/rulesets";
import { fetchAll, mergeBase, readChangeSet, resolveBranch } from "@/server/gitops/repo";
import { git } from "@/server/gitops/run";
import { renderAdversarialPrompt, type ChangedFileEntry } from "@/server/review/content";
import { countRequests } from "@/server/review/request-count";
import { failed, handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z
  .object({
    projectId: z.string().min(1),
    fromBranch: z.string().min(1),
    intoBranch: z.string().min(1),
    rulesetId: z.string().min(1),
    model: reviewModelSchema,
    profileId: reviewProfileSchema.optional(),
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

interface Side {
  slug: string;
  files: ParsedFile[];
  fromCommit: string;
  intoCommit: string;
  mergeBaseCommit: string;
  subject: string;
  hunks: number;
}

export function POST(request: Request): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const input = await readJson(request, body);
    const project = requireClonedProject(db, input.projectId);
    // Read before the catch below, which answers 400 for what git refuses: a
    // dependency that names nothing is a 404, and one not cloned yet a 409
    // (review of the D-133 fixes).
    const dependency =
      input.linked === undefined ? undefined : requireClonedProject(db, input.linked.projectId);
    const ruleset = loadRuleset(db, input.rulesetId);

    let primary: Side;
    let linkedSide: Side | undefined;
    try {
      primary = await inspect(project.clonePath, repoSlug(project.name), input);
      recordFetch(db, project.id);

      if (input.linked && dependency) {
        const slug =
          repoSlug(dependency.name) === primary.slug
            ? `${repoSlug(dependency.name)}-dep`
            : repoSlug(dependency.name);
        linkedSide = await inspect(dependency.clonePath, slug, input.linked);
        recordFetch(db, dependency.id);
      }
    } catch (error) {
      // A branch that vanished, a remote that will not answer, or a diff that
      // disagrees with git's own list of changed files. The error's own
      // words, because they say which of those it was.
      return failed(error, 400);
    }

    const entries: ChangedFileEntry[] = [
      ...primary.files.map((file) => ({ repo: "primary" as const, slug: primary.slug, file })),
      ...(linkedSide?.files ?? []).map((file) => ({
        repo: "linked" as const,
        slug: linkedSide!.slug,
        file,
      })),
    ];

    const sweep = runSweeps(
      entries.map((entry) => ({ repo: entry.repo, file: entry.file })),
      ruleset.rules,
    );

    const changedSymbols = linkedSide ? changedExportedSymbols(linkedSide.files) : [];

    // Resolved exactly as creation resolves it, so the panel states the
    // profile the run would use rather than a default the run would ignore.
    const registeredProfile = reviewProfileSchema.safeParse(getModel(db, input.model)?.profileId);
    const resolution = resolveProfile({
      model: input.model,
      modelProfile: registeredProfile.success ? registeredProfile.data : null,
      ...(input.profileId === undefined ? {} : { requested: input.profileId }),
    });
    if (!resolution.ok) {
      throw Response.json({ error: resolution.message, code: resolution.code }, { status: 400 });
    }
    const profile = resolution.profile;

    const paths = entries.map((entry) => `${entry.slug}/${entry.file.path}`);
    const plan = planRuleBatches(ruleset.rules, paths, profile);
    // Under their qualified paths, as the run holds them: the prompt keeps
    // only the hits in its files, so unqualified ones were never sized.
    const slugOf = (repo: string) =>
      repo === "linked" && linkedSide ? linkedSide.slug : primary.slug;
    const content = {
      files: entries,
      sweepHits: sweep.hits.map((hit) => ({ ...hit, path: `${slugOf(hit.repo)}/${hit.path}` })),
      ...(changedSymbols.length === 0 ? {} : { changedSymbols }),
    };

    const model = getModel(db, input.model);
    const window =
      model && availabilityOf(model) === "available" ? (model.contextWindow ?? null) : null;

    // Every request the run will make, by the run's own division of the work:
    // each rule batch fitted to the window against its own system prompt, as
    // the run composes it (WP-F). Per profile too, so a downgrade is an
    // informed choice rather than a guess (docs/06 section 3).
    const countFor = (candidate: typeof profile) =>
      countRequests({
        content,
        files: paths,
        rules: ruleset.rules,
        profile: candidate,
        contextWindow: window ?? undefined,
        systemPromptFor: (rules) =>
          composeSystemPrompt({
            directives: ruleset.directives,
            rules,
            stage: "s3_adversarial",
            includeFullRules: true,
            outputContract: outputContractFor(stageSchemaFor("s3_adversarial")),
          }),
      });
    const requests = countFor(profile);
    const judgmentProfiles = REVIEW_PROFILES.filter(isJudgmentProfile);
    const byProfile = judgmentProfiles.map(
      (candidate) => [candidate, countFor(candidate)] as const,
    );
    const requestsByProfile = Object.fromEntries(
      byProfile.map(([name, count]) => [name, count.total]),
    );
    const passesByProfile = Object.fromEntries(
      byProfile.map(([name, count]) => [name, count.passes]),
    );

    // The heaviest prompt the run would send, which is what decides whether it
    // has to be split at all.
    const systemPrompt = composeSystemPrompt({
      directives: ruleset.directives,
      rules: ruleset.rules,
      stage: "s3_adversarial",
      includeFullRules: true,
      outputContract: outputContractFor(stageSchemaFor("s3_adversarial")),
    });
    const prompt = renderAdversarialPrompt(content);
    const estimate = estimateTokens(systemPrompt) + estimateTokens(prompt);

    return ok({
      pins: {
        primary: sidePins(primary),
        ...(linkedSide ? { linked: sidePins(linkedSide) } : {}),
      },
      files: entries.length,
      hunks: primary.hunks + (linkedSide?.hunks ?? 0),
      sweepHits: sweep.hits.length,
      // A pattern that could not be run means the sweep is incomplete, which
      // the pipeline refuses outright. Better seen here than after paying.
      sweepProblems: sweep.problems.map(
        (problem) => `${problem.ruleCode} (${problem.pattern}): ${problem.reason}`,
      ),
      // Patterns read as literal text because they are not regular
      // expressions. Informational: the sweep runs them, and the run notes
      // record the same fact on the review.
      sweepLiterals: sweep.ranAsLiteral.map((entry) => `${entry.ruleCode} (${entry.pattern})`),
      changedSymbols: changedSymbols.length,
      estimatedTokens: estimate,
      contextWindow: window,
      // Whether the run fits each request in the window without splitting a
      // rule batch, as the run itself decides it.
      withinWindow: window === null ? null : !requests.split,
      requests: requests.total,
      requestsByStage: requests.byStage,
      passes: requests.passes,
      requestsSplit: requests.split,
      requestsByProfile,
      passesByProfile,
      excludedPairs: plan.excluded.length,
      profile,
      modelProfile: registeredProfile.success ? registeredProfile.data : null,
      downgradedFrom: resolution.downgradedFrom,
    });
  });
}

function sidePins(side: Side) {
  return {
    slug: side.slug,
    fromCommit: side.fromCommit,
    intoCommit: side.intoCommit,
    mergeBaseCommit: side.mergeBaseCommit,
    subject: side.subject,
    files: side.files.length,
    hunks: side.hunks,
  };
}

async function inspect(
  repoDir: string,
  slug: string,
  branches: { fromBranch: string; intoBranch: string },
): Promise<Side> {
  await fetchAll(repoDir);
  const fromCommit = await resolveBranch(repoDir, branches.fromBranch);
  const intoCommit = await resolveBranch(repoDir, branches.intoBranch);
  const mergeBaseCommit = await mergeBase(repoDir, branches.intoBranch, branches.fromBranch);
  const { files } = await readChangeSet(repoDir, mergeBaseCommit, fromCommit);

  return {
    slug,
    files,
    fromCommit,
    intoCommit,
    mergeBaseCommit,
    subject: (await git(["log", "-1", "--format=%s", fromCommit], { cwd: repoDir })).trim(),
    hunks: files.reduce((total, file) => total + file.hunks.length, 0),
  };
}

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

import { z } from "zod";
import { REVIEW_PROFILES, reviewProfileSchema } from "@/lib/domain/enums";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
import { repoSlug } from "@/lib/git/url";
import { estimateTokens, budgetFor } from "@/lib/review/budget";
import { outputContractFor, stageSchemaFor } from "@/lib/review/stage-schemas";
import { runSweeps } from "@/lib/review/sweep";
import { composeSystemPrompt, planRuleBatches } from "@/lib/rulesets/compose";
import { isJudgmentProfile, resolveProfile } from "@/lib/review/profiles";
import { availabilityOf } from "@/lib/models/availability";
import { getModel } from "@/server/db/repositories/models";
import { recordFetch, requireProject } from "@/server/db/repositories/projects";
import { loadRuleset } from "@/server/db/repositories/rulesets";
import { diffText, fetchAll, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { git } from "@/server/gitops/run";
import { renderAdversarialPrompt, type ChangedFileEntry } from "@/server/review/content";
import { failed, handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  projectId: z.string().min(1),
  fromBranch: z.string().min(1),
  intoBranch: z.string().min(1),
  rulesetId: z.string().min(1),
  model: z.string().min(1),
  profileId: reviewProfileSchema.optional(),
  linked: z
    .object({
      projectId: z.string().min(1),
      fromBranch: z.string().min(1),
      intoBranch: z.string().min(1),
    })
    .optional(),
});

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
    const project = requireProject(db, input.projectId);
    const ruleset = loadRuleset(db, input.rulesetId);

    let primary: Side;
    let linkedSide: Side | undefined;
    try {
      primary = await inspect(project.clonePath, repoSlug(project.name), input);
      recordFetch(db, project.id);

      if (input.linked) {
        const dependency = requireProject(db, input.linked.projectId);
        const slug =
          repoSlug(dependency.name) === primary.slug
            ? `${repoSlug(dependency.name)}-dep`
            : repoSlug(dependency.name);
        linkedSide = await inspect(dependency.clonePath, slug, input.linked);
        recordFetch(db, dependency.id);
      }
    } catch (error) {
      // A branch that vanished, or a remote that will not answer. Git's own
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

    // What each profile would cost in requests, so a downgrade is an informed
    // choice rather than a guess (docs/06 section 3).
    const requestsByProfile = Object.fromEntries(
      REVIEW_PROFILES.filter(isJudgmentProfile).map((candidate) => [
        candidate,
        planRuleBatches(ruleset.rules, paths, candidate).batches.length,
      ]),
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
    const prompt = renderAdversarialPrompt({
      files: entries,
      sweepHits: sweep.hits.map((hit) => ({ ...hit, path: hit.path })),
      ...(changedSymbols.length === 0 ? {} : { changedSymbols }),
    });
    const estimate = estimateTokens(systemPrompt) + estimateTokens(prompt);

    const model = getModel(db, input.model);
    const window =
      model && availabilityOf(model) === "available" ? (model.contextWindow ?? null) : null;

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
      sweepProblems: sweep.problems.map((problem) => problem.reason),
      changedSymbols: changedSymbols.length,
      estimatedTokens: estimate,
      contextWindow: window,
      withinWindow: window === null ? null : estimate <= budgetFor(window),
      requests: plan.batches.length,
      requestsByProfile,
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
  const fromCommit = await resolveCommit(repoDir, branches.fromBranch);
  const intoCommit = await resolveCommit(repoDir, branches.intoBranch);
  const mergeBaseCommit = await mergeBase(repoDir, branches.intoBranch, branches.fromBranch);
  const files = parseUnifiedDiff(await diffText(repoDir, mergeBaseCommit, fromCommit));

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

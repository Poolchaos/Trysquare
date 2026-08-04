/**
 * What each stage must answer with.
 *
 * These are validated at the boundary, so a stage that returns something
 * unexpected fails immediately rather than producing a review built on a
 * shape nobody checked. They are also rendered into the prompt as the output
 * contract, so the schema the model is told about and the schema its answer is
 * checked against are the same object.
 */

import { z } from "zod";
import { RISK_TAGS, SEVERITIES, type ReviewStage } from "@/lib/domain/enums";

export const riskStageSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      riskTags: z.array(z.enum(RISK_TAGS)),
      reason: z.string(),
    }),
  ),
});

export const comprehensionStageSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      /** What the change does, in the model's own words. */
      summary: z.string(),
      /** Files it had to read to understand this one. */
      chainFilesRead: z.array(z.string()),
      uncertainties: z.array(z.string()),
    }),
  ),
});

const candidateFindingSchema = z.object({
  path: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  severity: z.enum(SEVERITIES),
  ruleCode: z.string().nullable(),
  issue: z.string().min(1),
  /** Plain language, no code: what is wrong and what it breaks. */
  comment: z.string().min(1),
  /** Input, mechanism, wrong output. A finding without one is a guess. */
  mechanism: z.string().min(1),
});

/**
 * What was done about one changed contract in a linked dependency.
 *
 * "no consumers found" is a verdict in its own right rather than a special
 * case of having verified them all. A newly exported symbol genuinely has no
 * consumers yet, and folding that into "all verified" with an empty list would
 * make the check meaningless: the app could no longer tell the difference
 * between looking and finding nothing, and not looking.
 */
const symbolDispositionEntrySchema = z.object({
  symbol: z.string().min(1),
  /** Where the symbol is declared, in the dependency repository. */
  path: z.string().min(1),
  /** Consumer files in the primary repository that were opened and checked. */
  consumersChecked: z.array(z.string()),
  verdict: z.enum(["all_consumers_verified", "no_consumers_found", "finding"]),
  reason: z.string().min(1),
});

export const adversarialStageSchema = z.object({
  findings: z.array(candidateFindingSchema),
  /**
   * Only present for a linked review. Optional so a single-repo review's
   * answer is not required to carry an empty list it could get wrong.
   */
  symbolDispositions: z.array(symbolDispositionEntrySchema).optional().default([]),
  /**
   * Every hunk examined and found clear, with the reason. A hunk that appears
   * in neither this list nor a finding is treated as unreviewed.
   */
  clearedHunks: z.array(
    z.object({
      path: z.string(),
      hunkIndex: z.number().int().nonnegative(),
      reason: z.string().min(1),
    }),
  ),
  sweepDispositions: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive(),
      ruleCode: z.string(),
      disposition: z.enum(["finding", "cleared"]),
      reason: z.string().min(1),
    }),
  ),
});

export const deletionStageSchema = z.object({
  findings: z.array(candidateFindingSchema),
  reviewedDeletions: z.array(
    z.object({
      path: z.string(),
      behaviourRemoved: z.string().min(1),
      dependents: z.array(z.string()),
      reason: z.string().min(1),
    }),
  ),
});

export const verificationStageSchema = z.object({
  verdicts: z.array(
    z.object({
      /**
       * Which candidate this answers, by the label the prompt gave it.
       *
       * Deliberately not a database id. Candidates are recreated whenever a
       * review is resumed, so an id would make the question different every
       * time and the stage could never be replayed.
       */
      ref: z.string(),
      verdict: z.enum(["verified", "killed", "open_question"]),
      /** Required for a verified finding: it is what gets byte-checked. */
      quotedCode: z.string(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      note: z.string(),
    }),
  ),
});

export type AdversarialStageOutput = z.infer<typeof adversarialStageSchema>;

/**
 * Renders a schema into the prompt as an instruction.
 *
 * Derived from the schema itself so the contract described and the contract
 * enforced cannot drift apart.
 */
export function outputContractFor(schema: z.ZodType): string {
  return [
    "Answer with a single JSON object matching this schema exactly, and nothing else:",
    "",
    "```json",
    JSON.stringify(z.toJSONSchema(schema), null, 2),
    "```",
  ].join("\n");
}

/**
 * The schema each stage must answer with.
 *
 * Lives here, beside the schemas, because both the engine runner and the
 * review service need it: the runner to validate an answer, the service to
 * render the contract into the prompt. Two copies would drift, and a stage
 * told about one shape while being checked against another is the kind of
 * failure that looks like a model problem for a long time first.
 */
const STAGE_SCHEMAS = {
  s1_risk: riskStageSchema,
  s2_comprehension: comprehensionStageSchema,
  s3_adversarial: adversarialStageSchema,
  s4_deletions: deletionStageSchema,
  s5_verification: verificationStageSchema,
  // The audit stage produces prose for the report rather than structured
  // findings, so it reuses the simplest shape; nothing reads its output.
  s6_audit: riskStageSchema,
} as const satisfies Record<ReviewStage, z.ZodType>;

export function stageSchemaFor(stage: ReviewStage): z.ZodType {
  return STAGE_SCHEMAS[stage];
}

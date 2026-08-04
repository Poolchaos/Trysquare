/**
 * The model registry: what this account can actually use.
 *
 * Nothing here is assumed. A row's availability is whatever the last probe
 * returned, and a row that has never been probed reads as unknown rather than
 * as working. Short aliases are rejected on the way in, because they resolve
 * to a previous model generation and would silently downgrade every review.
 */

import { asc, eq } from "drizzle-orm";
import { nowIso } from "@/lib/ids";
import type { ReviewProfile } from "@/lib/domain/enums";
import type { Db } from "../client";
import { models } from "../schema";

export type ModelRow = typeof models.$inferSelect;

/**
 * A bare family name with no version is an alias. The CLI resolves those to
 * whatever it considers current for the family, which has already been
 * observed to be a previous generation, so they are never stored or passed.
 */
const ALIAS_PATTERN = /^(opus|sonnet|haiku|fable|mythos)$/i;

export class ModelAliasRejectedError extends Error {
  constructor(readonly id: string) {
    super(
      `"${id}" is a model alias, not a model id. Aliases resolve to whatever the CLI ` +
        `considers current for that family, which can be a previous generation. ` +
        `Use a full id such as "claude-fable-5[1m]".`,
    );
    this.name = "ModelAliasRejectedError";
  }
}

export function assertNotAlias(id: string): void {
  if (ALIAS_PATTERN.test(id.trim())) throw new ModelAliasRejectedError(id);
}

export interface RegisterModelInput {
  id: string;
  family: string;
  displayName: string;
  profileId: ReviewProfile;
  recommended?: boolean;
  sortOrder?: number;
}

/** Adds a candidate to the registry. Availability stays unknown until probed. */
export function registerCandidate(db: Db, input: RegisterModelInput): ModelRow {
  assertNotAlias(input.id);
  const row = {
    id: input.id,
    resolvedId: null,
    family: input.family,
    displayName: input.displayName,
    available: null,
    contextWindow: null,
    profileId: input.profileId,
    recommended: input.recommended ?? false,
    sortOrder: input.sortOrder ?? 0,
    lastProbedAt: null,
    lastError: null,
  };
  db.insert(models).values(row).onConflictDoNothing().run();
  return db.select().from(models).where(eq(models.id, input.id)).get() ?? row;
}

export function recordProbeSuccess(
  db: Db,
  id: string,
  result: { resolvedId: string; contextWindow: number },
): void {
  db.update(models)
    .set({
      available: true,
      resolvedId: result.resolvedId,
      contextWindow: result.contextWindow,
      lastProbedAt: nowIso(),
      lastError: null,
    })
    .where(eq(models.id, id))
    .run();
}

export function recordProbeFailure(db: Db, id: string, error: string): void {
  db.update(models)
    .set({ available: false, lastProbedAt: nowIso(), lastError: error })
    .where(eq(models.id, id))
    .run();
}

export class ModelNotFoundError extends Error {
  constructor(readonly modelId: string) {
    super(`No model called "${modelId}" is registered.`);
    this.name = "ModelNotFoundError";
  }
}

export function requireModel(db: Db, id: string): ModelRow {
  const row = getModel(db, id);
  if (!row) throw new ModelNotFoundError(id);
  return row;
}

export function listModels(db: Db): ModelRow[] {
  return db.select().from(models).orderBy(asc(models.sortOrder), asc(models.id)).all();
}

export function getModel(db: Db, id: string): ModelRow | undefined {
  return db.select().from(models).where(eq(models.id, id)).get();
}

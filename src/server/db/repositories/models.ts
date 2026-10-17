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
import { aliasRefusal, isFullModelId } from "@/lib/models/model-id";
import type { Db } from "../client";
import { models } from "../schema";

export type ModelRow = typeof models.$inferSelect;

export class ModelAliasRejectedError extends Error {
  constructor(readonly id: string) {
    super(aliasRefusal(id));
    this.name = "ModelAliasRejectedError";
  }
}

export function assertNotAlias(id: string): void {
  if (!isFullModelId(id)) throw new ModelAliasRejectedError(id);
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

/**
 * Records what a probe found, by kind.
 *
 * An indeterminate probe, a timeout or a CLI that could not be reached,
 * changes nothing but the message. The 2026-07-30 decision: greying a working
 * model out of the picker on one slow call would be wrong and hard to notice,
 * so the last real verdict and the time it was reached both stand.
 */
export function recordProbeOutcome(
  db: Db,
  id: string,
  outcome:
    | { status: "available"; resolvedId: string; contextWindow: number }
    | { status: "unavailable" | "indeterminate"; error: string },
): void {
  if (outcome.status === "available") {
    recordProbeSuccess(db, id, outcome);
  } else if (outcome.status === "unavailable") {
    recordProbeFailure(db, id, outcome.error);
  } else {
    db.update(models).set({ lastError: outcome.error }).where(eq(models.id, id)).run();
  }
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

/**
 * What the top bar and the dashboard are told is in flight.
 *
 * The seventeenth grade (AE1): a review paused at the usage limit was handed
 * to both as the one in flight even while another ran, so the bar said
 * Paused through a run and the dashboard had nothing live to show for it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { transitionReview } from "@/server/db/repositories/reviews";
import { seedProject, seedReview } from "../db/helpers";

let dataDir: string;
let route: typeof import("@/app/api/reviews/attention/route");
let runtime: typeof import("@/server/runtime");

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-attention-"));
  process.env.TRYSQUARE_DATA = dataDir;
  route = await import("@/app/api/reviews/attention/route");
  runtime = await import("@/server/runtime");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  runtime.closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function active(): Promise<{ id: string; status: string } | null> {
  const response = await route.GET();
  expect(response.status).toBe(200);
  return ((await response.json()) as { active: { id: string; status: string } | null }).active;
}

it("says nothing is in flight for a running row no process owns", async () => {
  const { db } = runtime.runtime();
  const orphan = seedReview(db, seedProject(db, "orphan").id);
  transitionReview(db, orphan.id, "running");

  expect(await active()).toBeNull();

  transitionReview(db, orphan.id, "cancelled");
});

it("gives a review paused at the usage limit as paused, while nothing runs", async () => {
  const { db } = runtime.runtime();
  const paused = seedReview(db, seedProject(db, "paused").id);
  transitionReview(db, paused.id, "running");
  transitionReview(db, paused.id, "paused_limit", { pausedReason: "Usage limit reached." });

  expect(await active()).toMatchObject({ id: paused.id, status: "paused_limit" });
});

it("gives the review that is running before an older one left paused", async () => {
  const { db, manager } = runtime.runtime();
  const older = seedReview(db, seedProject(db, "older").id);
  transitionReview(db, older.id, "running");
  transitionReview(db, older.id, "paused_limit", { pausedReason: "Usage limit reached." });
  const started = seedReview(db, seedProject(db, "started").id);
  transitionReview(db, started.id, "running");
  vi.spyOn(manager, "isRunning").mockImplementation((id) => id === started.id);

  expect(await active()).toMatchObject({ id: started.id, status: "running" });
});

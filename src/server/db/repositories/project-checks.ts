/**
 * A project's own checks (WP-I, D-191), as a person set them. No row reads
 * as turned off, so a project added before them needs nothing done to it.
 */

import { eq } from "drizzle-orm";
import { nowIso } from "@/lib/ids";
import { NO_CHECKS, type ProjectChecks } from "@/lib/projects/checks";
import type { Db } from "../client";
import { projectChecks } from "../schema";

export function getProjectChecks(db: Db, projectId: string): ProjectChecks {
  const row = db.select().from(projectChecks).where(eq(projectChecks.projectId, projectId)).get();
  if (row === undefined) return NO_CHECKS;
  return {
    enabled: row.enabled,
    installCommand: row.installCommand,
    testCommand: row.testCommand,
    e2eCommand: row.e2eCommand,
    screenshotDir: row.screenshotDir,
    designStandardPath: row.designStandardPath,
  };
}

export function setProjectChecks(db: Db, projectId: string, checks: ProjectChecks): void {
  const row = { ...checks, updatedAt: nowIso() };
  db.insert(projectChecks)
    .values({ projectId, ...row })
    .onConflictDoUpdate({ target: projectChecks.projectId, set: row })
    .run();
}

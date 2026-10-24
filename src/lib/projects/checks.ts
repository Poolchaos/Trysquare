/**
 * A project's own checks, which a review runs on a throwaway copy of the
 * branch once a person turns them on (proof-and-steps plan, WP-I; D-191,
 * D-192): the commands, the folder its e2e saves screenshots to, and the
 * design standard the screenshots are graded against. Off by default, since
 * turning them on runs the branch's code on this machine.
 */

import { z } from "zod";

export interface ProjectChecks {
  enabled: boolean;
  installCommand: string | null;
  testCommand: string | null;
  e2eCommand: string | null;
  /** Where the e2e command saves its screenshots, inside the repository. */
  screenshotDir: string | null;
  /** The project's design standard, inside the repository; null grades by A to D alone. */
  designStandardPath: string | null;
}

export const NO_CHECKS: ProjectChecks = {
  enabled: false,
  installCommand: null,
  testCommand: null,
  e2eCommand: null,
  screenshotDir: null,
  designStandardPath: null,
};

/** Relative, and never climbing out: the copy is the only place these may name. */
function isInsideRepository(path: string): boolean {
  if (path === "" || /^[\\/]/.test(path) || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}

const blankIsNone = (value: string | null) => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

const command = z
  .string()
  .nullable()
  .transform(blankIsNone)
  .refine((value) => value === null || !/[\r\n]/.test(value), "A command is one line.")
  .refine(
    (value) => value === null || value.length <= 1000,
    "A command is at most 1000 characters.",
  );

const repositoryPath = z
  .string()
  .nullable()
  .transform(blankIsNone)
  .refine(
    (value) => value === null || isInsideRepository(value),
    "A path inside the repository, such as e2e/screenshots: not absolute, and no '..'.",
  );

export const projectChecksSchema = z
  .object({
    enabled: z.boolean(),
    installCommand: command,
    testCommand: command,
    e2eCommand: command,
    screenshotDir: repositoryPath,
    designStandardPath: repositoryPath,
  })
  .strict()
  .superRefine((checks, context) => {
    if (checks.enabled && checks.testCommand === null && checks.e2eCommand === null) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "Give a test command, an e2e command or both before turning the checks on.",
      });
    }
    // Screenshots only where the project has e2e tests (D-192): a folder
    // nothing saves to grades nothing, and an e2e run with no folder named
    // leaves its screenshots unread.
    if ((checks.e2eCommand === null) !== (checks.screenshotDir === null)) {
      context.addIssue({
        code: "custom",
        path: [checks.e2eCommand === null ? "e2eCommand" : "screenshotDir"],
        message: "An e2e command and the folder it saves screenshots to go together.",
      });
    }
  });

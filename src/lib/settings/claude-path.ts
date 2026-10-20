import { z } from "zod";

/**
 * The CLI path a person keeps in Settings. Empty is no path: the CLI `npm
 * install` put in node_modules, then PATH. Whether it names a CLI that runs
 * is not judged here but by the check on Settings, which says why one does
 * not; a line break or other control character, though, is no path anyone
 * meant, and in a run note it would forge a line of its own.
 */
export const claudePathSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(1024, "is longer than any path the CLI could be at")
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "holds a control character"),
  );

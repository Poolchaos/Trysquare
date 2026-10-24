/**
 * Where a design finding's screenshot is (WP-I step 4): its name as the
 * project's e2e saved it, under its review's own screenshots folder. The
 * name is kept, not the absolute path, so a data directory spelled or
 * placed differently since still finds it, and nothing a row holds can
 * name a file anywhere else (review round 8).
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { checksDir } from "@/lib/paths";
import { isScreenshotName } from "@/lib/review/design";

export function screenshotsDir(dataDir: string, reviewId: string): string {
  return join(checksDir(dataDir, reviewId), "screenshots");
}

/**
 * A row's screenshot as a name. Rows from before round 8 kept an absolute
 * path; one inside its own review's folder is read as the name it has
 * there, and anything else is left as it is, for the lookup to refuse.
 */
export function screenshotNameOf(dataDir: string, reviewId: string, kept: string): string {
  if (!isAbsolute(kept)) return kept;
  const inside = relative(resolve(screenshotsDir(dataDir, reviewId)), resolve(kept));
  if (inside === "" || isAbsolute(inside) || inside.split(sep)[0] === "..") return kept;
  return inside.split(sep).join("/");
}

/** The file, or null when the name would leave the folder. */
export function screenshotFile(dataDir: string, reviewId: string, name: string): string | null {
  if (!isScreenshotName(name)) return null;
  return resolve(screenshotsDir(dataDir, reviewId), ...name.split("/"));
}

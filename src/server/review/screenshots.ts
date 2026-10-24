/**
 * Where a design finding's screenshot is (WP-I step 4): its name as the
 * project's e2e saved it, under its review's own screenshots folder. The
 * name is kept, not the absolute path, so a data directory spelled or
 * placed differently since still finds it, and nothing a row holds can
 * name a file anywhere else (review round 8).
 */

import { isAbsolute, join, resolve } from "node:path";
import { checksDir } from "@/lib/paths";

export function screenshotsDir(dataDir: string, reviewId: string): string {
  return join(checksDir(dataDir, reviewId), "screenshots");
}

/** The file, or null when the name would leave the folder. */
export function screenshotFile(dataDir: string, reviewId: string, name: string): string | null {
  if (name === "" || isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return null;
  if (name.split(/[\\/]/).some((segment) => segment === ".." || segment === "")) return null;
  return resolve(screenshotsDir(dataDir, reviewId), name);
}

import { realpath as walkRealpath } from "node:fs";
import { realpath as nativeRealpath } from "node:fs/promises";
import { promisify } from "node:util";

const walk = promisify(walkRealpath);

/**
 * The real path of `path`, its links resolved.
 *
 * Node's promise realpath is the native one, which throws EISDIR on Windows
 * RAM and virtual disks that bypass the Volume Mount Manager, imDisk's among
 * them; Vite records the same and falls back to Node's own walk of the path
 * (optimizeSafeRealPathSync). So does this, and only for that error (D-144).
 */
export async function realPath(
  path: string,
  native: (path: string) => Promise<string> = (target) => nativeRealpath(target),
  fallback: (path: string) => Promise<string> = (target) => walk(target),
): Promise<string> {
  try {
    return await native(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EISDIR") return fallback(path);
    throw error;
  }
}

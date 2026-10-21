import { realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

/** Across drives, `relative` answers an absolute path, which is not inside. */
function inside(root: string, path: string): boolean {
  const from = relative(root, path);
  return from !== "" && !from.startsWith("..") && !isAbsolute(from);
}

/**
 * Where a path really leads, so a link is judged by its target: one in the
 * temp directory to a script in node_modules passed for a fake (review of
 * the D-153 fixes). macOS's temp directory is itself a link, /var to
 * /private/var, so the roots are resolved the same way.
 */
function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** What a fake in the temp directory is written as: a script Node runs. */
const NODE_SCRIPTS = new Set([".mjs", ".js", ".cjs"]);

/**
 * Whether a program the suite resolved is a fake, for the real-CLI guard.
 *
 * A fake is a program in this checkout's tests, or a Node script in the temp
 * directory that Node itself runs, where tests write their own stand-ins.
 * Nothing under a node_modules folder is one, wherever it sits: the temp
 * directory alone once let through a copy of this repository made there,
 * whose node_modules holds the real CLI (review of the D-152 fixes). A shell
 * script or batch file in the temp directory is not one either: no test
 * writes one, and one can start any program (review of the D-153 fixes).
 */
export function isFakeCli(
  program: string,
  runByNode: boolean,
  testsDir: string,
  tempDir: string,
): boolean {
  const path = real(program);
  if (path.split(sep).some((part) => part.toLowerCase() === "node_modules")) return false;
  if (inside(real(testsDir), path)) return true;
  return runByNode && inside(real(tempDir), path) && NODE_SCRIPTS.has(extname(path).toLowerCase());
}

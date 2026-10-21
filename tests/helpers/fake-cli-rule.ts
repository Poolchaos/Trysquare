import { extname, isAbsolute, relative, resolve, sep } from "node:path";

/** Across drives, `relative` answers an absolute path, which is not inside. */
function inside(root: string, path: string): boolean {
  const from = relative(resolve(root), resolve(path));
  return from !== "" && !from.startsWith("..") && !isAbsolute(from);
}

/** What a fake is written as: a script Node or a shell runs. */
const SCRIPT_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".cmd", ".bat", ".sh"]);

/**
 * Whether a program the suite resolved is a fake, for the real-CLI guard.
 *
 * A fake is a program in this checkout's tests, or a script in the temp
 * directory, where tests write their own stand-ins. Nothing under a
 * node_modules folder is one, wherever it sits: the temp directory alone
 * once let through a copy of this repository made there, whose node_modules
 * holds the real CLI (review of the D-152 fixes).
 */
export function isFakeCli(program: string, testsDir: string, tempDir: string): boolean {
  if (
    resolve(program)
      .split(sep)
      .some((part) => part.toLowerCase() === "node_modules")
  ) {
    return false;
  }
  if (inside(testsDir, program)) return true;
  return inside(tempDir, program) && SCRIPT_EXTENSIONS.has(extname(program).toLowerCase());
}

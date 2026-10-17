/**
 * Whether a path from a diff is safe to join onto a directory.
 *
 * Git writes repository paths relative and separated by `/`, and a path is
 * only ever used here by joining it onto a root: the worktree, or the bundle
 * that keeps deleted files. Git itself will store a tree entry it never writes
 * to a checkout, such as `..` or `..\..\escaped.txt`, and on Windows `path.join`
 * reads that backslash as a separator. A deleted entry of that kind wrote its
 * contents outside the data directory (MVP-PLAN 4.8, proven 2026-10-17). So a
 * path is refused unless every segment is an ordinary name.
 */

export class UnsafeRepoPathError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(
      `The change set contains the path ${JSON.stringify(path)}, which ${reason}. ` +
        "Joined onto a directory it could reach outside it, so the review is refused.",
    );
    this.name = "UnsafeRepoPathError";
  }
}

/** Why a path is unsafe, or null when every segment is an ordinary name. */
export function unsafeRepoPathReason(path: string): string | null {
  if (path === "") return "is empty";
  if (/[\\\0]/.test(path)) return "contains a backslash or a NUL character";
  if (path.startsWith("/")) return "is absolute";
  if (/^[A-Za-z]:/.test(path)) return "names a drive";
  for (const segment of path.split("/")) {
    if (segment === "") return "has an empty segment";
    if (segment === "." || segment === "..") return `has a "${segment}" segment`;
  }
  return null;
}

export function assertSafeRepoPath(path: string): void {
  const reason = unsafeRepoPathReason(path);
  if (reason !== null) throw new UnsafeRepoPathError(path, reason);
}

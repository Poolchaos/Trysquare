/**
 * Validation of the git URLs a user pastes in.
 *
 * This is a security boundary, not just a convenience check. Two git features
 * turn a URL into code execution, and both are rejected here rather than being
 * relied on to be harmless: the `ext::` transport runs an arbitrary command,
 * and a URL beginning with a dash is parsed by git as an option rather than an
 * address. Everything else is passed to git through execFile with an argument
 * array, never a shell string.
 */

export class InvalidGitUrlError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`"${url}" is not a usable git URL: ${reason}`);
    this.name = "InvalidGitUrlError";
  }
}

/** Transports git supports that execute a command rather than opening a connection. */
const EXECUTING_TRANSPORTS = ["ext::", "fd::"];

const SUPPORTED_SCHEMES = ["https://", "http://", "ssh://", "git://", "file://"];

/** user@host:path/to/repo.git, the form GitHub and GitLab hand out. */
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

export function validateGitUrl(rawUrl: string): string {
  const url = rawUrl.trim();

  if (url === "") throw new InvalidGitUrlError(rawUrl, "it is empty");

  if (url.startsWith("-")) {
    // git would read this as a command-line option, not an address.
    throw new InvalidGitUrlError(rawUrl, "it starts with a dash, which git reads as an option");
  }

  const lower = url.toLowerCase();
  for (const transport of EXECUTING_TRANSPORTS) {
    if (lower.startsWith(transport)) {
      throw new InvalidGitUrlError(
        rawUrl,
        `the "${transport}" transport runs an arbitrary command, so it is not accepted`,
      );
    }
  }

  if (/[\r\n\0]/.test(url)) {
    throw new InvalidGitUrlError(rawUrl, "it contains a newline or null byte");
  }

  // `\\host\share`, `//host/share` and a file URL naming a host all reach
  // another machine, and opening one makes Windows offer this user's
  // credentials to that host over SMB. A path the user pasted never reaches
  // out. The test is made on the path as git will read it: git decodes a file
  // URL's escapes, and Windows treats `\` and `/` alike, so `file:///%5Chost`,
  // `file:///\host` and `/\host` are all `//host` by the time anything opens
  // them (measured 2026-10-16: each listed refs over `\\localhost\C$`).
  const networkShare = () =>
    new InvalidGitUrlError(
      rawUrl,
      "it is a network share, and opening one sends your Windows credentials to that machine",
    );
  const reachesOut = (path: string) => /^\/\//.test(path.replace(/\\/g, "/"));
  if (lower.startsWith("file://")) {
    let path: string;
    try {
      path = decodeURIComponent(url.slice("file://".length));
    } catch {
      throw new InvalidGitUrlError(rawUrl, "its percent-escapes do not decode");
    }
    const drive = /^\/?[A-Za-z]:[\\/]/.test(path);
    if (!drive && (!/^[\\/]/.test(path) || reachesOut(path))) throw networkShare();
  }

  const hasScheme = SUPPORTED_SCHEMES.some((scheme) => lower.startsWith(scheme));
  if (hasScheme) return url;

  if (reachesOut(url)) throw networkShare();

  if (SCP_LIKE.test(url)) return url;
  if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return url;
  // A Windows drive path, and the backslash forms of the relative ones.
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith(".\\") || url.startsWith("..\\")) return url;

  throw new InvalidGitUrlError(
    rawUrl,
    `it is not an https, ssh, git, or file URL, a user@host:path address, or a local path`,
  );
}

/**
 * A filesystem-safe slug for the worktree directory of a linked review, where
 * two repositories are checked out side by side and their names become path
 * segments the model reads.
 */
export function repoSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, 64);
  return slug === "" ? "repository" : slug;
}

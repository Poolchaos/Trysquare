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

/**
 * An address's user information, up to the last @ before its path: a
 * password may hold a quote or an @ of its own (review round 10).
 */
const HTTP_USERINFO = /\b(https?:\/\/)[^/\s]*@/gi;
/** Any other scheme's, only when it carries a password: an SSH user is a name. */
const PASSWORD_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^/\s]*@/gi;

/**
 * Text with any address's credentials replaced, as git prints addresses in
 * its messages: an error must not carry a token it was given into a stored
 * clone error, a response or a screen (audit finding 2).
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(HTTP_USERINFO, "$1***@").replace(PASSWORD_USERINFO, "$1***@");
}

/** What an address carries that Trysquare would have to store, and the address without it. */
interface Credentials {
  kind: "a password or token" | "a user name or token";
  address: string;
}

/**
 * The credentials an address carries, or null when it carries none: any user
 * on http(s), where a name alone can be a token, and a password on any scheme
 * (D-208; review round 10).
 */
export function credentialsIn(url: string): Credentials | null {
  const address = url.trim();
  const http = /^https?:\/\/[^/\s]*@/i.test(address);
  const password = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:[^/\s]*@/i.test(address);
  if (!http && !password) return null;
  return {
    kind: password ? "a password or token" : "a user name or token",
    address: address.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/i, "$1"),
  };
}

/**
 * A project as the API serves it: its address and its clone error without
 * credentials, which a project added before they were refused may hold. The
 * row keeps what was added: a fetch reads the clone's own remote, and Retry
 * clone now refuses the address, so such a project is deleted and added
 * again without them. `storedCredentials` says what it carries and the
 * address to add instead, so its screens can say what is still kept (audit
 * finding R3, D-223).
 */
export function withoutCredentials<T extends { gitUrl: string; cloneError: string | null }>(
  project: T,
): T & { storedCredentials: Credentials | null } {
  return {
    ...project,
    gitUrl: redactUrlCredentials(project.gitUrl),
    cloneError: project.cloneError === null ? null : redactUrlCredentials(project.cloneError),
    storedCredentials: credentialsIn(project.gitUrl),
  };
}

export class InvalidGitUrlError extends Error {
  readonly url: string;
  /** `whole` says it all, for a refusal that is not about git's use of it. */
  constructor(url: string, reason: string, whole?: string) {
    const said = redactUrlCredentials(url);
    super(whole ?? `"${said}" is not a usable git URL: ${reason}`);
    this.url = said;
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

  // The app stores no secrets: git signs in with this machine's credential
  // helper or SSH key. A token in the address was kept in the projects table,
  // shown on its pages and echoed in every git error (audit finding 2).
  // Any user on http(s), where a name alone can be a token; a password on
  // any scheme (review round 10: ssh://user:password@ was taken).
  const carried = credentialsIn(url);
  if (carried !== null) {
    throw new InvalidGitUrlError(
      rawUrl,
      "it carries credentials",
      `This address carries ${carried.kind}, which Trysquare would have to store. Add ` +
        `${carried.address} instead and let git's credential helper sign in, or use the ` +
        `repository's SSH address.`,
    );
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
 * Hosts where an address with and without `.git` reaches one repository
 * (measured 2026-10-18 with git ls-remote: GitHub answers both, GitLab
 * redirects the bare form). Elsewhere `app` and `app.git` can be two
 * repositories side by side.
 */
const OPTIONAL_DOT_GIT = new Set(["github.com", "gitlab.com"]);

/** A drive path, or a relative one written with backslashes. */
const WINDOWS_PATH = /^\/?[A-Za-z]:[\\/]|^\.{1,2}\\/;

/**
 * What two spellings of one repository's address share, so a repository
 * already added is known when it is typed again in a spelling folded here
 * (review of 5.5 to 5.7); `git@github.com:acme/app` and
 * `https://github.com/acme/app` stay two keys. Only what cannot tell two
 * repositories apart is folded: a trailing slash, the host's case, a Windows
 * path's slash direction and drive letter case, and `.git` on the hosts
 * above. Everything else is kept, so a doubt is a
 * duplicate missed rather than a second repository refused as the first:
 * the path's case, which GitHub and the Windows and macOS file system
 * defaults ignore but other servers and Linux do not, and a backslash
 * outside a Windows path, which is a character in a POSIX name. A path
 * shaped like a Windows one is read as Windows on every platform, so on
 * Linux and macOS `.\app` and `./app` share a key; they are two directories
 * only for a name that begins with `.\` or a drive letter (D-135).
 */
export function repositoryKey(url: string): string {
  const trimmed = url.trim();
  // Tested first: `C://repos/app` would otherwise read as a scheme.
  const withScheme = WINDOWS_PATH.test(trimmed)
    ? null
    : /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/\\]*)(.*)$/.exec(trimmed);
  let key: string;
  let host = "";
  if (withScheme) {
    const [, scheme = "", authority = "", path = ""] = withScheme;
    // The user before the @ is not folded: only a host name ignores case.
    const at = authority.lastIndexOf("@");
    host = authority.slice(at + 1).toLowerCase();
    key =
      scheme.toLowerCase() +
      authority.slice(0, at + 1) +
      host +
      (scheme.toLowerCase() === "file://" ? windowsPath(path) : path);
  } else if (SCP_LIKE.test(trimmed)) {
    const at = trimmed.indexOf("@");
    const colon = trimmed.indexOf(":", at);
    host = trimmed.slice(at + 1, colon).toLowerCase();
    key = trimmed.slice(0, at + 1) + host + trimmed.slice(colon);
  } else {
    key = windowsPath(trimmed);
  }
  key = key.replace(/\/+$/, "");
  return OPTIONAL_DOT_GIT.has(host.replace(/:\d+$/, ""))
    ? key.replace(/\.git$/, "").replace(/\/+$/, "")
    : key;
}

/** Windows reads either slash, and a drive letter in either case. */
function windowsPath(path: string): string {
  if (!WINDOWS_PATH.test(path)) return path;
  return path
    .replace(/\\/g, "/")
    .replace(
      /^(\/?)([A-Za-z]):/,
      (_match, slash: string, drive: string) => `${slash}${drive.toLowerCase()}:`,
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

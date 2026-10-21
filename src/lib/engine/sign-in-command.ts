/**
 * The command a person runs to sign in the CLI reviews use, and where to run
 * it (MVP 6.3, D-159).
 *
 * Shown, never run: this app starts the CLI with read-only tools alone, and
 * whether its login flow runs without a terminal is unknown (MG-7). With no
 * path configured, `npm run claude` from the project directory resolves the
 * CLI as a review does. A configured CLI gets its own command, by the path
 * it resolved to: the script never reads a path kept on Settings, the
 * variable the server was started with may not be set in the person's
 * terminal (D-152), and a relative path or a bare name is found from the
 * server's directory and PATH, not the terminal's (review of the 6.2 and 6.3
 * changes).
 *
 * Quoted singly, so a shell expands nothing in the path. On Windows the
 * command is PowerShell's, Windows' own terminal: cmd.exe and Git Bash take
 * neither its & nor its quoting.
 */

const NODE_SCRIPT = /\.(mjs|cjs|js)$/i;

export type SignInPlace = "projectDirectory" | "powerShell" | "terminal";

export interface SignIn {
  command: string;
  place: SignInPlace;
}

export function signInCommand(claudePath: string | undefined, platform: string): SignIn {
  if (claudePath === undefined) {
    return { command: "npm run claude -- auth login", place: "projectDirectory" };
  }
  const windows = platform === "win32";
  // PowerShell doubles a single quote inside single quotes, and takes the
  // four curly ones for it too (measured on 5.1.26100); a POSIX shell closes
  // the quote, escapes one and opens it again.
  const quoted = windows
    ? `'${claudePath.replace(/['\u2018-\u201b]/g, (quote) => quote + quote)}'`
    : `'${claudePath.replace(/'/g, "'\\''")}'`;
  const place = windows ? "powerShell" : "terminal";
  if (NODE_SCRIPT.test(claudePath)) return { command: `node ${quoted} auth login`, place };
  return { command: windows ? `& ${quoted} auth login` : `${quoted} auth login`, place };
}

/** Where to run it, as a sentence goes on: "Sign it in <these words>". */
export function signInPlaceWords(place: SignInPlace): string {
  switch (place) {
    case "projectDirectory":
      return "from a terminal, in this project's directory";
    case "powerShell":
      return "in PowerShell";
    case "terminal":
      return "from a terminal";
  }
}

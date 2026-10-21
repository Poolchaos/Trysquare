/** The command Settings shows to sign in the CLI reviews use (MVP 6.3). */

import { describe, expect, it } from "vitest";
import { signInCommand } from "@/lib/engine/sign-in-command";

describe("the sign-in command", () => {
  it("is npm run claude where no path is configured", () => {
    expect(signInCommand(undefined, "win32")).toBe("npm run claude -- auth login");
    expect(signInCommand(undefined, "linux")).toBe("npm run claude -- auth login");
  });

  it("runs a configured program by its own path, with PowerShell's & on Windows", () => {
    expect(signInCommand("C:\\Tools\\claude.exe", "win32")).toBe(
      '& "C:\\Tools\\claude.exe" auth login',
    );
    expect(signInCommand("/opt/claude/bin/claude", "darwin")).toBe(
      '"/opt/claude/bin/claude" auth login',
    );
  });

  it("runs a configured script under Node", () => {
    expect(signInCommand("/opt/claude/cli.mjs", "linux")).toBe(
      'node "/opt/claude/cli.mjs" auth login',
    );
    expect(signInCommand("C:\\claude\\cli.JS", "win32")).toBe(
      'node "C:\\claude\\cli.JS" auth login',
    );
  });
});

/** The command Settings shows to sign in the CLI reviews use (MVP 6.3). */

import { describe, expect, it } from "vitest";
import { signInCommand, signInPlaceWords } from "@/lib/engine/sign-in-command";

describe("the sign-in command", () => {
  it("is npm run claude, in the project directory, where no path is configured", () => {
    for (const platform of ["win32", "linux"]) {
      expect(signInCommand(undefined, platform)).toEqual({
        command: "npm run claude -- auth login",
        place: "projectDirectory",
      });
    }
  });

  it("runs a configured program by its path, in PowerShell on Windows", () => {
    expect(signInCommand("C:\\Program Files\\claude\\claude.exe", "win32")).toEqual({
      command: "& 'C:\\Program Files\\claude\\claude.exe' auth login",
      place: "powerShell",
    });
    expect(signInCommand("C:\\Tools\\claude.cmd", "win32").command).toBe(
      "& 'C:\\Tools\\claude.cmd' auth login",
    );
    expect(signInCommand("/opt/claude/bin/claude", "darwin")).toEqual({
      command: "'/opt/claude/bin/claude' auth login",
      place: "terminal",
    });
  });

  it("runs a configured script under Node", () => {
    expect(signInCommand("/opt/claude/cli.mjs", "linux").command).toBe(
      "node '/opt/claude/cli.mjs' auth login",
    );
    expect(signInCommand("C:\\claude\\cli.JS", "win32")).toEqual({
      command: "node 'C:\\claude\\cli.JS' auth login",
      place: "powerShell",
    });
  });

  it("quotes a path so no shell expands it, a quote in it included", () => {
    // Double quotes let PowerShell and POSIX shells expand $ and backticks,
    // and a double quote in a POSIX path broke the command (review of the
    // 6.2 and 6.3 changes).
    expect(signInCommand("/home/x/$HOME's/claude", "linux").command).toBe(
      "'/home/x/$HOME'\\''s/claude' auth login",
    );
    expect(signInCommand("C:\\it's\\claude.exe", "win32").command).toBe(
      "& 'C:\\it''s\\claude.exe' auth login",
    );
  });

  it("says where to run it", () => {
    expect(signInPlaceWords("projectDirectory")).toBe(
      "from a terminal, in this project's directory",
    );
    expect(signInPlaceWords("powerShell")).toBe("in PowerShell");
    expect(signInPlaceWords("terminal")).toBe("from a terminal");
  });
});

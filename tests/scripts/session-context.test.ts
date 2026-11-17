/**
 * The session meter (CLAUDE.md section 10, D-230), run as a session runs it:
 * its output and exit code over transcripts written here. It must read the
 * newest request of the session itself, say the handover at 450,000 and not
 * before, and refuse rather than report a session it could not measure.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const METER = resolve("scripts", "session-context.mjs");
const SESSION = "0a1b2c3d-0000-4000-8000-000000000001";

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "trysquare-session-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

interface Usage {
  input: number;
  created?: number;
  read?: number;
}

function assistant(usage: Usage, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: false,
    message: {
      role: "assistant",
      usage: {
        input_tokens: usage.input,
        ...(usage.created === undefined ? {} : { cache_creation_input_tokens: usage.created }),
        ...(usage.read === undefined ? {} : { cache_read_input_tokens: usage.read }),
        output_tokens: 900,
      },
    },
    ...extra,
  });
}

const USER = JSON.stringify({ type: "user", message: { role: "user", content: "next" } });

function transcript(lines: string[], session = SESSION): string {
  const folder = join(configDir, "projects", "-some-project");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${session}.jsonl`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

/** The meter with this test's config folder, and no session of its own unless given. */
function meter(args: string[], sessionId?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId !== undefined) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync(process.execPath, [METER, ...args], { env, encoding: "utf8" });
}

describe("the session meter", () => {
  it("reads the context of the newest request, and leaves a subagent's out", () => {
    const file = transcript([
      assistant({ input: 10, created: 20, read: 30 }),
      USER,
      assistant({ input: 2, created: 1_000, read: 170_000 }),
      assistant({ input: 5, created: 5, read: 480_000 }, { isSidechain: true }),
    ]);

    const result = meter(["--transcript", file]);

    expect(result.stdout).toContain(
      `Session ${SESSION}: 171,002 context tokens of 500,000 (34%). Handover starts at 450,000.`,
    );
    expect(result.stdout).not.toContain("HANDOVER DUE");
    expect(result.status).toBe(0);
  });

  it("says the handover is due at 450,000, and not one token before", () => {
    const below = meter(["--transcript", transcript([assistant({ input: 449_999 })], "below")]);
    expect(below.stdout).toContain("449,999 context tokens");
    expect(below.stdout).not.toContain("HANDOVER DUE");
    expect(below.status).toBe(0);

    const at = meter([
      "--transcript",
      transcript([assistant({ input: 4, created: 6, read: 449_990 })], "at"),
    ]);
    expect(at.stdout).toContain("450,000 context tokens of 500,000 (90%)");
    expect(at.stdout).toContain("HANDOVER DUE: start nothing new.");
    expect(at.stdout).toContain("run /clear and start a new session");
    expect(at.status).toBe(1);
  });

  it("finds the transcript of the session it runs in", () => {
    transcript([assistant({ input: 1, read: 99 })], "another-session");
    transcript([assistant({ input: 3, read: 1_200 })]);

    const result = meter([], SESSION);

    expect(result.stdout).toContain(`Session ${SESSION}: 1,203 context tokens`);
    expect(result.status).toBe(0);
  });

  it("refuses a session whose transcript it cannot find", () => {
    transcript([assistant({ input: 3 })], "another-session");

    const result = meter([], SESSION);

    expect(result.stderr).toContain(`no transcript for session ${SESSION}`);
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
  });

  it("refuses to guess a session when it is told none", () => {
    transcript([assistant({ input: 3 })]);

    const result = meter([]);

    expect(result.stderr).toContain("CLAUDE_CODE_SESSION_ID is not set");
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
  });

  it("refuses a transcript with no request in it, rather than reading it as empty", () => {
    const file = transcript([USER, JSON.stringify({ type: "ai-title", title: "x" })]);

    const result = meter(["--transcript", file]);

    expect(result.stderr).toContain("holds no request with its token usage");
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
  });

  it("takes an entry of zeros, written for a failed request, as no reading", () => {
    const file = transcript([
      assistant({ input: 2, read: 80_000 }),
      assistant({ input: 0, created: 0, read: 0 }, { isApiErrorMessage: true }),
    ]);

    const result = meter(["--transcript", file]);

    expect(result.stdout).toContain("80,002 context tokens");
    expect(result.status).toBe(0);
  });

  it("says a line it could not read, and still gives the newest reading it could", () => {
    const whole = assistant({ input: 2, read: 60_000 });
    const cutShort = assistant({ input: 2, read: 90_000 }).slice(0, -20);
    const file = transcript([whole, cutShort]);

    const result = meter(["--transcript", file]);

    expect(result.stdout).toContain("60,002 context tokens");
    expect(result.stdout).toContain("1 line(s) of the transcript could not be read as JSON");
    expect(result.status).toBe(0);
  });

  it("holds the limit and the handover point the charter states", () => {
    const charter = readFileSync(resolve("CLAUDE.md"), "utf8");
    const result = meter(["--transcript", transcript([assistant({ input: 1 })])]);

    for (const figure of ["500,000", "450,000"]) {
      expect(charter).toContain(figure);
      expect(result.stdout).toContain(figure);
    }
  });
});

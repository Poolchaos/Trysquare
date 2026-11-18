/**
 * The email this machine's git commits as, read from the person's own global
 * config (WP-L, D-243). Against the real git binary, with a config file of the
 * test's own standing in for the person's.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { globalUserEmail } from "@/server/gitops/identity";
import { GitCommandError } from "@/server/gitops/run";

let dir: string;
let previous: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-identity-"));
  previous = process.env.GIT_CONFIG_GLOBAL;
});

afterEach(() => {
  if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previous;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function globalConfig(name: string, text: string | null): void {
  const path = join(dir, name);
  if (text !== null) writeFileSync(path, text);
  process.env.GIT_CONFIG_GLOBAL = path;
}

describe("the email git commits as", () => {
  it("is the user.email of the global config", async () => {
    globalConfig("set", "[user]\n\tname = Me\n\temail = me@example.invalid\n");
    expect(await globalUserEmail()).toBe("me@example.invalid");
  });

  it("is read through a file the global config includes", async () => {
    writeFileSync(join(dir, "identity"), "[user]\n\temail = included@example.invalid\n");
    // Relative to the file that includes it: a Windows path written here
    // whole is a bad config line, its backslashes being git's escapes
    // (CI run 44248872821).
    globalConfig("including", "[include]\n\tpath = identity\n");
    expect(await globalUserEmail()).toBe("included@example.invalid");
  });

  it("is none when the config sets no email", async () => {
    globalConfig("nameless", "[user]\n\tname = Me\n");
    expect(await globalUserEmail()).toBeNull();
  });

  it("is none when the email is set to nothing", async () => {
    globalConfig("blank", "[user]\n\temail =\n");
    expect(await globalUserEmail()).toBeNull();
  });

  it("is none when there is no global config at all", async () => {
    globalConfig("absent", null);
    expect(await globalUserEmail()).toBeNull();
  });

  it("fails in git's own words when the config cannot be read", async () => {
    globalConfig("broken", "[user\n");
    const failure = await globalUserEmail().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GitCommandError);
    expect((failure as GitCommandError).exitCode).toBe(128);
    expect((failure as GitCommandError).message).toContain("bad config line 1");
  });
});

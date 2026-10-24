/**
 * The environment a project's own commands get (WP-I): the person's, less
 * the app's and Claude's.
 */

import { describe, expect, it } from "vitest";
import { projectCommandEnv } from "@/lib/projects/command-env";

describe("a project command's environment", () => {
  it("keeps the person's and withholds the app's and Claude's", () => {
    expect(
      projectCommandEnv({
        PATH: "/usr/bin",
        HOME: "/home/me",
        NPM_CONFIG_REGISTRY: "https://registry.example",
        UNSET: undefined,
        TRYSQUARE_DATA: "/data",
        FAKE_CLAUDE_SCENARIO: "script",
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        ANTHROPIC_API_KEY: "sk-test",
        anthropic_base_url: "lower case too",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      NPM_CONFIG_REGISTRY: "https://registry.example",
    });
  });
});

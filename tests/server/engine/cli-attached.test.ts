/**
 * `npm run claude`, the sign-in the app tells people to run, runs the CLI
 * attached to their terminal (MVP 6.3). It got the closed environment of a
 * review (b3fb1ef), without the terminal and display variables the 2.1.306
 * binary reads to decide whether to open a browser (review of D-174's
 * changes). Asked of spawnSync, so nothing is started.
 */

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn(() => ({ status: 0 })) }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync,
}));

const SET = {
  DISPLAY: ":0",
  TERM: "xterm-256color",
  BROWSER: "firefox",
  ANTHROPIC_API_KEY: "sk-ant-for-this-test",
};

afterEach(() => {
  for (const name of Object.keys(SET)) delete process.env[name];
  spawnSync.mockClear();
});

describe("the sign-in run", () => {
  it("keeps the terminal and display the CLI opens a browser through, and no key", async () => {
    Object.assign(process.env, SET);
    const { runCliAttached } = await import("@/server/engine/cli");
    expect(runCliAttached(["auth", "login"], FAKE_CLI)).toBe(0);
    const env = (spawnSync.mock.calls[0] as unknown[])[2] as { env: Record<string, string> };
    expect(env.env).toMatchObject({ DISPLAY: ":0", TERM: "xterm-256color", BROWSER: "firefox" });
    expect("ANTHROPIC_API_KEY" in env.env).toBe(false);
  });
});

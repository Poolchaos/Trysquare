/**
 * The CLI path kept in Settings (MVP 6.1, D-152).
 *
 * The path came only from TRYSQUARE_CLAUDE_PATH, read once when the server
 * started. Now it can be kept in Settings, the variable still winning, and it
 * is read when it is needed, so a saved path is the one the next check uses.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let dataDir: string;
let routes: {
  settings: typeof import("@/app/api/settings/route");
  auth: typeof import("@/app/api/auth/route");
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-claude-path-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once.
  process.env.TRYSQUARE_DATA = dataDir;
  routes = {
    settings: await import("@/app/api/settings/route"),
    auth: await import("@/app/api/auth/route"),
  };
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

afterEach(async () => {
  delete process.env.TRYSQUARE_CLAUDE_PATH;
  delete process.env.FAKE_CLAUDE_AUTH_STATUS;
  await save({ claudePath: "" });
});

function save(body: object): Promise<Response> {
  return routes.settings.PUT(
    new Request("http://local/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  );
}

async function read(): Promise<{
  settings: Record<string, unknown>;
  environment: { claudePath: string | null };
}> {
  return (await routes.settings.GET()).json();
}

interface Answered {
  state: string;
  path?: string;
  message?: string;
}

async function cliState(): Promise<Answered> {
  return ((await (await routes.auth.GET()).json()) as { cli: Answered }).cli;
}

describe("the CLI path kept in Settings", () => {
  it("is kept trimmed, and read back with the variable's path beside it", async () => {
    expect((await save({ claudePath: "  /opt/claude/bin/claude  " })).status).toBe(200);
    expect(await read()).toMatchObject({
      settings: { claudePath: "/opt/claude/bin/claude" },
      environment: { claudePath: null },
    });
    process.env.TRYSQUARE_CLAUDE_PATH = " /from/the/environment ";
    expect((await read()).environment.claudePath).toBe("/from/the/environment");
  });

  it("is refused holding a line break, or not being text", async () => {
    for (const claudePath of ["/opt/claude\nEngine: forged", 42]) {
      const response = await save({ claudePath });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("Invalid");
    }
    expect((await read()).settings.claudePath).toBe("");
  });

  it("is the one the next check asks, with no restart", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      subscriptionType: "max",
    });
    await save({ claudePath: "no-such-claude-anywhere" });
    expect((await cliState()).state).toBe("notFound");
    await save({ claudePath: FAKE_CLI });
    expect(await cliState()).toMatchObject({ state: "subscription", path: FAKE_CLI });
  }, 30_000);

  it("gives way to TRYSQUARE_CLAUDE_PATH", async () => {
    await save({ claudePath: FAKE_CLI });
    process.env.TRYSQUARE_CLAUDE_PATH = "no-such-claude-anywhere";
    // The name asked for, not merely some CLI not found: the bundled one
    // refused by the suite's guard once passed for this (review of the 6.1
    // changes).
    expect(await cliState()).toMatchObject({
      state: "notFound",
      message: expect.stringMatching(/no-such-claude-anywhere/),
    });
  }, 30_000);
});

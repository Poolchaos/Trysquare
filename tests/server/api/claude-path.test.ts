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

  it("answers as every review reads, with no settings, interactive ones too", async () => {
    // An apiKeyHelper only the person's settings hold is no review's sign-in:
    // a headless review reads no settings (D-124), and an interactive
    // review's commands read none either (D-174).
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
    });
    process.env.FAKE_CLAUDE_AUTH_STATUS_FROM_SETTINGS = JSON.stringify({
      loggedIn: true,
      authMethod: "api_key_helper",
    });
    try {
      await save({ claudePath: FAKE_CLI });
      expect((await cliState()).state).toBe("subscription");
    } finally {
      delete process.env.FAKE_CLAUDE_AUTH_STATUS_FROM_SETTINGS;
    }
  }, 30_000);

  it("comes with the command that signs in the CLI it names (MVP 6.3)", async () => {
    const signIn = async () =>
      ((await (await routes.auth.GET()).json()) as { signIn: { command: string; place: string } })
        .signIn;
    expect(await signIn()).toEqual({
      command: "npm run claude -- auth login",
      place: "projectDirectory",
    });
    await save({ claudePath: FAKE_CLI });
    expect((await signIn()).command).toBe(`node '${FAKE_CLI}' auth login`);
    // A relative path is named as it resolved, from the server's directory:
    // typed as kept, it was found from wherever the person's terminal was
    // (review of the 6.2 and 6.3 changes).
    await save({ claudePath: join("tests", "fixtures", "fake-claude.mjs") });
    expect((await signIn()).command).toBe(`node '${FAKE_CLI}' auth login`);
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

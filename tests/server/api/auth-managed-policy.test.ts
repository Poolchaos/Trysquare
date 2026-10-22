/**
 * The CLI check carries the machine's managed Claude Code policy, for the
 * pages to warn of before a review starts and on Settings (D-174 item 3).
 * Where it is looked for is the detector's own test; here, that the answer
 * reaches the page whole, what could not be looked at included.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const { findManagedPolicy } = vi.hoisted(() => ({ findManagedPolicy: vi.fn() }));
vi.mock("@/server/engine/managed-policy", () => ({ findManagedPolicy }));

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-auth-policy-"));
  process.env.TRYSQUARE_DATA = dataDir;
  process.env.TRYSQUARE_CLAUDE_PATH = FAKE_CLI;
  process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "max",
  });
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
  delete process.env.TRYSQUARE_CLAUDE_PATH;
  delete process.env.FAKE_CLAUDE_AUTH_STATUS;
});

describe("the CLI check", () => {
  it("carries the managed policy found, and where it could not look", async () => {
    const policy = {
      found: [String.raw`C:\Program Files\ClaudeCode\managed-settings.json`],
      unchecked: [
        String.raw`HKCU\SOFTWARE\Policies\ClaudeCode\Settings: reg.exe did not answer in time`,
      ],
    };
    findManagedPolicy.mockResolvedValue(policy);
    const { GET } = await import("@/app/api/auth/route");
    const body = (await (await GET()).json()) as { cli: { state: string }; managedPolicy: unknown };
    expect(body.cli.state).toBe("subscription");
    expect(body.managedPolicy).toEqual(policy);
  }, 30_000);
});

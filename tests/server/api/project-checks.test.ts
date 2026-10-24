/**
 * A project's own checks, as a person sets them (proof-and-steps plan, WP-I
 * step 1; D-191, D-192): off until turned on, kept whole, and refused with a
 * reason a person can act on.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-checks-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

let made = 0;
async function aProject() {
  const { db } = (await import("@/server/runtime")).runtime();
  const { createProject } = await import("@/server/db/repositories/projects");
  made += 1;
  const project = createProject(db, {
    name: `app-${made}`,
    gitUrl: `git@example.com:acme/app-${made}.git`,
    defaultBranch: "main",
    clonePath: join(dataDir, "projects", `app-${made}`, "repo.git"),
  });
  return { db, id: project.id };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(id: string) {
  const { GET } = await import("@/app/api/projects/[id]/checks/route");
  return GET(new Request("http://localhost/x"), params(id));
}

async function put(id: string, body: unknown) {
  const { PUT } = await import("@/app/api/projects/[id]/checks/route");
  return PUT(
    new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }),
    params(id),
  );
}

const full = {
  enabled: true,
  installCommand: "npm ci",
  testCommand: "npm test",
  e2eCommand: "npm run e2e",
  screenshotDir: "review/screens",
  designStandardPath: "docs/04-UI-DESIGN.md",
};

describe("a project's own checks", () => {
  it("are off for a project that never set them", async () => {
    const { id } = await aProject();
    const response = await read(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checks: {
        enabled: false,
        installCommand: null,
        testCommand: null,
        e2eCommand: null,
        screenshotDir: null,
        designStandardPath: null,
      },
    });
  });

  it("keep what was set, trimmed, a blank field as none", async () => {
    const { id } = await aProject();
    const saved = await put(id, {
      ...full,
      installCommand: "  ",
      testCommand: "  npm test  ",
      designStandardPath: "",
    });
    expect(saved.status).toBe(200);
    const expected = {
      ...full,
      installCommand: null,
      testCommand: "npm test",
      designStandardPath: null,
    };
    expect(await saved.json()).toEqual({ checks: expected });
    expect(await (await read(id)).json()).toEqual({ checks: expected });

    // Turned off again, the commands are kept for the next time.
    await put(id, { ...expected, enabled: false });
    expect((await (await read(id)).json()).checks).toEqual({ ...expected, enabled: false });
  });

  it("are refused on, with nothing to run", async () => {
    const { id } = await aProject();
    const response = await put(id, {
      ...full,
      testCommand: null,
      e2eCommand: null,
      screenshotDir: null,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "enabled: Give a test command, an e2e command or both before turning the checks on.",
    );
  });

  it("take screenshots only from an e2e command, and need its folder (D-192)", async () => {
    const { id } = await aProject();
    const noFolder = await put(id, { ...full, screenshotDir: "" });
    expect(noFolder.status).toBe(400);
    expect((await noFolder.json()).error).toBe(
      "screenshotDir: An e2e command and the folder it saves screenshots to go together.",
    );
    const noCommand = await put(id, { ...full, e2eCommand: null });
    expect((await noCommand.json()).error).toBe(
      "e2eCommand: An e2e command and the folder it saves screenshots to go together.",
    );
    // Tests alone, no e2e: no screenshots, nothing to grade.
    const testsOnly = await put(id, { ...full, e2eCommand: null, screenshotDir: null });
    expect(testsOnly.status).toBe(200);
  });

  it("name only places inside the repository", async () => {
    const { id } = await aProject();
    for (const outside of [
      "../screens",
      "screens/../../etc",
      "/tmp/screens",
      "C:\\screens",
      "\\\\host\\x",
    ]) {
      const response = await put(id, { ...full, screenshotDir: outside });
      expect(response.status, outside).toBe(400);
      expect((await response.json()).error).toContain(
        "screenshotDir: A path inside the repository",
      );
    }
    const standard = await put(id, { ...full, designStandardPath: "../design.md" });
    expect((await standard.json()).error).toContain(
      "designStandardPath: A path inside the repository",
    );
  });

  it("refuse a command over more than one line", async () => {
    const { id } = await aProject();
    const response = await put(id, { ...full, testCommand: "npm test\nrm -rf ~" });
    expect((await response.json()).error).toBe("testCommand: A command is one line.");
  });

  it("refuse a field the checks do not have, and a project that is not there", async () => {
    const { id } = await aProject();
    expect((await put(id, { ...full, shell: "bash" })).status).toBe(400);
    expect((await put("01NOPROJECT00000000000000", full)).status).toBe(404);
    expect((await read("01NOPROJECT00000000000000")).status).toBe(404);
  });

  it("go with the project when it is deleted", async () => {
    const { db, id } = await aProject();
    await put(id, full);
    const { deleteProject } = await import("@/server/db/repositories/projects");
    const { getProjectChecks } = await import("@/server/db/repositories/project-checks");
    deleteProject(db, id);
    expect(getProjectChecks(db, id).enabled).toBe(false);
    const { projectChecks } = await import("@/server/db/schema");
    expect(
      db
        .select()
        .from(projectChecks)
        .all()
        .some((row) => row.projectId === id),
    ).toBe(false);
  });
});

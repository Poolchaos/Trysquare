/**
 * Mode B, the engine that runs in someone else's terminal.
 *
 * The thing worth proving is that it is not a looser review: the same schema
 * refuses the same answers, a missing answer is a failure rather than a wait
 * forever, and a cancel stops the waiting. The prompt file matters too, since
 * it is the entire interface a person is handed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerPathFor,
  createInteractiveEngine,
  launchCommandFor,
  promptPathFor,
} from "@/server/engine/interactive";
import { StageFailedError } from "@/server/engine/headless";
import { StageOutputUnreadableError } from "@/server/review/engine-runner";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-interactive-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function engine(options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return createInteractiveEngine({
    exchangeDir: join(dir, "bundle"),
    worktreeRoot: join(dir, "worktree"),
    model: "claude-fable-5[1m]",
    directives: [],
    rules: [],
    timeoutMs: options.timeoutMs ?? 5_000,
    pollMs: 25,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

const ask = { stage: "s1_risk" as const, systemPrompt: "You are a reviewer.", prompt: "Assess." };

/** Writes the answer a moment after the engine starts waiting for it. */
function answerLater(contents: string, afterMs = 60): void {
  setTimeout(() => {
    writeFileSync(answerPathFor(join(dir, "bundle"), "s1_risk"), contents, "utf8");
  }, afterMs);
}

describe("the file a person is handed", () => {
  it("writes one document carrying the rules, the question and where to reply", async () => {
    answerLater(JSON.stringify({ files: [] }));
    await engine().run(ask);

    const prompt = readFileSync(promptPathFor(join(dir, "bundle"), "s1_risk"), "utf8");
    expect(prompt).toContain("You are a reviewer.");
    expect(prompt).toContain("Assess.");
    // Where the answer goes, or the exchange has no second half.
    expect(prompt).toContain(answerPathFor(join(dir, "bundle"), "s1_risk"));
    // The checkout is read-only and the review verifies against those bytes.
    expect(prompt).toContain("Do not edit anything in it");
  });

  it("quotes the paths in its launch command, because a data directory can have spaces", () => {
    // This repository's own path has one, which is how the gate learned to
    // care: an unquoted path here would hand someone a command that runs in
    // the wrong directory or not at all.
    const command = launchCommandFor("/tmp/a b/s1_risk-prompt.md", "m", "/tmp/a b/worktree");
    expect(command).toContain('"/tmp/a b/s1_risk-prompt.md"');
    expect(command).toContain('"/tmp/a b/worktree"');
  });
});

describe("the answer it accepts", () => {
  it("returns a valid answer and charges nothing for it", async () => {
    // The tokens were spent in someone else's session. Estimating them would
    // corrupt the one number the user makes decisions with.
    answerLater(JSON.stringify({ files: [{ path: "app/x.ts", riskTags: [], reason: "ok" }] }));

    const response = await engine().run(ask);
    expect(response.output).toEqual({
      files: [{ path: "app/x.ts", riskTags: [], reason: "ok" }],
    });
    expect(response.usage?.inputTokens).toBe(0);
    expect(response.usage?.costEquivalentUsd).toBe(0);
  });

  it("refuses an answer that does not match the stage schema", async () => {
    // The same schema as Mode A. A second engine that accepted looser answers
    // would be a second, weaker product wearing the same name.
    answerLater(JSON.stringify({ files: [{ path: "app/x.ts" }] }));
    await expect(engine().run(ask)).rejects.toBeInstanceOf(StageOutputUnreadableError);
  });

  it("refuses an answer that is not JSON at all", async () => {
    answerLater("I had a look and it seems fine to me");
    await expect(engine().run(ask)).rejects.toBeInstanceOf(StageOutputUnreadableError);
  });

  it("ignores a file caught mid-write rather than failing on it", async () => {
    // A reader that treated an empty file as an answer would fail the stage
    // over its own timing instead of the writer's content.
    const answerPath = answerPathFor(join(dir, "bundle"), "s1_risk");
    setTimeout(() => writeFileSync(answerPath, "", "utf8"), 40);
    setTimeout(() => writeFileSync(answerPath, JSON.stringify({ files: [] }), "utf8"), 120);

    await expect(engine({ timeoutMs: 5_000 }).run(ask)).resolves.toMatchObject({
      output: { files: [] },
    });
  });
});

describe("when no answer comes", () => {
  it("gives up rather than waiting forever, and says where it was looking", async () => {
    // A hang is a failure, not a wait (01 section 6).
    await expect(engine({ timeoutMs: 150 }).run(ask)).rejects.toThrow(/No answer appeared at/);
    await expect(engine({ timeoutMs: 150 }).run(ask)).rejects.toBeInstanceOf(StageFailedError);
  });

  it("stops waiting the moment the review is cancelled", async () => {
    const controller = new AbortController();
    const running = engine({ timeoutMs: 60_000, signal: controller.signal }).run(ask);
    setTimeout(() => controller.abort(), 50);

    // Without this the cancel would be noticed only when the stage timeout
    // expired, which for a person-paced stage is twenty minutes away.
    await expect(running).rejects.toThrow(/cancelled/i);
  });
});

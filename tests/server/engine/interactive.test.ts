/**
 * Mode B, the engine that runs in someone else's terminal.
 *
 * The thing worth proving is that it is not a looser review: the same schema
 * refuses the same answers, a missing answer is a failure rather than a wait
 * forever, and a cancel stops the waiting. The prompt file matters too, since
 * it is the entire interface a person is handed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInteractiveEngine,
  exchangeFilesFor,
  launchArgsFor,
  launchCommandsFor,
} from "@/server/engine/interactive";
import { StageFailedError } from "@/server/engine/headless";
import { StageOutputUnreadableError } from "@/server/review/engine-runner";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let dir: string;
let calls: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-interactive-"));
  calls = 0;
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
    claudePath: FAKE_CLI,
    // c1, c2, ... in call order, so a test can name the files a call will use.
    newCallId: () => `c${(calls += 1)}`,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

const ask = { stage: "s1_risk" as const, systemPrompt: "You are a reviewer.", prompt: "Assess." };

const filesOf = (callId: string, batch?: number, stage: "s1_risk" | "s3_adversarial" = "s1_risk") =>
  exchangeFilesFor(join(dir, "bundle"), stage, batch, callId);

/**
 * Writes an answer once its call's prompt exists, the way a person would: the
 * folder is created by the engine, so writing on a fixed delay raced it.
 */
function answerLater(contents: string, afterMs = 60, path = filesOf("c1").answer): void {
  const prompt = path.replace(/-output\.json$/, "-prompt.md");
  const started = Date.now();
  const attempt = () => {
    if (existsSync(prompt) && Date.now() - started >= afterMs) {
      writeFileSync(path, contents, "utf8");
    } else {
      setTimeout(attempt, 10);
    }
  };
  attempt();
}

describe("the file a person is handed", () => {
  it("writes one document carrying the rules, the question and where to reply", async () => {
    answerLater(JSON.stringify({ files: [] }));
    await engine().run(ask);

    const prompt = readFileSync(filesOf("c1").prompt, "utf8");
    expect(prompt).toContain("You are a reviewer.");
    expect(prompt).toContain("Assess.");
    // Where the answer goes, or the exchange has no second half.
    expect(prompt).toContain(filesOf("c1").answer);
    // The checkout is read-only and the review verifies against those bytes.
    expect(prompt).toContain("Do not edit anything in it");
  });

  it("puts the instructions in their own file for the session's system prompt", async () => {
    answerLater(JSON.stringify({ files: [] }));
    await engine().run(ask);
    expect(readFileSync(filesOf("c1").system, "utf8")).toBe("You are a reviewer.");
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
    const answerPath = filesOf("c1").answer;
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

describe("one call's files belong to that call", () => {
  it("does not hand a second batch the first batch's answer", async () => {
    // S3 asks several questions under one stage name. Named by stage alone,
    // batch 2 read batch 1's answer straight back.
    const adversarial = (batchNumber: number) => ({
      stage: "s3_adversarial" as const,
      systemPrompt: "Rules.",
      prompt: `Batch ${batchNumber}.`,
      batchNumber,
      batchCount: 2,
    });
    const answer = JSON.stringify({ findings: [], clearedHunks: [], sweepDispositions: [] });
    const reviewer = engine();
    answerLater(answer, 40, filesOf("c1", 1, "s3_adversarial").answer);
    await reviewer.run(adversarial(1));

    answerLater(answer, 150, filesOf("c2", 2, "s3_adversarial").answer);
    const started = Date.now();
    await reviewer.run(adversarial(2));
    // Waited for its own file rather than reading the one already on disk.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(readFileSync(filesOf("c2", 2, "s3_adversarial").prompt, "utf8")).toContain("Batch 2.");
    expect(readFileSync(filesOf("c1", 1, "s3_adversarial").prompt, "utf8")).toContain("Batch 1.");
  });

  it("ignores an answer an earlier attempt left behind", async () => {
    mkdirSync(join(dir, "bundle"), { recursive: true });
    writeFileSync(filesOf("earlier").answer, JSON.stringify({ files: [] }), "utf8");
    await expect(engine({ timeoutMs: 200 }).run(ask)).rejects.toThrow(/No answer appeared at/);
  });

  it("tells the person the command and the CLI version it needs, starting nothing itself", async () => {
    // Mode B spawns nothing, a version check included: it names the CLI and
    // says what the command needs, and the person runs it.
    const said: string[] = [];
    const reviewer = createInteractiveEngine({
      exchangeDir: join(dir, "bundle"),
      worktreeRoot: join(dir, "worktree"),
      model: "m",
      directives: [],
      rules: [],
      timeoutMs: 5_000,
      pollMs: 25,
      claudePath: FAKE_CLI,
      newCallId: () => "c1",
      onEvent: (_stage, event) => {
        if (event.kind === "text") said.push(event.text);
      },
    });
    answerLater(JSON.stringify({ files: [] }));
    await reviewer.run(ask);

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("Set-Location -LiteralPath");
    expect(said[0]).toContain("fake-claude.mjs");
    expect(said[0]).toContain("2.1.301 or newer");
    expect(said[0]).toContain(filesOf("c1").answer);
  });
});

describe("the command a person is given", () => {
  const exchangeDir = "/data dir/it's";
  const files = {
    prompt: `${exchangeDir}/s1_risk-c1-prompt.md`,
    system: `${exchangeDir}/s1_risk-c1-system.md`,
    answer: `${exchangeDir}/s1_risk-c1-output.json`,
  };
  const args = launchArgsFor({ model: "claude-fable-5[1m]", exchangeDir, files });

  it("starts the session isolated the way a headless stage is", () => {
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("user");
    expect(args[args.indexOf("--system-prompt-file") + 1]).toBe(files.system);
    expect(args[args.indexOf("--add-dir") + 1]).toBe(exchangeDir);
    // Options end before the one positional argument, since --add-dir and
    // --tools would otherwise take it as one of their values.
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toContain(files.prompt);
  });

  /** A stand-in CLI that reports what it was given, to check shell quoting. */
  function standIn() {
    const script = join(dir, "argv.mjs");
    writeFileSync(
      script,
      "process.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));",
    );
    const worktree = join(dir, "work tree's");
    mkdirSync(worktree);
    return {
      cli: { command: process.execPath, prefixArgs: [script], display: script },
      worktree,
    };
  }
  const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
  const powershell = ["pwsh", "powershell"].find(
    (shell) => spawnSync(shell, ["-NoProfile", "-Command", "exit 0"]).status === 0,
  );

  // Each runs wherever its shell exists: bash always under ./verify.sh,
  // PowerShell on Windows. A machine without one skips only that one.
  it.runIf(bash)("reaches the CLI intact through bash, spaces and quotes included", () => {
    const { cli, worktree } = standIn();
    const { posix } = launchCommandsFor(cli, worktree, args);
    const seen = JSON.parse(execFileSync("bash", ["-c", posix], { encoding: "utf8" }));
    expect(seen.argv).toEqual(args);
    expect(realpathSync.native(seen.cwd)).toBe(realpathSync.native(worktree));
  });

  it.runIf(powershell !== undefined)(
    "reaches the CLI intact through PowerShell, spaces and quotes included",
    () => {
      const { cli, worktree } = standIn();
      const command = launchCommandsFor(cli, worktree, args).powershell;
      const seen = JSON.parse(
        execFileSync(powershell ?? "", ["-NoProfile", "-Command", command], { encoding: "utf8" }),
      );
      expect(seen.argv).toEqual(args);
      expect(realpathSync.native(seen.cwd)).toBe(realpathSync.native(worktree));
    },
  );
});

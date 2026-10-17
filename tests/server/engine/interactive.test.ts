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
  readdirSync,
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
  callIdFor,
  createInteractiveEngine,
  exchangeFilesFor,
  launchArgsFor,
  launchCommandsFor,
} from "@/server/engine/interactive";
import { StageFailedError } from "@/server/engine/headless";
import { StageOutputUnreadableError } from "@/server/review/engine-runner";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-interactive-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function engine(options: { timeoutMs?: number; signal?: AbortSignal; model?: string } = {}) {
  return createInteractiveEngine({
    exchangeDir: join(dir, "bundle"),
    worktreeRoot: join(dir, "worktree"),
    model: options.model ?? "claude-fable-5[1m]",
    directives: [],
    rules: [],
    timeoutMs: options.timeoutMs ?? 5_000,
    pollMs: 25,
    claudePath: FAKE_CLI,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

type Question = {
  stage: "s1_risk" | "s3_adversarial";
  systemPrompt: string;
  prompt: string;
  batchNumber?: number;
  batchCount?: number;
};

const ask: Question = { stage: "s1_risk", systemPrompt: "You are a reviewer.", prompt: "Assess." };

/** The files a question is asked through, named as the engine names them. */
const filesFor = (question: Question) =>
  exchangeFilesFor(join(dir, "bundle"), question.stage, question.batchNumber, callIdFor(question));

/**
 * Writes an answer once its question's prompt exists, the way a person would:
 * the folder is created by the engine, so writing on a fixed delay raced it.
 */
function answerLater(contents: string, afterMs = 60, path = filesFor(ask).answer): void {
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

    const prompt = readFileSync(filesFor(ask).prompt, "utf8");
    expect(prompt).toContain("You are a reviewer.");
    expect(prompt).toContain("Assess.");
    // Where the answer goes, or the exchange has no second half.
    expect(prompt).toContain(filesFor(ask).answer);
    // The checkout is read-only and the review verifies against those bytes.
    expect(prompt).toContain("Do not edit anything in it");
  });

  it("puts the instructions in their own file for the session's system prompt", async () => {
    answerLater(JSON.stringify({ files: [] }));
    await engine().run(ask);
    expect(readFileSync(filesFor(ask).system, "utf8")).toBe("You are a reviewer.");
  });

  it("tells the person the command and the CLI version it needs, starting nothing itself", async () => {
    // Mode B spawns nothing, a version check included: it names the CLI and
    // says what the command needs, and the person runs it.
    const said: string[] = [];
    const reviewer = createInteractiveEngine({
      exchangeDir: join(dir, "bundle"),
      worktreeRoot: join(dir, "worktree"),
      model: "claude-fable-5[1m]",
      directives: [],
      rules: [],
      timeoutMs: 5_000,
      pollMs: 25,
      claudePath: FAKE_CLI,
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
    expect(said[0]).toContain(filesFor(ask).answer);
  });

  it("refuses to hand out a command for a model alias", async () => {
    // Headless stages refuse one at launch; a person must not be handed
    // `--model opus` by a review stored before creation checked.
    await expect(engine({ model: "opus" }).run(ask)).rejects.toThrow(
      /"opus" does not name a single model/,
    );
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
    const answerPath = filesFor(ask).answer;
    mkdirSync(join(dir, "bundle"), { recursive: true });
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

  it("reads an answer saved after the timeout when the same question is asked again", async () => {
    // What the timeout message promises: a person who answers late and then
    // resumes is not made to run, and pay for, the session again.
    await expect(engine({ timeoutMs: 150 }).run(ask)).rejects.toThrow(
      /the same question is asked from the same files/,
    );
    writeFileSync(filesFor(ask).answer, JSON.stringify({ files: [] }), "utf8");

    const started = Date.now();
    await expect(engine({ timeoutMs: 5_000 }).run(ask)).resolves.toMatchObject({
      output: { files: [] },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("sets a refused answer aside, so asking again waits for a new one", async () => {
    answerLater("not JSON");
    await expect(engine().run(ask)).rejects.toBeInstanceOf(StageOutputUnreadableError);
    expect(existsSync(filesFor(ask).answer)).toBe(false);
    expect(readdirSync(join(dir, "bundle")).some((name) => name.includes(".rejected-"))).toBe(true);

    // Without the move this would fail at once on the same bad file.
    await expect(engine({ timeoutMs: 200 }).run(ask)).rejects.toThrow(/No answer appeared at/);
  });
});

describe("one question's files belong to that question", () => {
  it("does not hand a second batch the first batch's answer", async () => {
    // S3 asks several questions under one stage name. Named by stage alone,
    // batch 2 read batch 1's answer straight back.
    const adversarial = (batchNumber: number): Question => ({
      stage: "s3_adversarial",
      systemPrompt: "Rules.",
      prompt: `Batch ${batchNumber}.`,
      batchNumber,
      batchCount: 2,
    });
    const answer = JSON.stringify({ findings: [], clearedHunks: [], sweepDispositions: [] });
    const reviewer = engine();
    answerLater(answer, 40, filesFor(adversarial(1)).answer);
    await reviewer.run(adversarial(1));

    answerLater(answer, 150, filesFor(adversarial(2)).answer);
    const started = Date.now();
    await reviewer.run(adversarial(2));
    // Waited for its own file rather than reading the one already on disk.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(readFileSync(filesFor(adversarial(2)).prompt, "utf8")).toContain("Batch 2.");
    expect(readFileSync(filesFor(adversarial(1)).prompt, "utf8")).toContain("Batch 1.");
  });

  it("does not read an answer to a different question", async () => {
    mkdirSync(join(dir, "bundle"), { recursive: true });
    const other = { ...ask, prompt: "Assess something else." };
    writeFileSync(filesFor(other).answer, JSON.stringify({ files: [] }), "utf8");
    await expect(engine({ timeoutMs: 200 }).run(ask)).rejects.toThrow(/No answer appeared at/);
  });

  it.each([
    ["stage", { ...ask, stage: "s3_adversarial" as const }],
    ["batch", { ...ask, batchNumber: 2 }],
    ["system prompt", { ...ask, systemPrompt: "Other rules." }],
    ["prompt", { ...ask, prompt: "Assess again." }],
  ])("names a question differently when its %s differs", (_, changed) => {
    expect(callIdFor(changed)).not.toBe(callIdFor(ask));
    expect(callIdFor({ ...ask })).toBe(callIdFor(ask));
  });
});

describe("the command a person is given", () => {
  // An ASCII and a typographic apostrophe both: PowerShell ends a quoted
  // string at either.
  const exchangeDir = "/data dir/it's D’Angelo";
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
    const worktree = join(dir, "work tree's ’quoted‘");
    mkdirSync(worktree);
    return {
      cli: { command: process.execPath, prefixArgs: [script], display: script },
      worktree,
    };
  }

  /**
   * A bash this process can hand Windows paths to. On Windows that is Git
   * Bash; a bash.exe from WSL would run Linux and could not start this
   * Node, which would fail the test for a reason that is not the quoting.
   */
  const bash = (() => {
    const probe = spawnSync("bash", ["-c", "uname -s"], { encoding: "utf8" });
    if (probe.status !== 0) return false;
    return process.platform !== "win32" || /MINGW|MSYS|CYGWIN/.test(probe.stdout);
  })();
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
    "reaches the CLI intact through PowerShell, typographic quotes included",
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

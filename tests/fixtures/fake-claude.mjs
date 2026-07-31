#!/usr/bin/env node
/**
 * A stand-in for the `claude` CLI.
 *
 * The engine tests drive this instead of the real binary so they are
 * hermetic, run in milliseconds, and consume none of the user's model usage.
 * Its output shapes were copied from a real CLI transcript captured on
 * 2026-07-30, so it fails the same way the real thing does.
 *
 * The scenario is chosen by the FAKE_CLAUDE_SCENARIO environment variable, and
 * the invocation is recorded to FAKE_CLAUDE_RECORD so tests can assert on the
 * exact argv and environment the engine used.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const scenario = process.env.FAKE_CLAUDE_SCENARIO ?? "success";
const recordPath = process.env.FAKE_CLAUDE_RECORD;

// FAKE_CLAUDE_RECORD keeps only the last call, which is enough for a test
// that makes one. A run makes several, and what a later call was told matters
// as much as what the first was, so this keeps all of them. Calls are
// sequential, so the file count is the call number.
const recordDir = process.env.FAKE_CLAUDE_RECORD_DIR;
if (recordDir) {
  mkdirSync(recordDir, { recursive: true });
  let existing = 0;
  try {
    existing = readdirSync(recordDir).length;
  } catch {
    existing = 0;
  }
  writeFileSync(
    join(recordDir, `call-${String(existing + 1).padStart(3, "0")}.json`),
    JSON.stringify({ args, cwd: process.cwd() }, null, 2),
  );
}

if (recordPath) {
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        args,
        cwd: process.cwd(),
        // Recorded so a test can prove the session markers were removed.
        sawSessionMarker: Object.keys(process.env).some(
          (k) => k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_"),
        ),
        env: {
          CLAUDECODE: process.env.CLAUDECODE ?? null,
          LC_ALL: process.env.LC_ALL ?? null,
        },
      },
      null,
      2,
    ),
  );
}

const sessionId = "11111111-2222-3333-4444-555555555555";
const emit = (object) => process.stdout.write(`${JSON.stringify(object)}\n`);

const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const toolsFlag = valueOf("--tools") ?? "";
const grantedTools = toolsFlag === "" ? [] : toolsFlag.split(",");

const initEvent = {
  type: "system",
  subtype: "init",
  cwd: process.cwd(),
  session_id: sessionId,
  tools: grantedTools,
  model: valueOf("--model") ?? "unknown",
  permissionMode: "default",
  apiKeySource: "none",
  claude_code_version: "fake",
};

const resultEvent = (overrides = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 12,
  num_turns: 1,
  result: "done",
  session_id: sessionId,
  total_cost_usd: 0.0042,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  modelUsage: {
    [valueOf("--model") ?? "unknown"]: {
      inputTokens: 100,
      outputTokens: 20,
      costUSD: 0.0042,
      contextWindow: 1000000,
    },
  },
  permission_denials: [],
  ...overrides,
});

switch (scenario) {
  case "success": {
    emit(initEvent);
    emit({
      type: "assistant",
      session_id: sessionId,
      message: { content: [{ type: "text", text: "the finding" }] },
    });
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "tool-use": {
    emit(initEvent);
    emit({
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/a.ts" } }],
      },
    });
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "rate-limit-warning": {
    emit(initEvent);
    emit({
      type: "rate_limit_event",
      session_id: sessionId,
      rate_limit_info: {
        status: "allowed_warning",
        resetsAt: 1785408600,
        rateLimitType: "five_hour",
        isUsingOverage: false,
      },
    });
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "limit-reached": {
    process.stderr.write("Claude usage limit reached. Your limit resets at 3pm.\n");
    process.exit(1);
    break;
  }

  case "error-result": {
    emit(initEvent);
    emit(resultEvent({ is_error: true, subtype: "error_during_execution", result: "it broke" }));
    process.exit(0);
    break;
  }

  case "no-result": {
    // Exits zero having produced nothing. A naive runner would call this a
    // success and hand back an empty review.
    emit(initEvent);
    process.exit(0);
    break;
  }

  case "malformed": {
    emit(initEvent);
    process.stdout.write("this line is not json\n");
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "extra-tools": {
    // Reports a toolset wider than was requested.
    emit({ ...initEvent, tools: [...grantedTools, "Bash", "Edit"] });
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "unknown-event": {
    emit(initEvent);
    emit({ type: "some_future_event", session_id: sessionId, payload: { anything: true } });
    emit(resultEvent());
    process.exit(0);
    break;
  }

  case "split-lines": {
    // Writes a JSON object across two chunks with no newline between them,
    // which is what a real stream does at a buffer boundary.
    const text = `${JSON.stringify(initEvent)}\n${JSON.stringify(resultEvent())}\n`;
    process.stdout.write(text.slice(0, 40));
    setTimeout(() => {
      process.stdout.write(text.slice(40));
      process.exit(0);
    }, 20);
    break;
  }

  case "hang": {
    emit(initEvent);
    setTimeout(() => process.exit(0), 60_000);
    break;
  }

  case "then-valid": {
    // Answers with FAKE_CLAUDE_RESULT first and FAKE_CLAUDE_RESULT_2 after,
    // so a repair round can be driven. The call count lives in a file because
    // every invocation is a separate process.
    // Configurable so concurrent test files cannot share a counter.
    const counterPath = process.env.FAKE_CLAUDE_COUNTER ?? join(tmpdir(), "fake-claude-calls.txt");
    let calls = 0;
    try {
      calls = Number(readFileSync(counterPath, "utf8")) || 0;
    } catch {
      calls = 0;
    }
    writeFileSync(counterPath, String(calls + 1));

    const isRepair = calls > 0;
    if (isRepair && process.env.FAKE_CLAUDE_RECORD_2) {
      writeFileSync(
        process.env.FAKE_CLAUDE_RECORD_2,
        JSON.stringify({ args, cwd: process.cwd() }, null, 2),
      );
    }

    emit(initEvent);
    emit(
      resultEvent({
        result: isRepair
          ? (process.env.FAKE_CLAUDE_RESULT_2 ?? "{}")
          : (process.env.FAKE_CLAUDE_RESULT ?? "{}"),
      }),
    );
    process.exit(0);
    break;
  }

  case "json-result": {
    // Returns whatever FAKE_CLAUDE_RESULT holds as the run's result text, so
    // a test can drive the answer a stage gets without changing this file.
    emit(initEvent);
    emit(resultEvent({ result: process.env.FAKE_CLAUDE_RESULT ?? "{}" }));
    process.exit(0);
    break;
  }

  case "script": {
    // Answers a whole pipeline: the Nth invocation returns the Nth file in
    // FAKE_CLAUDE_DIR. Real runs make many calls, and a fake that can only
    // answer one of them cannot exercise resume at all.
    const dir = process.env.FAKE_CLAUDE_DIR;
    if (!dir) {
      process.stderr.write("fake-claude: script scenario needs FAKE_CLAUDE_DIR\n");
      process.exit(2);
    }

    const counterPath = process.env.FAKE_CLAUDE_COUNTER ?? join(tmpdir(), "fake-claude-calls.txt");
    let previousCalls = 0;
    try {
      previousCalls = Number(readFileSync(counterPath, "utf8")) || 0;
    } catch {
      previousCalls = 0;
    }
    const call = previousCalls + 1;
    writeFileSync(counterPath, String(call));

    const failAt = process.env.FAKE_CLAUDE_FAIL_AT
      ? Number(process.env.FAKE_CLAUDE_FAIL_AT)
      : undefined;

    if (failAt === call) {
      // Fails the way a usage limit does, and consumes no answer: the call
      // after a resume asks the same question again and gets this file.
      process.stderr.write("Claude usage limit reached. Your limit resets at 3pm.\n");
      process.exit(1);
    }

    // One failure shifts every later call back by one file, so the sequence
    // continues where it stopped rather than skipping the answer it never gave.
    const fileNumber = failAt !== undefined && call > failAt ? call - 1 : call;
    const answerPath = join(dir, `${String(fileNumber).padStart(3, "0")}.json`);

    let answer;
    try {
      answer = readFileSync(answerPath, "utf8");
    } catch {
      // Loud rather than hanging: an unexpected extra call means the pipeline
      // asked something the test did not plan for, and that is the finding.
      process.stderr.write(
        `fake-claude: call ${call} wanted ${answerPath}, which does not exist\n`,
      );
      process.exit(2);
    }

    // Candidates are labelled by position when the prompt is built, so an
    // answer written in advance names the place in the code instead and this
    // resolves it against the question actually asked.
    const tokenPattern = /<<candidate:(.+?):(\d+)>>/g;
    if (tokenPattern.test(answer)) {
      const prompt = valueOf("-p") ?? "";
      const start = prompt.indexOf("{");
      const end = prompt.lastIndexOf("}");
      let candidates = [];
      if (start !== -1 && end > start) {
        try {
          candidates = JSON.parse(prompt.slice(start, end + 1)).candidates ?? [];
        } catch {
          candidates = [];
        }
      }
      let unresolved = null;
      answer = answer.replace(tokenPattern, (whole, path, line) => {
        const match = candidates.find(
          (candidate) => candidate.path === path && String(candidate.lineStart) === line,
        );
        if (!match) {
          unresolved ??= whole;
          return whole;
        }
        return match.ref;
      });
      if (unresolved) {
        process.stderr.write(
          `fake-claude: call ${call} was not asked about ${unresolved}\n`,
        );
        process.exit(2);
      }
    }

    emit(initEvent);
    emit(resultEvent({ result: answer }));
    process.exit(0);
    break;
  }

  case "probe-success": {
    process.stdout.write(`${JSON.stringify(resultEvent({ result: "ok" }))}\n`);
    process.exit(0);
    break;
  }

  case "probe-unavailable": {
    process.stderr.write("Invalid model name: not-a-real-model\n");
    process.exit(1);
    break;
  }

  default: {
    process.stderr.write(`fake-claude: unknown scenario "${scenario}"\n`);
    process.exit(2);
  }
}

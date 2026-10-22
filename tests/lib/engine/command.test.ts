import { describe, expect, it } from "vitest";
import {
  READ_ONLY_TOOLS,
  buildAttachedEnv,
  buildChildEnv,
  buildProbeArgs,
  buildStageArgs,
} from "@/lib/engine/command";
import { toEngineEvent } from "@/lib/engine/events";

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("stage arguments", () => {
  const base = {
    prompt: "review the change",
    systemPrompt: "You are a reviewer.",
    model: "claude-fable-5[1m]",
    outputFormat: "stream-json" as const,
  };

  it("isolates the run from the reviewed repository's configuration, and the person's", () => {
    // Verified against the real CLI: a repository carrying its own CLAUDE.md
    // changed the model's reply when these were absent. No sources at all
    // since D-124: `user` still read the person's CLAUDE.md and settings.
    const args = buildStageArgs(base);
    expect(valueAfter(args, "--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
  });

  it("restricts the model to reading", () => {
    expect(valueAfter(buildStageArgs(base), "--tools")).toBe("Read,Grep,Glob");
    expect(READ_ONLY_TOOLS).not.toContain("Bash");
    expect(READ_ONLY_TOOLS).not.toContain("Edit");
    expect(READ_ONLY_TOOLS).not.toContain("Write");
  });

  it("replaces the default system prompt rather than appending to it", () => {
    const args = buildStageArgs(base);
    expect(args).toContain("--system-prompt");
    // Appending would leave the CLI's own instructions in force and cost
    // thousands of tokens on every call.
    expect(args).not.toContain("--append-system-prompt");
  });

  it("asks for verbose output, without which stream-json emits nothing", () => {
    expect(buildStageArgs(base)).toContain("--verbose");
    expect(buildStageArgs({ ...base, outputFormat: "json" })).not.toContain("--verbose");
  });

  it("sends each stage its own system prompt, never the session's first (D-182)", () => {
    const args = buildStageArgs({ ...base, resumeSessionId: "abc" });
    expect(valueAfter(args, "--system-prompt-snapshot")).toBe("off");
  });

  it("omits resume for a fresh session and includes it for a continued one", () => {
    expect(buildStageArgs(base)).not.toContain("--resume");
    expect(valueAfter(buildStageArgs({ ...base, resumeSessionId: "s-1" }), "--resume")).toBe("s-1");
  });

  it("asks for an effort level only when one was chosen", () => {
    // Omitted rather than defaulted, so an unset effort leaves the choice to
    // the CLI instead of this app quietly deciding how hard to think.
    expect(buildStageArgs(base)).not.toContain("--effort");
    expect(valueAfter(buildStageArgs({ ...base, effort: "max" }), "--effort")).toBe("max");
  });

  it("passes the model id through untouched", () => {
    expect(valueAfter(buildStageArgs(base), "--model")).toBe("claude-fable-5[1m]");
  });

  it("keeps a probe cheap by disabling tools entirely", () => {
    const args = buildProbeArgs("claude-fable-5");
    expect(valueAfter(args, "--tools")).toBe("");
    expect(valueAfter(args, "--output-format")).toBe("json");
    // A probe that inherited the default system prompt and tool definitions
    // was measured at about a hundred times the cost.
    expect(args).toContain("--system-prompt");
  });
});

describe("a prompt too large for a command line", () => {
  it("keeps the prompt out of the argument vector entirely", () => {
    // Linux caps a single argument at MAX_ARG_STRLEN, 128KB. A review of 61
    // files built a 297KB prompt, execve refused it with E2BIG, and the run
    // died at its second stage: every change set big enough to be worth
    // reviewing was too big to review. The prompt travels on stdin now, so
    // the argument vector no longer grows with the size of the diff.
    const huge = "x".repeat(300_000);
    const args = buildStageArgs({
      prompt: huge,
      systemPrompt: "system",
      model: "claude-fable-5[1m]",
      outputFormat: "stream-json",
    });

    expect(args).not.toContain(huge);
    expect(args.some((arg) => arg.length > 131_072)).toBe(false);
    // -p stays, as the flag the CLI's help calls useful for pipes.
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toBe("--output-format");
  });

  it("keeps a stage's system prompt out of argv when it travels in a file", () => {
    // The system prompt is composed from the ruleset and grows with it, and
    // Windows caps the whole command line at 32,767 characters. A stage
    // passes a file; the text never enters the argument vector.
    const big = "s".repeat(40_000);
    const args = buildStageArgs({
      prompt: "short",
      systemPrompt: big,
      systemPromptFile: "/runs/r1/logs/s3.system-prompt.ab12cd34.md",
      model: "claude-fable-5[1m]",
      outputFormat: "stream-json",
    });
    expect(valueAfter(args, "--system-prompt-file")).toBe(
      "/runs/r1/logs/s3.system-prompt.ab12cd34.md",
    );
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain(big);
  });

  it("passes a system prompt inline when no file is given, which is what a probe does", () => {
    const args = buildStageArgs({
      prompt: "short",
      systemPrompt: "tiny",
      model: "claude-fable-5[1m]",
      outputFormat: "json",
    });
    expect(valueAfter(args, "--system-prompt")).toBe("tiny");
    expect(args).not.toContain("--system-prompt-file");
  });
});

describe("the child environment", () => {
  // What the app configures wins over the machine's own Claude
  // configuration: only what the CLI needs to run, and the sign-in, reach it
  // (D-174). It was a list of what to keep out, and every variable it did
  // not name went through (D-120).
  const passes = (name: string) => name in buildChildEnv({ [name]: "x" });

  it("passes what the CLI needs to run, whatever the platform's spelling", () => {
    for (const name of [
      "PATH",
      "Path",
      "PATHEXT",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "SystemRoot",
      "TEMP",
      "TMP",
      "TMPDIR",
      "USER",
      "USERNAME",
      "XDG_CONFIG_HOME",
      "HTTPS_PROXY",
      "https_proxy",
      "NO_PROXY",
      "NODE_EXTRA_CA_CERTS",
      // Where Windows' CLI finds Git Bash; missing, reviews there failed (D-120).
      "CLAUDE_CODE_GIT_BASH_PATH",
    ]) {
      expect(passes(name), name).toBe(true);
    }
  });

  it("passes the sign-in kept in a custom config folder or made by setup-token", () => {
    expect(passes("CLAUDE_CONFIG_DIR")).toBe(true);
    expect(passes("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
  });

  it("drops what would change what a review runs with, named or not (D-174)", () => {
    for (const name of [
      // A session's markers (D-120).
      "CLAUDECODE",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_SSE_PORT",
      // Keys and paid providers (D-161).
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "AWS_BEARER_TOKEN_BEDROCK",
      // Settings that outrank a flag every stage pins (D-121, D-124).
      "CLAUDE_CODE_EFFORT_LEVEL",
      "CLAUDE_CODE_EXTRA_BODY",
      // And what no list named: another API, another model, another budget.
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "MAX_THINKING_TOKENS",
      "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
      "NODE_OPTIONS",
      "SSH_AUTH_SOCK",
      "ANY_OTHER_VARIABLE",
    ]) {
      expect(passes(name), name).toBe(false);
    }
  });

  it("passes the stand-in CLI's own variables, which the real CLI does not read", () => {
    expect(passes("FAKE_CLAUDE_SCENARIO")).toBe(true);
  });

  it("pins the locale so parsing never depends on the user's language", () => {
    const child = buildChildEnv({ LC_ALL: "fr_FR.UTF-8" });
    expect(child.LC_ALL).toBe("C");
    expect(child.LANG).toBe("C");
  });

  it("keeps the CLI from updating itself away from the version the app tested", () => {
    expect(buildChildEnv({}).DISABLE_AUTOUPDATER).toBe("1");
  });

  it("drops undefined values rather than passing them as empty strings", () => {
    const child = buildChildEnv({ PATH: "/bin", HOME: undefined });
    expect(child.PATH).toBe("/bin");
    expect("HOME" in child).toBe(false);
  });

  it("keeps a terminal and its display from a review, which has neither", () => {
    expect(passes("DISPLAY")).toBe(false);
    expect(passes("TERM")).toBe(false);
  });
});

describe("the sign-in run's environment", () => {
  // `npm run claude` runs attached to the person's terminal, where the CLI
  // draws and opens a browser to sign in (review of D-174's changes).
  it("adds the terminal and display, whatever the platform's spelling", () => {
    const child = buildAttachedEnv({
      PATH: "/bin",
      TERM: "xterm-256color",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      BROWSER: "firefox",
      SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22",
      WSL_DISTRO_NAME: "Ubuntu",
      Term_Program: "vscode",
    });
    expect(child).toMatchObject({
      PATH: "/bin",
      TERM: "xterm-256color",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      BROWSER: "firefox",
      SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22",
      WSL_DISTRO_NAME: "Ubuntu",
      Term_Program: "vscode",
    });
  });

  it("is otherwise a review's: no key, a pinned locale, no updates", () => {
    const child = buildAttachedEnv({
      ANTHROPIC_API_KEY: "sk-ant-for-this-test",
      CLAUDECODE: "1",
      LC_ALL: "fr_FR.UTF-8",
      DISPLAY: undefined,
    });
    expect(child).toEqual({ LC_ALL: "C", LANG: "C", DISABLE_AUTOUPDATER: "1" });
  });
});

describe("event narrowing", () => {
  it("reads the effective toolset out of the init event", () => {
    const event = toEngineEvent({
      type: "system",
      subtype: "init",
      session_id: "s",
      cwd: "/w",
      model: "claude-fable-5",
      tools: ["Read", "Grep"],
    });
    expect(event).toEqual({
      kind: "init",
      sessionId: "s",
      model: "claude-fable-5",
      tools: ["Read", "Grep"],
      cwd: "/w",
    });
  });

  it("surfaces rate-limit state, including when the window resets", () => {
    const event = toEngineEvent({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1785408600, rateLimitType: "five_hour" },
    });
    expect(event).toEqual({
      kind: "rate-limit",
      status: "allowed",
      resetsAt: 1785408600,
      limitType: "five_hour",
    });
  });

  it("does not surface thinking blocks", () => {
    const event = toEngineEvent({
      type: "assistant",
      session_id: "s",
      message: { content: [{ type: "thinking", thinking: "long private reasoning" }] },
    });
    expect(event.kind).toBe("unknown");
  });

  it("treats an unrecognised event as unknown rather than throwing", () => {
    // The CLI may add event types; a review must not fail because of one.
    expect(toEngineEvent({ type: "some_future_event" }).kind).toBe("unknown");
    expect(toEngineEvent(null).kind).toBe("unknown");
    expect(toEngineEvent("not an object").kind).toBe("unknown");
  });

  it("rejects a result event missing the fields the app depends on", () => {
    // Permissive about new fields, strict about the ones that matter.
    expect(toEngineEvent({ type: "result", subtype: "success" }).kind).toBe("unknown");
  });
});

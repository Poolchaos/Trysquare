import { describe, expect, it } from "vitest";
import {
  READ_ONLY_TOOLS,
  buildChildEnv,
  buildProbeArgs,
  buildStageArgs,
  isSessionMarker,
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

  it("isolates the run from the reviewed repository's configuration", () => {
    // Verified against the real CLI: a repository carrying its own CLAUDE.md
    // changed the model's reply when these were absent.
    const args = buildStageArgs(base);
    expect(valueAfter(args, "--setting-sources")).toBe("user");
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
  it("recognises the markers that make the CLI refuse to run nested", () => {
    expect(isSessionMarker("CLAUDECODE")).toBe(true);
    expect(isSessionMarker("CLAUDE_CODE_ENTRYPOINT")).toBe(true);
    expect(isSessionMarker("CLAUDE_CODE_SSE_PORT")).toBe(true);
    expect(isSessionMarker("PATH")).toBe(false);
    expect(isSessionMarker("HOME")).toBe(false);
    expect(isSessionMarker("ANTHROPIC_API_KEY")).toBe(false);
  });

  it("strips every session marker while keeping the rest of the environment", () => {
    const child = buildChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/someone",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      SSH_AUTH_SOCK: "/run/agent",
    });

    expect(child.CLAUDECODE).toBeUndefined();
    expect(child.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
    // Kept deliberately: cloning over SSH needs the agent.
    expect(child.SSH_AUTH_SOCK).toBe("/run/agent");
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
    const child = buildChildEnv({ DEFINED: "x", MISSING: undefined });
    expect(child.DEFINED).toBe("x");
    expect("MISSING" in child).toBe(false);
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

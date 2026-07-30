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

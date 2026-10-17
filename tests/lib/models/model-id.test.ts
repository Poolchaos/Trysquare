import { describe, expect, it } from "vitest";
import { isFullModelId } from "@/lib/models/model-id";

describe("which model ids name one model", () => {
  it.each([
    "claude-fable-5[1m]",
    "claude-opus-5",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "  claude-sonnet-5  ",
  ])("accepts %s", (id) => {
    expect(isFullModelId(id)).toBe(true);
  });

  // The CLI's --help names fable, opus and sonnet as aliases for "the latest
  // model"; the rest are forms an alias list would have missed.
  it.each([
    "fable",
    "opus",
    "sonnet",
    "Opus",
    "sonnet[1m]",
    "opusplan",
    "default",
    "claude-fable",
    "",
  ])("refuses %j", (id) => {
    expect(isFullModelId(id)).toBe(false);
  });
});

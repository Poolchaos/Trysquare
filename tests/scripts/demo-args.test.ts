/**
 * What a fixture demo was asked to do (audit finding 1, D-203): never a
 * real, paid run unless one was asked for, however the shell passed it.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, readDemoOptions } from "../../scripts/lib/demo-args";

const read = (argv: string[], env: Record<string, string> = {}) =>
  readDemoOptions("npm run demo:fixture", argv, env);

describe("a demo's options", () => {
  it("run the stand-in CLI for --fake, as a POSIX shell passes it", () => {
    expect(read(["--fake"])).toEqual({
      options: { model: DEFAULT_MODEL, fake: true, keep: false, perToken: false },
    });
  });

  it("run the stand-in CLI for a --fake that PowerShell's npm swallowed", () => {
    // Measured 2026-10-24 on Windows PowerShell 5.1 with npm.ps1: the script
    // got no arguments, and npm kept the flag as npm_config_fake. Read as
    // no flag at all, the free command ran a real review.
    expect(read([], { npm_config_fake: "true" })).toEqual({
      options: { model: DEFAULT_MODEL, fake: true, keep: false, perToken: false },
    });
    expect(read([], { npm_config_fake: "true", npm_config_keep: "true" })).toMatchObject({
      options: { fake: true, keep: true },
    });
  });

  it("refuse to run, spending nothing, when told neither", () => {
    const told = read([]);
    expect(told).toEqual({
      refusal:
        "Say which run you want. npm run demo:fixture -- --fake runs it through the stand-in CLI " +
        "and spends nothing; npm run demo:fixture -- --real, or -- --model <id>, reviews it with " +
        "a real model on your Claude usage.",
    });
  });

  it("run a real model only when asked, by --real or --model, however passed", () => {
    expect(read(["--real"])).toMatchObject({ options: { fake: false, model: DEFAULT_MODEL } });
    expect(read(["--model", "claude-fable-5-1"])).toMatchObject({
      options: { fake: false, model: "claude-fable-5-1" },
    });
    // PowerShell's npm: --model taken as npm's own, its id left as the only
    // bare argument.
    expect(read(["claude-fable-5-1"], { npm_config_model: "true" })).toMatchObject({
      options: { fake: false, model: "claude-fable-5-1" },
    });
    expect(read([], { npm_config_real: "true", npm_config_per_token: "true" })).toMatchObject({
      options: { fake: false, perToken: true },
    });
  });

  it("refuse a negated or valued flag, which npm passes as empty or false", () => {
    // Measured in review round 10: --no-real and --real=false both reach
    // the script as npm_config_real="", which read as present started a
    // paid run, and --no-per-token switched off the per-token stop.
    for (const value of ["", "false"]) {
      expect(read([], { npm_config_real: value })).toHaveProperty("refusal");
      expect(read(["--fake"], { npm_config_per_token: value })).toHaveProperty("refusal");
      expect(read([], { npm_config_fake: value })).toHaveProperty("refusal");
    }
    for (const argv of [["--no-real"], ["--real=false"], ["--fake", "--no-per-token"]]) {
      expect(read(argv), argv.join(" ")).toHaveProperty("refusal");
    }
  });

  it("refuse a model set in npm's configuration rather than on the command", () => {
    // An .npmrc model=..., or npm_config_model in the environment, reached
    // every demo run and started a real review nobody asked for.
    expect(read([], { npm_config_model: "claude-fable-5-1" })).toEqual({
      refusal:
        "A model, claude-fable-5-1, was set in npm's configuration rather than on this " +
        "command. Give it here, as npm run demo:fixture -- --model <id>, to run a real review " +
        "with it.",
    });
    expect(read(["--fake"], { npm_config_model: "claude-fable-5-1" })).toHaveProperty("refusal");
  });

  it("refuse what it cannot read, rather than guess a paid run", () => {
    expect(read(["--fake", "--real"])).toHaveProperty("refusal");
    expect(read(["--model"])).toHaveProperty("refusal");
    expect(read([], { npm_config_model: "true" })).toHaveProperty("refusal");
    expect(read(["claude-fable-5-1"])).toMatchObject({
      refusal: expect.stringMatching(/^Not understood: claude-fable-5-1\./),
    });
  });
});

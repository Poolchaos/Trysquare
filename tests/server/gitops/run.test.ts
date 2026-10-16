import { describe, expect, it } from "vitest";
import { git, gitEnv, systemCredentialHelpers } from "@/server/gitops/run";

describe("the environment every git call runs in", () => {
  it("keeps system config off and prompts disabled whatever else it forwards", () => {
    const env = gitEnv(["manager"], {});
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.LC_ALL).toBe("C");
  });

  it("forwards the system credential helpers, in order, as command-line config", () => {
    const env = gitEnv(["", "manager"], {});
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect(env.GIT_CONFIG_KEY_0).toBe("credential.helper");
    expect(env.GIT_CONFIG_VALUE_0).toBe("");
    expect(env.GIT_CONFIG_KEY_1).toBe("credential.helper");
    expect(env.GIT_CONFIG_VALUE_1).toBe("manager");
  });

  it("adds after config the user already passes this way, rather than over it", () => {
    const env = gitEnv(["manager"], {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.proxy",
      GIT_CONFIG_VALUE_0: "http://proxy.example:8080",
    });
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect(env.GIT_CONFIG_VALUE_0).toBe("http://proxy.example:8080");
    expect(env.GIT_CONFIG_KEY_1).toBe("credential.helper");
    expect(env.GIT_CONFIG_VALUE_1).toBe("manager");
  });

  it("adds nothing when the system config names no helper", () => {
    const env = gitEnv([], {});
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it("gives git the helpers this machine's system config names, and nothing else from it", async () => {
    // Asked through the app's own runner, so this is what a clone sees. On a
    // machine with no system helper the key is absent and git says so.
    const helpers = await systemCredentialHelpers();
    const seen = await git(["config", "--get-all", "credential.helper"]).then(
      (output) => output.replace(/\r?\n$/, "").split(/\r?\n/),
      () => [],
    );
    expect(seen.slice(-helpers.length || seen.length)).toEqual(helpers);
    const autocrlf = await git(["config", "--get", "core.autocrlf"]).then(
      (output) => output.trim(),
      () => "unset",
    );
    expect(autocrlf).not.toBe("true");
  });
});

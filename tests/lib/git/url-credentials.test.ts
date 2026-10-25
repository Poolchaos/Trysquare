/**
 * A git address that carries credentials (audit finding 2, D-208): refused
 * when added, since the app stores no secrets, and never echoed back in an
 * error, where it reached stored clone errors and the API.
 */

import { describe, expect, it } from "vitest";
import { InvalidGitUrlError, redactUrlCredentials, validateGitUrl } from "@/lib/git/url";

const TOKEN = "ghp_SECRET0123456789";

describe("an address that carries credentials", () => {
  it("is refused for http and https, without echoing them", () => {
    for (const url of [
      `https://user:${TOKEN}@github.com/acme/app.git`,
      `https://${TOKEN}@github.com/acme/app.git`,
      `http://user:${TOKEN}@git.internal/app.git`,
    ]) {
      let refused: unknown;
      try {
        validateGitUrl(url);
      } catch (error) {
        refused = error;
      }
      expect(refused, url).toBeInstanceOf(InvalidGitUrlError);
      const said = (refused as InvalidGitUrlError).message;
      expect(said).toContain("credential helper or an SSH key");
      expect(said).not.toContain(TOKEN);
      expect((refused as InvalidGitUrlError).url).not.toContain(TOKEN);
    }
  });

  it("is still taken as an SSH user, which is a name, not a secret", () => {
    expect(validateGitUrl("git@github.com:acme/app.git")).toBe("git@github.com:acme/app.git");
    expect(validateGitUrl("ssh://git@github.com/acme/app.git")).toBe(
      "ssh://git@github.com/acme/app.git",
    );
    expect(validateGitUrl("https://github.com/acme/app.git")).toBe(
      "https://github.com/acme/app.git",
    );
  });
});

describe("credentials in a message", () => {
  it("are replaced wherever an http address carries them", () => {
    expect(
      redactUrlCredentials(
        `git clone https://user:${TOKEN}@github.com/a.git: fatal: unable to access 'https://${TOKEN}@github.com/a.git/'`,
      ),
    ).toBe(
      "git clone https://***@github.com/a.git: fatal: unable to access 'https://***@github.com/a.git/'",
    );
    // An SSH user is left as it is.
    expect(redactUrlCredentials("git@github.com:a.git ssh://git@host/a")).toBe(
      "git@github.com:a.git ssh://git@host/a",
    );
  });
});

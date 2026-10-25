/**
 * A git address that carries credentials (audit finding 2, D-208; review
 * round 10): refused when added, since the app stores no secrets, and never
 * echoed back in an error, where it reached stored clone errors and the API.
 */

import { describe, expect, it } from "vitest";
import { InvalidGitUrlError, redactUrlCredentials, validateGitUrl } from "@/lib/git/url";

const TOKEN = "ghp_SECRET0123456789";

function refusal(url: string): InvalidGitUrlError {
  try {
    validateGitUrl(url);
  } catch (error) {
    if (error instanceof InvalidGitUrlError) return error;
    throw error;
  }
  throw new Error(`${url} was taken`);
}

describe("an address that carries credentials", () => {
  it("is refused, saying what to add instead, without echoing them", () => {
    expect(refusal(`https://user:${TOKEN}@github.com/acme/app.git`).message).toBe(
      "This address carries a password or token, which Trysquare would have to store. Add " +
        "https://github.com/acme/app.git instead and let git's credential helper sign in, or " +
        "use the repository's SSH address.",
    );
    expect(refusal(`https://${TOKEN}@github.com/acme/app.git`).message).toContain(
      "carries a user name or token",
    );
    for (const url of [
      `http://user:${TOKEN}@git.internal/app.git`,
      // A quote or an @ inside the password (measured in review round 10:
      // the refusal repeated the first whole, and left the second's tail).
      `https://user:pa'${TOKEN}@github.com/acme/app.git`,
      `https://user:p@${TOKEN}@github.com/acme/app.git`,
      // A password on any scheme (review round 10: ssh:// with one was taken).
      `ssh://git:${TOKEN}@github.com/acme/app.git`,
      `git://user:${TOKEN}@host/app.git`,
    ]) {
      const refused = refusal(url);
      expect(refused.message, url).not.toContain(TOKEN);
      expect(refused.url, url).not.toContain(TOKEN);
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
  it("are replaced wherever an address carries them", () => {
    expect(
      redactUrlCredentials(
        `git clone https://user:${TOKEN}@github.com/a.git: fatal: unable to access 'https://${TOKEN}@github.com/a.git/'`,
      ),
    ).toBe(
      "git clone https://***@github.com/a.git: fatal: unable to access 'https://***@github.com/a.git/'",
    );
    expect(redactUrlCredentials(`https://u:p@${TOKEN}@host/a`)).toBe("https://***@host/a");
    expect(redactUrlCredentials(`'https://u:pa'${TOKEN}@host/a'`)).toBe("'https://***@host/a'");
    expect(redactUrlCredentials(`ssh://git:${TOKEN}@host/a`)).toBe("ssh://***@host/a");
    // An SSH user is left as it is.
    expect(redactUrlCredentials("git@github.com:a.git ssh://git@host/a")).toBe(
      "git@github.com:a.git ssh://git@host/a",
    );
  });
});

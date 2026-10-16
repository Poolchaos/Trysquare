import { describe, expect, it } from "vitest";
import { checkRequest, type GuardInput } from "@/lib/http/request-guard";

const base: GuardInput = {
  method: "GET",
  path: "/api/system",
  host: "127.0.0.1:3000",
  origin: null,
  fetchSite: null,
};

const verdict = (overrides: Partial<GuardInput>) => checkRequest({ ...base, ...overrides });

describe("the Host header", () => {
  it.each(["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "LOCALHOST:3000", "localhost"])(
    "answers a request addressed to this machine as %s",
    (host) => {
      expect(verdict({ host }).ok).toBe(true);
    },
  );

  it.each([
    ["a rebound hostile name", "evil.example:3000"],
    ["a LAN address", "192.168.56.1:3000"],
    ["a loopback name used as a subdomain", "localhost.evil.example"],
    ["credentials smuggled into the host", "user@localhost:3000"],
    ["a path smuggled into the host", "localhost:3000/x"],
    ["no host at all", null],
    ["an empty host", ""],
  ])("refuses %s", (_, host) => {
    const result = verdict({ host });
    expect(result.ok).toBe(false);
  });

  it("refuses a foreign host on page loads too, not only on the API", () => {
    expect(verdict({ path: "/reviews", host: "evil.example" }).ok).toBe(false);
  });
});

describe("requests from other sites", () => {
  it.each(["cross-site", "same-site", "CROSS-SITE"])(
    "refuses an API request whose Sec-Fetch-Site is %s, even a GET",
    (fetchSite) => {
      expect(verdict({ fetchSite }).ok).toBe(false);
    },
  );

  it.each(["same-origin", "none"])("answers an API request whose Sec-Fetch-Site is %s", (site) => {
    expect(verdict({ fetchSite: site }).ok).toBe(true);
  });

  it("leaves page navigation from another site alone, since a link to the app is fine", () => {
    expect(verdict({ path: "/projects", fetchSite: "cross-site" }).ok).toBe(true);
  });

  it("refuses the 2026-10-16 reproduction: a POST carrying a foreign Origin", () => {
    const result = verdict({
      method: "POST",
      path: "/api/projects",
      origin: "https://evil.example",
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("evil.example") });
  });

  it.each(["DELETE", "PUT", "PATCH", "post"])("checks the Origin of a %s", (method) => {
    expect(verdict({ method, origin: "https://evil.example" }).ok).toBe(false);
  });

  it.each([
    ["the opaque origin a sandboxed frame sends", "null"],
    ["the same host on another port", "http://127.0.0.1:4000"],
    ["localhost when the request named 127.0.0.1", "http://localhost:3000"],
    ["a scheme that is not http", "file://127.0.0.1:3000"],
  ])("refuses a mutation from %s", (_, origin) => {
    expect(verdict({ method: "POST", origin }).ok).toBe(false);
  });

  it("answers a mutation from the app's own origin", () => {
    expect(verdict({ method: "POST", origin: "http://127.0.0.1:3000" }).ok).toBe(true);
  });

  it("treats a default port written out the same as one left off", () => {
    expect(verdict({ method: "POST", host: "localhost:80", origin: "http://localhost" }).ok).toBe(
      true,
    );
  });

  it("answers a mutation with no Origin, which no browser sends", () => {
    expect(verdict({ method: "DELETE", origin: null }).ok).toBe(true);
  });

  it("does not ask a GET for an Origin", () => {
    expect(verdict({ method: "GET", origin: "https://evil.example" }).ok).toBe(true);
  });
});

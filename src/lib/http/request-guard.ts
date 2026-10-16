/**
 * Which requests this server answers.
 *
 * The app has no sign-in by design: it is one person's tool on one machine.
 * That makes the browser the only way in for anyone else, and two browser
 * routes reach a server bound to 127.0.0.1. A page on any website can send a
 * request to 127.0.0.1 directly, which is cross-site request forgery: a
 * `text/plain` POST needs no preflight, and on 2026-10-16 one carrying a
 * foreign Origin was parsed and acted on. And a hostile domain can re-point
 * its own name at 127.0.0.1 after the page loads, which is DNS rebinding:
 * the browser then treats this API as same-origin with that site, so it can
 * read reviewed source code and call the endpoint that wipes everything.
 *
 * The Host header closes the second, because a rebound request still names
 * the hostile domain. Origin and Sec-Fetch-Site close the first. Browsers send
 * Origin on every request whose method is not GET or HEAD (Fetch standard,
 * "append a request Origin header"), so a mutating request without one did
 * not come from a browser, and only a browser can be made to send one on
 * someone else's behalf.
 */

export type GuardInput = {
  method: string;
  /** Request path, used only to tell API calls from page loads. */
  path: string;
  host: string | null;
  origin: string | null;
  fetchSite: string | null;
};

export type GuardVerdict = { ok: true } | { ok: false; error: string };

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * `same-site` is refused as well as `cross-site`: another app on localhost
 * under a different port is same-site and still a different origin.
 */
const FOREIGN_FETCH_SITES = new Set(["cross-site", "same-site"]);

/**
 * A Host header is a host and an optional port, nothing else. Checked by
 * shape first because URL would quietly accept `evil.com/x` or
 * `user@evil.com` and report a hostname that is not what was sent.
 */
const HOST_SHAPE = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i;

/** Host and port as URL normalises them, so `localhost:80` equals `localhost`. */
function normalisedHost(value: string): { host: string; hostname: string } | null {
  if (!HOST_SHAPE.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    return { host: url.host, hostname: url.hostname };
  } catch {
    return null;
  }
}

function hostOfOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

export function checkRequest(input: GuardInput): GuardVerdict {
  const host = input.host?.trim() ?? "";
  const target = host === "" ? null : normalisedHost(host);
  if (target === null || !LOOPBACK_HOSTNAMES.has(target.hostname)) {
    return {
      ok: false,
      error:
        `Refused a request addressed to "${host || "no host"}". This app answers only ` +
        "requests addressed to this machine (127.0.0.1, localhost or [::1]).",
    };
  }

  if (!input.path.startsWith("/api/") && input.path !== "/api") return { ok: true };

  const fetchSite = input.fetchSite?.toLowerCase() ?? null;
  if (fetchSite !== null && FOREIGN_FETCH_SITES.has(fetchSite)) {
    return {
      ok: false,
      error: "Refused an API request sent by another site. Use this app from its own pages.",
    };
  }

  if (MUTATING_METHODS.has(input.method.toUpperCase()) && input.origin !== null) {
    const originHost = hostOfOrigin(input.origin);
    if (originHost === null || originHost !== target.host) {
      return {
        ok: false,
        error: `Refused a ${input.method.toUpperCase()} from origin "${input.origin}", which is not this app.`,
      };
    }
  }

  return { ok: true };
}

/**
 * What the real demo says of the CLI before its probe and review, both real
 * calls: under a sign-in billing per token, or that may, they cost API usage,
 * and the demo said nothing (review of D-161). The check it reads is free.
 */

import type { CliStatus } from "@/server/engine/probe";

/** The CLI's line in the demo's header. */
export function describeSignIn(cli: CliStatus): string {
  const where =
    cli.state === "notFound"
      ? "not found"
      : `${cli.path ?? "no path"}, ${cli.version ?? "no version"}`;
  switch (cli.state) {
    case "subscription":
      return `${where}, signed in through a subscription`;
    case "perToken":
      return `${where}, signed in (${cli.authMethod})`;
    case "maybePerToken":
      return `${where}, signed in${cli.authMethod === undefined ? "" : ` (${cli.authMethod})`}`;
    case "signedOut":
      return `${where}, signed out`;
    case "notFound":
    case "cannotRun":
      return where;
  }
}

const SETTING_METHODS: ReadonlySet<string> = new Set(["api_key_helper", "third_party"]);

/** Why the demo stops before spending, or null when it may go on. */
export function demoRefusal(cli: CliStatus, perTokenAllowed: boolean): string | null {
  const free = "Nothing was spent. Pass --fake to run it free.";
  switch (cli.state) {
    case "subscription":
      return null;
    case "notFound":
    case "cannotRun":
      return `The CLI cannot run the demo: ${cli.message} ${free}`;
    case "signedOut":
      return `The CLI at ${cli.path} is not signed in. ${free}`;
    case "perToken":
    case "maybePerToken": {
      if (perTokenAllowed) return null;
      // A setting gives an apiKeyHelper or another provider, and a review
      // here reads none, so for those it may (review of the D-164 fixes).
      const setting = cli.state === "perToken" && SETTING_METHODS.has(cli.authMethod);
      const how =
        cli.state === "perToken"
          ? `signed in (${cli.authMethod}) some other way than a Claude subscription, so this demo ${setting ? "may" : "would"} cost`
          : `signed in${cli.authMethod === undefined ? "" : ` (${cli.authMethod})`} in a way that may not be a Claude subscription, so this demo may cost`;
      return (
        `The CLI is ${how} API usage, billed per token. Nothing was spent. ` +
        "Pass --per-token to run it anyway, or --fake to run it free."
      );
    }
  }
}

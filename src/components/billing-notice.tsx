"use client";

/**
 * Said before a review that bills per token, or may, is started (D-161): on
 * the new-review screen as it opens, and on any page whose Start or Resume
 * the server refused because the page had not said it (review of D-161). And
 * on Settings as it opens, of the probes there, each a real call.
 */

import { Mono } from "@/components/ui";
import { signInPlaceWords, type SignIn } from "@/lib/engine/sign-in-command";

/** A sign-in billing per token, or that may, as /api/auth and a BillingNotShown refusal carry it. */
export interface Billing {
  state: "perToken" | "maybePerToken";
  authMethod?: string;
  signIn?: SignIn;
}

/** Null for anything else: a subscription, or a CLI the server refuses outright. */
export function billingOf(
  cli: { state?: unknown; authMethod?: unknown } | undefined,
  signIn: SignIn | undefined,
): Billing | null {
  if (cli?.state !== "perToken" && cli?.state !== "maybePerToken") return null;
  return {
    state: cli.state,
    ...(typeof cli.authMethod === "string" ? { authMethod: cli.authMethod } : {}),
    ...(signIn === undefined ? {} : { signIn }),
  };
}

/**
 * What a sign-in cannot override, by the method the CLI reports: the 2.1.301
 * binary takes a token set for it, an apiKeyHelper and another provider
 * before its claude.ai sign-in, so for these the sign-in command would change
 * nothing (review of the D-162 fixes). The last two can only come from a
 * managed policy: a review reads no settings (D-174), and the app keeps the
 * provider variables from the CLI.
 */
export function signInWouldHelp(authMethod: string | undefined): boolean {
  return authMethod !== "oauth_token" && settingOverSignIn(authMethod) === null;
}

/**
 * The sentence naming the setting that wins, or null when none is known to.
 * The check asks as every review reads, with no settings (D-170, D-174), so a
 * setting it names is one a review would use, and the one tier reading none
 * leaves is a managed policy's, which the 2.1.306 binary always reads; it may
 * be delivered to the person's account rather than kept on the machine, so
 * no place is named. Read from that binary's code, not measured: measuring
 * means writing a machine-wide policy file, which waits for the maintainer
 * (D-175). Said as so because the code leaves no other source; the flag
 * tier it also reads is one the app never passes.
 */
export function settingOverSignIn(authMethod: string | undefined): string | null {
  const setting =
    authMethod === "api_key_helper"
      ? "an apiKeyHelper"
      : authMethod === "third_party"
        ? "another provider"
        : null;
  if (setting === null) return null;
  return `This is ${setting} set by a managed Claude Code policy, which wins over a sign-in and over this app: whoever manages Claude Code for you can remove it.`;
}

/**
 * Said of every interactive review, whatever the check found: its commands
 * run in the person's own terminal, which keeps nothing out of the
 * environment the way a CLI the app starts does (D-174), and the check never
 * sees that terminal. Said only inside a notice, it went unsaid on a
 * subscription (review of D-174's changes).
 */
export function TerminalEnvironmentNote() {
  return (
    <p className="text-xs text-[var(--color-ink-muted)]" data-testid="terminal-environment-note">
      These commands run in your own terminal, with its environment, which this app cannot see: an
      API key or another provider set there wins over the sign-in and bills per token, and any other
      Claude Code variable set there applies to them too.
    </p>
  );
}

/** A sign-in command on a line of its own, so it is copied without the words around it. */
export function SignInLine({ signIn }: { signIn: SignIn }) {
  return (
    <p className="text-xs" data-testid="sign-in-command">
      <Mono className="break-all">{signIn.command}</Mono>
    </p>
  );
}

export function BillingNotice({
  billing,
  what = "review",
}: {
  billing: Billing;
  /**
   * What would cost: a review; an interactive one, whose printed commands run
   * this CLI in the person's own terminal; or on Settings, a model's probe.
   */
  what?: "review" | "interactive" | "probe";
}) {
  const { state, authMethod, signIn } = billing;
  const one = what === "probe" ? "a probe" : what === "interactive" ? "each one" : "a review";
  const remedy = signInWouldHelp(authMethod);
  const setting = settingOverSignIn(authMethod);
  const surely = state === "perToken";
  const unknownWay =
    authMethod === undefined
      ? "The CLI did not say how it is signed in"
      : `The CLI is signed in (${authMethod}), a way this app does not know`;
  const why =
    state === "perToken"
      ? `The CLI is signed in (${authMethod}) some other way than your Claude subscription, so ${one} ${surely ? "draws" : "may draw"} on paid API usage rather than your plan's usage limits.`
      : authMethod === "oauth_token"
        ? "The CLI is signed in with a token (oauth_token): one made by claude setup-token draws on your Claude subscription, and any other may cost API usage."
        : `${unknownWay}: unless it is your Claude subscription, ${one} draws on paid API usage rather than your plan's usage limits.`;
  return (
    <div
      role="alert"
      data-testid="per-token-notice"
      className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm"
    >
      <p className="font-medium">
        {what === "probe"
          ? "A probe"
          : what === "interactive"
            ? "The commands this review prints"
            : "This review"}{" "}
        {surely ? "will" : "may"} cost API usage, billed per token.
      </p>
      <p className="mt-1 text-xs">
        {why}
        {setting === null ? "" : ` ${setting}`}
        {!remedy
          ? ""
          : signIn === undefined
            ? " Sign it in with your Claude account to use the subscription."
            : ` To use the subscription, sign it in with your Claude account ${signInPlaceWords(signIn.place)}:`}
      </p>
      {!remedy || signIn === undefined ? null : (
        <p className="mt-1 text-xs">
          <Mono className="break-all">{signIn.command}</Mono>
        </p>
      )}
    </div>
  );
}

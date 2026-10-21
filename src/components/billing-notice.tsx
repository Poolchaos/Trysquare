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
 * nothing (review of the D-162 fixes). The last two can only come from the
 * person's Claude Code settings, since the app keeps the provider variables
 * from the CLI.
 */
export function signInWouldHelp(authMethod: string | undefined): boolean {
  return authMethod !== "oauth_token" && settingOverSignIn(authMethod) === null;
}

/** The sentence naming the setting that wins, or null when none is known to. */
export function settingOverSignIn(authMethod: string | undefined): string | null {
  const setting =
    authMethod === "api_key_helper"
      ? "an apiKeyHelper"
      : authMethod === "third_party"
        ? "another provider"
        : null;
  return setting === null
    ? null
    : `This is ${setting} set in your Claude Code settings, which wins over a sign-in: remove it there to use the subscription.`;
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
  const unknownWay =
    authMethod === undefined
      ? "The CLI did not say how it is signed in"
      : `The CLI is signed in (${authMethod}), a way this app does not know`;
  const why =
    state === "perToken"
      ? `The CLI is signed in (${authMethod}) some other way than your Claude subscription, so ${one} draws on paid API usage rather than your plan's usage limits.`
      : authMethod === "oauth_token"
        ? "The CLI is signed in with a token (oauth_token): one made by claude setup-token draws on your Claude subscription, and any other on paid API usage."
        : `${unknownWay}: unless it is your Claude subscription, ${one} draws on paid API usage rather than your plan's usage limits.`;
  const remedy = signInWouldHelp(authMethod);
  const setting = settingOverSignIn(authMethod);
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
        {state === "perToken" ? "will" : "may"} cost API usage, billed per token.
      </p>
      <p className="mt-1 text-xs">
        {why}
        {/* The app keeps keys from the CLIs it starts (D-161), not from a terminal's. */}
        {what === "interactive"
          ? " They run in your own terminal, and a key set in that terminal bills per token too."
          : ""}
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

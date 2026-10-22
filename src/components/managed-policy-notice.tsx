"use client";

/**
 * Said where a review is started and on Settings: a managed Claude Code
 * policy outranks every flag this app passes, so a review runs under it
 * whatever is set here (D-174 item 3). Warned of, not worked around, since it
 * is the machine owner's to set.
 */

import { Mono } from "@/components/ui";

/** As /api/auth carries it, from findManagedPolicy. */
export interface ManagedPolicy {
  found: string[];
  unchecked: string[];
}

/** An answer from a server that predates the field reads as nothing found. */
export function managedPolicyOf(value: { found?: unknown; unchecked?: unknown } | undefined) {
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  return { found: strings(value?.found), unchecked: strings(value?.unchecked) };
}

export function ManagedPolicyNotice({
  policy,
  withUnchecked = false,
}: {
  policy: ManagedPolicy;
  /** Settings says where it could not look; a page about to start a review does not. */
  withUnchecked?: boolean;
}) {
  const unchecked = withUnchecked ? policy.unchecked : [];
  if (policy.found.length === 0 && unchecked.length === 0) return null;
  return (
    <>
      {policy.found.length === 0 ? null : (
        <div
          role="alert"
          data-testid="managed-policy-notice"
          className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm"
        >
          <p className="font-medium">A managed Claude Code policy is set on this machine.</p>
          <p className="mt-1 text-xs">
            It outranks what this app sets, so every review runs under it: it can choose the model,
            limit the tools, or set a key that bills per token. Only whoever manages Claude Code on
            this machine can change it. Found at:
          </p>
          <ul className="mt-1 text-xs">
            {policy.found.map((place) => (
              <li key={place}>
                <Mono className="break-all">{place}</Mono>
              </li>
            ))}
          </ul>
        </div>
      )}
      {unchecked.length === 0 ? null : (
        <div
          data-testid="managed-policy-unchecked"
          className="text-xs text-[var(--color-ink-muted)]"
        >
          <p>Not looked at for a managed Claude Code policy:</p>
          <ul>
            {unchecked.map((place) => (
              <li key={place}>
                <Mono className="break-all">{place}</Mono>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

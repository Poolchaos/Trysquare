/**
 * Said of a project added before credentials in an address were refused
 * (D-208): the API no longer shows them, but the project's row, and its
 * clone's settings once it has one, still hold them, and nothing said which
 * projects do (audit finding R3, D-223; review round 13).
 */

import { Mono } from "@/components/ui";

export function StoredCredentialsNotice({
  stored,
  cloned,
  className = "",
}: {
  /** What the stored address carries, as the API serves it; null when nothing. */
  stored: { kind: string; address: string } | null | undefined;
  /**
   * The clone is ready. One that failed, or still runs, may have written a
   * clone before it stopped, with the address in its settings: git clone
   * writes them ahead of the steps that can still fail, and the app removes
   * nothing when one does.
   */
  cloned: boolean;
  className?: string;
}) {
  if (!stored) return null;
  const kind = stored.kind.charAt(0).toUpperCase() + stored.kind.slice(1);
  return (
    <div
      className={`rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm ${className}`}
    >
      <p className="font-medium">{kind} is still kept for this address.</p>
      <p className="mt-1 text-xs">
        It was added before Trysquare refused them, so it stays on this machine, in Trysquare&apos;s
        database and in{" "}
        {cloned ? "the clone's settings." : "the settings of any clone left on disk."} Delete this
        project and add <Mono className="[overflow-wrap:anywhere]">{stored.address}</Mono> instead
        to be rid of it.
      </p>
    </div>
  );
}

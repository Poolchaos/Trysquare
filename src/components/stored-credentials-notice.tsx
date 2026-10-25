/**
 * Said of a project added before credentials in an address were refused
 * (D-208): the API no longer shows them, but the project's row and its
 * clone's settings still hold them, and nothing said which projects do
 * (audit finding R3, D-223).
 */

import { Mono } from "@/components/ui";

export function StoredCredentialsNotice({
  cleanAddress,
  className = "",
}: {
  /** The address to add instead; null when the stored one carries none. */
  cleanAddress: string | null | undefined;
  className?: string;
}) {
  if (!cleanAddress) return null;
  return (
    <div
      className={`rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm ${className}`}
    >
      <p className="font-medium">A password or token is still kept for this address.</p>
      <p className="mt-1 text-xs">
        It was added before Trysquare refused them, so it stays on this machine, in Trysquare&apos;s
        database and in the clone&apos;s settings. Delete this project and add{" "}
        <Mono className="[overflow-wrap:anywhere]">{cleanAddress}</Mono> instead to be rid of it.
      </p>
    </div>
  );
}

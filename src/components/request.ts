/**
 * A screen's request that never throws past the message it owes a person.
 *
 * A dropped connection rejects, and an error page that is not JSON throws
 * when read as JSON; either escaped the screens that read responses bare, so
 * a delete or an export that failed showed nothing (review of 5.1 to 5.4).
 * Here each comes back as words to show: the server's own when it sent any,
 * otherwise `failure` with what went wrong.
 */
export type Sent<T> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      /** Null when no response arrived at all. */
      status: number | null;
      error: string;
      body: Record<string, unknown>;
    };

/**
 * @param failure What failed, without a full stop: "The review could not be
 *   deleted". A dropped request appends its reason after a colon.
 */
export async function send<T>(url: string, init: RequestInit, failure: string): Promise<Sent<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, error: `${failure}: ${reason}`, body: {} };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : `${failure}.`;
    return { ok: false, status: response.status, error, body };
  }
  return { ok: true, status: response.status, body: body as T };
}

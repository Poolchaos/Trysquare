import type { Page, Route } from "@playwright/test";

/**
 * Answers the first request matching `pattern` with `answer` and lets the
 * rest through, until the returned function removes the route.
 *
 * Used instead of `page.route(..., { times: 1 })` where a test then watches
 * for the page's next request. A route that expires and was the last one
 * switches interception off, and Playwright 1.62 holds each request until its
 * paused event arrives, which interception being off means it never does: the
 * request reaches the server but is never reported to the test. Seen on
 * Windows CI run 39059059261, where the page's reload after a 409 is in
 * Chromium's net log at 18:47:33.252 and in no request event.
 */
export async function answerOnce(
  page: Page,
  pattern: string,
  answer: (route: Route) => Promise<void>,
): Promise<() => Promise<void>> {
  let answered = false;
  const handler = async (route: Route) => {
    if (answered) return route.fallback();
    answered = true;
    await answer(route);
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

/**
 * Answers every request matching `pattern` with `answer` until the returned
 * function is called, which lets new requests through, waits for any answer
 * still being made, and only then removes the route. Removed first, the route
 * let a request still being answered through, and the answer's fulfill then
 * failed: "Route is already handled!".
 *
 * A test that ended with one still fetching failed, its response disposed
 * under it, or failed the test after it (D-146): an answer made by fetching
 * takes as long as the server does, and a test's last line does not wait for
 * the requests the screen sent before it. The ones that failed on macOS were
 * pre-flights the screen sent again needlessly (D-147).
 */
export async function routeUntilStopped(
  page: Page,
  pattern: string,
  answer: (route: Route) => Promise<void>,
): Promise<() => Promise<void>> {
  const answering = new Set<Promise<void>>();
  let stopping = false;
  const handler = (route: Route) => {
    if (stopping) return route.fallback();
    const answered = answer(route);
    answering.add(answered);
    return answered.finally(() => answering.delete(answered));
  };
  await page.route(pattern, handler);
  return async () => {
    stopping = true;
    await Promise.all(answering);
    await page.unroute(pattern, handler);
  };
}

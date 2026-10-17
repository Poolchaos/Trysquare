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

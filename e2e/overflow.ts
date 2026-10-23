import type { Page } from "@playwright/test";

/**
 * How far the page scrolls sideways, and the innermost elements past its
 * right edge, so a failure names what to fix. Linux and macOS fonts run
 * wider than Windows': a queue that fit here overflowed by 24px in CI (run
 * 39976799555) with nothing in the failure to say where. An element clipped
 * or scrolled by a container that itself fits, such as the bar's links, is
 * not the page's overflow and is left out.
 */
export async function sidewaysOverflow(page: Page): Promise<{ by: number; culprits: string[] }> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const past = (element: Element) => element.getBoundingClientRect().right > width + 0.5;
    const heldInside = (element: Element) => {
      for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
        if (getComputedStyle(up).overflowX !== "visible" && !past(up)) return true;
      }
      return false;
    };
    const over = new Set(
      [...document.querySelectorAll("body *")].filter(
        (element) => past(element) && !heldInside(element),
      ),
    );
    const culprits = [...over]
      .filter((element) => ![...element.children].some((child) => over.has(child)))
      .slice(0, 10)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}" ` +
          `ends at ${Math.round(element.getBoundingClientRect().right)}px of ${width}`,
      );
    return { by: document.documentElement.scrollWidth - width, culprits };
  });
}

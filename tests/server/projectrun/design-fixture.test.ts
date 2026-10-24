/**
 * The design fixture (WP-I step 6): its own e2e, run as the app runs a
 * project's, saves the screenshots its key names, and each page, measured
 * in a browser at the key's width, shows the planted defect the key gives
 * it and no other. The key is what a grade is scored against, so it is
 * proven here rather than trusted.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_CHECKS } from "@/lib/projects/checks";
import { runProjectChecks } from "@/server/projectrun/run";
// @ts-expect-error -- plain JavaScript so it can also be run from a shell.
import * as designFixture from "../../fixtures/build-design-fixture.mjs";

interface DesignManifest {
  branch: string;
  screens: {
    screenshot: string;
    page: string;
    viewport: "desktop" | "phone";
    defect: "overflow" | "contrast" | "clipped" | null;
  }[];
}
const { DESIGN_BRANCH, DESIGN_SCREENSHOT_DIR, buildDesignFixture } = designFixture as {
  DESIGN_BRANCH: string;
  DESIGN_SCREENSHOT_DIR: string;
  buildDesignFixture: (root: string) => { dir: string; manifest: DesignManifest };
};

const PLAYWRIGHT = dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json"));
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

let root: string;
let checkout: string;
let manifest: DesignManifest;
let browser: Browser;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-design-fixture-"));
  const built = buildDesignFixture(root);
  manifest = built.manifest;
  checkout = join(root, "checkout");
  execFileSync("git", ["clone", "-q", "-b", DESIGN_BRANCH, built.dir, checkout]);
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** The design defects a page shows at one width, as a browser measures them. */
async function measured(page: string, viewport: keyof typeof VIEWPORTS): Promise<string[]> {
  const tab = await browser.newPage({ viewport: VIEWPORTS[viewport] });
  try {
    await tab.goto(pathToFileURL(resolve(checkout, page)).href);
    return await tab.evaluate(() => {
      const found: string[] = [];
      const html = document.documentElement;
      if (html.scrollWidth > html.clientWidth) found.push("overflow");

      // WCAG relative luminance and contrast, against the nearest opaque
      // background up the tree (white when none is set).
      const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = ([r, g, b]: number[]) => {
        const linear = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
      };
      const backgroundOf = (element: Element | null): number[] => {
        for (let at = element; at; at = at.parentElement) {
          const [r, g, b, a = 1] = channels(getComputedStyle(at).backgroundColor);
          if (a > 0) return [r!, g!, b!];
        }
        return [255, 255, 255];
      };
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const ownText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
        );
        if (!ownText) continue;
        const fore = luminance(channels(getComputedStyle(element).color));
        const back = luminance(backgroundOf(element));
        const ratio = (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
        if (ratio < 4.5) {
          found.push("contrast");
          break;
        }
      }

      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const style = getComputedStyle(element);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        if (
          element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1
        ) {
          found.push("clipped");
          break;
        }
      }
      return found;
    });
  } finally {
    await tab.close();
  }
}

describe("the design fixture", () => {
  it("photographs every page at both widths through its own e2e, as the app runs it", async () => {
    const run = await runProjectChecks({
      checks: {
        ...NO_CHECKS,
        enabled: true,
        e2eCommand: `"${process.execPath}" e2e/shoot.mjs "${PLAYWRIGHT}"`,
        screenshotDir: DESIGN_SCREENSHOT_DIR,
      },
      copyDir: checkout,
      logDir: join(root, "logs"),
      screenshotsDir: join(root, "screens"),
    });
    expect(run.commands.map((command) => [command.step, command.exitCode])).toEqual([["e2e", 0]]);
    expect(run.screenshots.map((shot) => shot.name)).toEqual(
      manifest.screens.map((screen) => screen.screenshot),
    );
  }, 120_000);

  it("shows each planted defect where its key says, and nothing on a clean screen", async () => {
    for (const screen of manifest.screens) {
      expect(await measured(screen.page, screen.viewport), screen.screenshot).toEqual(
        screen.defect === null ? [] : [screen.defect],
      );
    }
    // One of each, and clean screens beside them.
    expect(new Set(manifest.screens.map((screen) => screen.defect))).toEqual(
      new Set([null, "overflow", "contrast", "clipped"]),
    );
  }, 120_000);
});

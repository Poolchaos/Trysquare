#!/usr/bin/env node
/**
 * Builds the design fixture (proof-and-steps plan, WP-I step 6): a small
 * storefront whose feature branch adds screens, three with a planted design
 * defect and the rest clean, and its own e2e that photographs every page at
 * desktop and phone width. The key says which screenshot shows which defect;
 * tests/server/projectrun/design-fixture.test.ts measures each page in a
 * browser and holds the key to what it measures, so a grade can be scored
 * against something proven rather than something written down.
 *
 * The e2e is handed the path of a Playwright install, since the fixture has
 * none of its own and installing one per review would mean the network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
}

function write(root, path, contents) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function commitAll(root, message) {
  git(["add", "-A"], root);
  git(["commit", "-qm", message], root);
}

/** The branch the screens are added on, reviewed into main. */
export const DESIGN_BRANCH = "feature/checkout-screens";

/** Where the fixture's e2e saves its screenshots. */
export const DESIGN_SCREENSHOT_DIR = "e2e/screens";

/** The fixture's design standard, the graders' brief beside the scale. */
export const DESIGN_STANDARD_PATH = "DESIGN.md";

const DESIGN_STANDARD = `# Storefront design standard

- Body text has a contrast of at least 4.5:1 against its background.
- Nothing scrolls sideways on a 390px-wide phone.
- No text is cut off by the box it sits in.
- One heading per screen, and every action a person can take is a visible button.
`;

const STYLE = `* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1d2330; background: #ffffff; }
header { padding: 16px 24px; border-bottom: 1px solid #d5d9e0; font-weight: 600; }
main { padding: 24px; max-width: 720px; }
h1 { font-size: 24px; margin: 0 0 12px; }
p { margin: 0 0 12px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
td, th { padding: 8px; border-bottom: 1px solid #d5d9e0; text-align: left; }
.button { display: inline-block; padding: 10px 16px; border-radius: 6px; background: #1f5f8b; color: #ffffff; }
`;

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>Storefront</header>
<main>
${body}
</main>
</body>
</html>
`;

const ORDERS = page(
  "Orders",
  `<h1>Your orders</h1>
<p>Three orders in the last month.</p>
<table>
<tr><th>Order</th><th>Total</th></tr>
<tr><td>1041</td><td>R 320.00</td></tr>
<tr><td>1038</td><td>R 95.50</td></tr>
<tr><td>1022</td><td>R 1 210.00</td></tr>
</table>`,
);

const HELP = page(
  "Help",
  `<h1>Help</h1>
<p>Questions about an order? Write to us and we answer within a day.</p>
<p><span class="button">Contact us</span></p>`,
);

/** A table set 640px wide: on a 390px phone it runs off the right edge. */
const CHECKOUT = page(
  "Checkout",
  `<h1>Checkout</h1>
<table style="width: 640px">
<tr><th>Item</th><th>Size</th><th>Quantity</th><th>Price</th><th>Subtotal</th></tr>
<tr><td>Canvas tote</td><td>Large</td><td>2</td><td>R 150.00</td><td>R 300.00</td></tr>
<tr><td>Enamel mug</td><td>350ml</td><td>1</td><td>R 95.50</td><td>R 95.50</td></tr>
</table>
<p><span class="button">Pay R 395.50</span></p>`,
);

/** The totals set in a light grey on white, far under 4.5:1. */
const RECEIPT = page(
  "Receipt",
  `<h1>Receipt</h1>
<p>Thank you for your order.</p>
<p style="color: #c8c8c8">Order 1042, paid R 395.50 on 1 January 2026.</p>`,
);

/** A label in a box one line high, its second line cut off. */
const PROFILE = page(
  "Profile",
  `<h1>Profile</h1>
<p>Where we deliver, and how we reach you.</p>
<p><span class="button" style="display: block; width: 150px; height: 44px; overflow: hidden">Save your delivery preferences for next time</span></p>`,
);

const CONFIRMATION = page(
  "Confirmation",
  `<h1>Order placed</h1>
<p>We sent the receipt to your email address.</p>
<p><span class="button">Back to your orders</span></p>`,
);

const SHOOT = `/**
 * The storefront's e2e: every page in pages/, photographed at desktop and
 * phone width into ${DESIGN_SCREENSHOT_DIR}/<viewport>/<page>.png.
 *
 *   node e2e/shoot.mjs <path to a @playwright/test install>
 */

import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const playwright = process.argv[2];
if (!playwright) {
  console.error("Give the path of a @playwright/test install.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(playwright);

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

const browser = await chromium.launch();
try {
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    const tab = await browser.newPage({ viewport: size });
    const into = join(${JSON.stringify(DESIGN_SCREENSHOT_DIR)}, viewport);
    mkdirSync(into, { recursive: true });
    for (const file of readdirSync("pages").filter((name) => name.endsWith(".html")).sort()) {
      await tab.goto(pathToFileURL(resolve("pages", file)).href);
      // The screen as a person sees it, so what runs off it is cut off.
      await tab.screenshot({ path: join(into, file.replace(/\\.html$/, ".png")) });
      console.log(\`\${viewport}/\${file}\`);
    }
    await tab.close();
  }
} finally {
  await browser.close();
}
`;

/**
 * The key: each screenshot the e2e saves, and the defect it shows, or null
 * for a clean one. The checkout table fits a desktop and overflows a phone.
 */
const KEY = [
  ["checkout", { desktop: null, phone: "overflow" }],
  ["confirmation", { desktop: null, phone: null }],
  ["help", { desktop: null, phone: null }],
  ["orders", { desktop: null, phone: null }],
  ["profile", { desktop: "clipped", phone: "clipped" }],
  ["receipt", { desktop: "contrast", phone: "contrast" }],
];

export function buildDesignFixture(root) {
  const dir = join(root, "storefront");
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir], { env: { ...process.env, ...GIT_ENV } });
  git(["config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL], dir);
  git(["config", "user.name", GIT_ENV.GIT_AUTHOR_NAME], dir);

  write(dir, DESIGN_STANDARD_PATH, DESIGN_STANDARD);
  write(dir, "pages/style.css", STYLE);
  write(dir, "pages/orders.html", ORDERS);
  write(dir, "pages/help.html", HELP);
  write(dir, "e2e/shoot.mjs", SHOOT);
  write(dir, ".gitignore", `${DESIGN_SCREENSHOT_DIR}/\n`);
  commitAll(dir, "Orders and help");

  git(["checkout", "-q", "-b", DESIGN_BRANCH], dir);
  write(dir, "pages/checkout.html", CHECKOUT);
  write(dir, "pages/receipt.html", RECEIPT);
  write(dir, "pages/profile.html", PROFILE);
  write(dir, "pages/confirmation.html", CONFIRMATION);
  commitAll(dir, "Checkout, receipt, profile and confirmation screens");
  git(["checkout", "-q", "main"], dir);

  const screens = KEY.flatMap(([name, byViewport]) =>
    Object.entries(byViewport).map(([viewport, defect]) => ({
      screenshot: `${viewport}/${name}.png`,
      page: `pages/${name}.html`,
      viewport,
      defect,
    })),
  ).sort((a, b) => a.screenshot.localeCompare(b.screenshot));
  const manifest = { branch: DESIGN_BRANCH, screens };
  write(root, "design-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

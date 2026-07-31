import { defineConfig } from "@playwright/test";
import { ANSWERS_DIR, COUNTER_FILE, DATA_DIR, FAKE_CLI } from "./e2e/setup";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  // No retries: a test that only passes on retry is failing.
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/setup.ts",
  // The journey walks one review from an empty app to an exported report, so
  // its steps are deliberately dependent and run in order.
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // The journey mutates the app: it adds a project, imports rules, and runs
    // a review. It runs once, and the theme passes then photograph what it
    // left behind. Running it twice would fail on its own second attempt to
    // add the same repository, which is correct behaviour and a useless test.
    { name: "journey", testMatch: /journey\.spec\.ts/, use: { colorScheme: "light" } },
    {
      name: "light",
      testMatch: /themes\.spec\.ts/,
      dependencies: ["journey"],
      use: { colorScheme: "light" },
    },
    // Both themes are first-class, so both are photographed rather than one
    // being checked and the other assumed.
    {
      name: "dark",
      testMatch: /themes\.spec\.ts/,
      dependencies: ["journey"],
      use: { colorScheme: "dark" },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      TRYSQUARE_DATA: DATA_DIR,
      // The fake, so the whole journey spends nothing.
      TRYSQUARE_CLAUDE_PATH: FAKE_CLI,
      FAKE_CLAUDE_SCENARIO: "script",
      FAKE_CLAUDE_DIR: ANSWERS_DIR,
      FAKE_CLAUDE_COUNTER: COUNTER_FILE,
    },
  },
});

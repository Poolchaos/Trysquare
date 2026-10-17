import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import {
  ANSWERS_DIR,
  COUNTER_FILE,
  DATA_DIR,
  FAKE_CLI,
  LIMIT_TRIGGER,
  STALL_TRIGGER,
} from "./e2e/setup";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Chromium's own network log, on Windows CI only. Windows CI has refused a
 * loopback connect with ERR_NO_BUFFER_SPACE, and nothing else on record names
 * the socket call that failed or its OS error (D-104, D-105). One file per
 * worker process: a failure restarts the worker, and a fixed name would be
 * overwritten by the next browser.
 */
const NET_LOG_ARGS =
  process.platform === "win32" && process.env.CI === "true"
    ? [`--log-net-log=${resolve("test-results", `chromium-netlog-${process.pid}.json`)}`]
    : [];

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
    launchOptions: { args: NET_LOG_ARGS },
  },
  projects: [
    // The journey mutates the app: it adds a project, imports rules, and runs
    // a review. It runs once, and the theme passes then photograph what it
    // left behind. Running it twice would fail on its own second attempt to
    // add the same repository, which is correct behaviour and a useless test.
    { name: "journey", testMatch: /journey\.spec\.ts/, use: { colorScheme: "light" } },
    // The endings that are not success. After the journey, because they reuse
    // the project and ruleset it leaves behind; before the theme passes, so
    // the screenshots are of a settled app rather than one mid-experiment.
    {
      name: "failure-paths",
      testMatch: /failure-paths\.spec\.ts/,
      dependencies: ["journey"],
      use: { colorScheme: "light" },
    },
    {
      name: "light",
      testMatch: /themes\.spec\.ts/,
      dependencies: ["failure-paths"],
      use: { colorScheme: "light" },
    },
    // Both themes are first-class, so both are photographed rather than one
    // being checked and the other assumed.
    {
      name: "dark",
      testMatch: /themes\.spec\.ts/,
      dependencies: ["failure-paths"],
      use: { colorScheme: "dark" },
    },
    // Servers of its own, on data directories of their own, so it depends on
    // nothing the others leave and stopping them disturbs none of it.
    { name: "shutdown", testMatch: /shutdown\.spec\.ts/ },
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
      FAKE_CLAUDE_LIMIT_FILE: LIMIT_TRIGGER,
      FAKE_CLAUDE_STALL_FILE: STALL_TRIGGER,
    },
  },
});

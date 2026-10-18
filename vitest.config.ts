import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "tests/fixtures/**"],
    // A test that only passes on retry is failing (CLAUDE.md section 6).
    retry: 0,
    // Git starts slowly on Windows runners: a gitops test took 6.1s on
    // windows-latest against the 5s default (run 39014903213). A hang still
    // fails, thirty seconds in.
    testTimeout: 30_000,
    // Hooks the same. A quality-gate test's synchronous database setup or
    // teardown ran past the 10s default on windows-latest while the whole
    // runner was slow: that unit run took 154.67s against 81.73s at the next
    // green one, and tests in two other files took 19.8s and 9.6s against
    // 0.7s and 0.9s (runs 39145501965 and 39147088736, D-139).
    hookTimeout: 30_000,
    // Let console output reach stdout. Vitest intercepts it by default, which
    // hides runtime errors a test logs from verify.sh's error-marker scan.
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

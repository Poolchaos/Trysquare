import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * At most 4 workers, whatever the machine. Vitest's default is a worker per
 * CPU thread less one, which is 15 on a 16-thread laptop. Measured 2026-11-03
 * on Linux with 3 workers: each process stayed between 260 and 332 MB for the
 * whole suite, 788 MB for all four together, and 63.5s.
 */
export function testWorkerCount(threads: number): number {
  return Math.max(1, Math.min(threads - 1, 4));
}

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: testWorkerCount(availableParallelism()),
    // A worker that leaks stops at a 1 GB heap and fails its own tests, rather
    // than growing until the machine swaps. Three times the largest measured above.
    execArgv: ["--max-old-space-size=1024"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "tests/fixtures/**"],
    // A test that only passes on retry is failing (CLAUDE.md section 6).
    retry: 0,
    // Git starts slowly on Windows runners: a gitops test took 6.1s on
    // windows-latest against the 5s default (run 39014903213). A hang still
    // fails, thirty seconds in.
    testTimeout: 30_000,
    // Hooks the same. A quality-gate test's synchronous database setup or
    // teardown ran past the 10s default on windows-latest in a run where
    // tests in two other files took 19.8s and 9.6s, against 0.7s and 0.9s at
    // the next green run (runs 39145501965 and 39147088736, D-139, D-140).
    hookTimeout: 30_000,
    // Let console output reach stdout. Vitest intercepts it by default, which
    // hides runtime errors a test logs from verify.sh's error-marker scan.
    disableConsoleIntercept: true,
    // Refuses the real Claude Code CLI to every test that did not ask for it.
    setupFiles: ["tests/helpers/no-real-cli.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "tests/fixtures/**"],
    // A test that only passes on retry is failing (CLAUDE.md section 6).
    retry: 0,
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

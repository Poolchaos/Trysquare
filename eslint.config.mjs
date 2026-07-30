import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships flat configs directly. Loading them through
// FlatCompat throws on a circular plugin reference.
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "drizzle/**",
      "tests/fixtures/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;

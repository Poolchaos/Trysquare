/**
 * `npm run doctor` checks that this machine can run Trysquare. It runs before
 * `npm run dev` (the predev script), so a missing piece is named before the app
 * fails on it. A failed check stops the run with exit 1. A warning is something
 * the app starts without but a review cannot run without: it is printed and
 * the run goes on. It creates the data directory and changes nothing else; to
 * sign in, use `npm run claude:auth`.
 */

import { runDoctor } from "./lib/doctor";

const checks = await runDoctor();
for (const check of checks) {
  const tag = check.level === "ok" ? "ok  " : check.level === "warn" ? "WARN" : "FAIL";
  console.log(`${tag} ${check.label}: ${check.detail}`);
}
const failed = checks.filter((check) => check.level === "fail").length;
const warned = checks.filter((check) => check.level === "warn").length;
if (failed > 0) {
  console.error(`${failed} required check(s) failed. Fix them, then run this again.`);
  process.exit(1);
}
if (warned > 0) {
  console.log(
    `${warned} warning(s). The app will start, but a review needs the items marked WARN.`,
  );
} else {
  console.log("All checks passed.");
}

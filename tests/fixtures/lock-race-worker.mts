/**
 * One of two processes racing for data directory locks, trial by trial.
 *
 * Each trial waits at a barrier the test opens for both at once, then tries
 * the lock and writes what happened. It stays alive afterwards, so the other
 * process always finds this one running.
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireDataDirLock } from "../../src/server/data-dir-lock";

const [base, id, countText] = process.argv.slice(2);
const count = Number(countText);

for (let trial = 0; trial < count; trial += 1) {
  writeFileSync(join(base!, `ready-${trial}-${id}`), "");
  const go = join(base!, `go-${trial}`);
  while (!existsSync(go)) {
    // Spinning, so both leave the barrier within microseconds of each other.
  }
  let result: string;
  try {
    // A short wait: the two start microseconds apart, and a second's wait on
    // every refused start would add a second to every trial.
    acquireDataDirLock(join(base!, `dir-${trial}`), 100);
    result = "held";
  } catch (error) {
    result = (error as Error).name;
  }
  // Written beside it and renamed into place: the test reads a result the
  // moment it exists, and a file created before its word was written read
  // as "" (macOS CI run 39127235484, trial 5).
  const done = join(base!, `result-${trial}-${id}`);
  writeFileSync(`${done}.partial`, result);
  renameSync(`${done}.partial`, done);
}
setTimeout(() => {}, 60_000);

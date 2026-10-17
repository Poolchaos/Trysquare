/**
 * One of two processes racing for data directory locks, trial by trial.
 *
 * Each trial waits at a barrier the test opens for both at once, then tries
 * the lock and writes what happened. It stays alive afterwards, so the other
 * process always finds this one running.
 */

import { existsSync, writeFileSync } from "node:fs";
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
    acquireDataDirLock(join(base!, `dir-${trial}`));
    result = "held";
  } catch (error) {
    result = (error as Error).name;
  }
  writeFileSync(join(base!, `result-${trial}-${id}`), result);
}
setTimeout(() => {}, 60_000);

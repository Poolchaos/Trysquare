/**
 * Another server, for the lock tests: takes a data directory's lock and
 * says so. With "hold" it stays alive holding it; with "try" it reports and
 * exits.
 */

import { acquireDataDirLock } from "../../src/server/data-dir-lock";

const [dataDir, mode] = process.argv.slice(2);
try {
  acquireDataDirLock(dataDir!);
  process.stdout.write(`held ${process.pid}\n`);
} catch (error) {
  process.stdout.write(`${(error as Error).name}\n`);
  process.exit(0);
}
if (mode === "hold") setInterval(() => {}, 1000);
else process.exit(0);

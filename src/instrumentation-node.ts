/**
 * The Node side of startup.
 *
 * Imported dynamically from `instrumentation.ts` only when the runtime is
 * Node, so the edge compilation of the instrumentation hook never sees a
 * node: import. The work itself is `runtime()`, the same idempotent door
 * every route handler uses: it opens the database once per process, migrates,
 * and recovers orphaned reviews, and calling it here simply makes that happen
 * at server start instead of at the first request.
 */

import { SHUTDOWN } from "@/lib/domain/shutdown";
import { runtime } from "@/server/runtime";

const { manager } = runtime();

/**
 * Stops every running review when the server is told to stop. Next handles
 * the same signals and exits once its own cleanup is done, which this cannot
 * hold up, but the aborts inside drain() run before its first await, so each
 * stage's CLI has been signalled before Next gets that far. Without this a
 * killed server left its claude children running and spending on POSIX,
 * where a child outlives its parent. The reviews end interrupted, as a crash
 * leaves them, and resume from their checkpoints.
 */
const stop = () => void manager.drain(SHUTDOWN);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

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

import { runtime } from "@/server/runtime";

runtime();

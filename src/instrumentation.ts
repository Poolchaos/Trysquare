/**
 * What runs once, when the server starts.
 *
 * Next compiles this file for its edge runtime as well as for Node, and the
 * edge compiler statically flags any node: import it can see, including one
 * inside an unreached branch. So this file imports nothing at all: the guard
 * decides the runtime, and the Node-only work lives in `instrumentation-node`,
 * reached through a dynamic import the edge build does not follow.
 *
 * The work itself is opening the database, migrating it, and recovering
 * reviews a previous process left marked as running. A review in that state
 * cannot be running, because nothing survived the restart that could be
 * running it, and until it is recovered it can neither be started nor
 * cancelled.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node");
}

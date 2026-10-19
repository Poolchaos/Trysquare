/**
 * Whether `error` was thrown by a class of one of these names, whichever
 * copy of its module that was.
 *
 * The job manager a route reaches through runtime() was built by the
 * instrumentation bundle's copy of the server modules, and the routes share
 * another, so an error the manager threw was never an instance of a class a
 * route or the HTTP handler held, and refusals meant as 404s and 409s went
 * out as 500s (D-139, D-140). So the HTTP layer, and any file that calls the
 * manager, matches an error by the name its class sets, never `instanceof`
 * (D-141). Minification renames the classes and leaves the names alone.
 *
 * A subclass that sets a name of its own is matched by that name only, never
 * by its parent's: name it too.
 */
export function isNamed<T extends Error = Error>(
  error: unknown,
  ...names: readonly string[]
): error is T {
  return error instanceof Error && names.includes(error.name);
}

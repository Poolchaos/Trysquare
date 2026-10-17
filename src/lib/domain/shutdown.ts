/**
 * The reason a run is aborted with when the server, not a person, stops it.
 *
 * A cancel is final; a shutdown is not, so the review is left interrupted, as
 * a crash leaves it, and resumes from its checkpoints. The engine reads it
 * too: a stage told to stop before its CLI has started does not start it,
 * since the server is about to exit and nothing would read its output.
 */
export const SHUTDOWN = Symbol.for("trysquare.shutdown");

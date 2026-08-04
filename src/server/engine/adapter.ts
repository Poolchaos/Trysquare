/**
 * The seam between the pipeline and whatever actually answers a stage.
 *
 * 01 section 6 always described two engines: the headless one that spawns the
 * CLI, and an interactive one for a person who would rather drive their own
 * session. Only the first was ever built, and the pipeline called into it
 * directly, so there was nowhere to put the second.
 *
 * The interface is deliberately the narrowest thing the pipeline already
 * needs: ask a question, get a validated answer. Everything that differs
 * between the two engines (who spends the tokens, whether a subprocess exists
 * at all, how a session is resumed) stays behind it, which is what lets a
 * policy change stop at this file.
 */

import type { EngineMode } from "@/lib/domain/enums";
import type { StageRequest, StageResponse } from "@/server/review/pipeline";

export interface ReviewEngine {
  /** Which of 01 section 6's two engines this is, for the record and the UI. */
  readonly mode: EngineMode;
  run: (request: StageRequest) => Promise<StageResponse>;
  /**
   * The session the chained stages share, for a resume.
   *
   * Undefined is a legitimate answer, not a missing feature: an engine with
   * no session to rejoin (Mode B, where the session belongs to the person)
   * has nothing to hand back.
   */
  chainSessionId: () => string | undefined;
}

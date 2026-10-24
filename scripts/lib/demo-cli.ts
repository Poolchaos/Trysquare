/**
 * What a demo checks before a real review spends anything: how the CLI is
 * signed in, and that the review's model and the second verifier it pairs
 * with both answer. Shared by the fixture demos, so each refuses alike.
 */

import { pairedVerifierFor } from "@/lib/models/pairing";
import { configuredClaudePath } from "@/server/cli-path";
import type { Db } from "@/server/db/client";
import { recordProbeSuccess, registerCandidate } from "@/server/db/repositories/models";
import { probeModel, readCliStatus } from "@/server/engine/probe";
import { demoRefusal, describeSignIn } from "./demo-billing";

/** Grouped with commas whatever the machine's locale says: the output is evidence. */
const count = (value: number): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The CLI to run the review with, or null when the run must stop, having
 * said why and sent no review request.
 */
export async function readyForReview(
  db: Db,
  options: { model: string; perToken: boolean; log: (line: string) => void },
): Promise<{ claudePath?: string } | null> {
  const { log } = options;
  // One CLI for the check, the probe and the review: TRYSQUARE_CLAUDE_PATH's,
  // else the bundled CLI, else claude on PATH, since the demo's own data
  // directory holds no path from Settings. Checked by the bundled CLI and run by the variable's, the
  // check vouched for a CLI the review never used (review of the D-163 fixes).
  const claudePath = configuredClaudePath(db);
  const onPath = claudePath === undefined ? {} : { claudePath };

  const cli = await readCliStatus(onPath);
  log(`CLI      ${describeSignIn(cli)}`);
  const refusal = demoRefusal(cli, options.perToken);
  if (refusal !== null) {
    log(refusal);
    return null;
  }
  // The review's model and the second verifier it pairs with (WP-E), both
  // probed before a review request is sent: the app refuses Start on an
  // unprobed pair, and this calls the manager past that check, so without
  // it a pair that cannot answer failed the run after five paid stages.
  const family = (model: string) => model.split("-")[1] ?? "unknown";
  for (const model of [options.model, pairedVerifierFor(family(options.model))]) {
    log(`Probing ${model}...`);
    const probe = await probeModel(model, onPath);
    if (probe.status !== "available") {
      log(`The model is not usable: ${probe.error}`);
      log("No review request was sent. Pass --fake to run the demo without a model.");
      return null;
    }
    registerCandidate(db, {
      id: model,
      family: family(model),
      displayName: model,
      profileId: "full-context",
    });
    recordProbeSuccess(db, model, {
      resolvedId: probe.resolvedId,
      contextWindow: probe.contextWindow,
    });
    log(`Available as ${probe.resolvedId}, ` + `${count(probe.contextWindow)} token window.`);
  }
  return onPath;
}

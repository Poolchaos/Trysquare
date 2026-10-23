/**
 * The five steps a person reads, mapped onto the eight stages that do the
 * work (proof-and-steps plan, WP-G; the approved mockup, PG-4, D-187).
 *
 * Pure, so the live view and the finished summary say the same thing. Every
 * count is one the review has measured; a step that has not begun says it is
 * waiting rather than guessing at a number.
 */

export const STEPS = [
  {
    title: "Understand the rules",
    what: "The ruleset is frozen for this review, and the mechanical sweeps mark every line a rule names.",
    stages: ["s0_prepare"],
  },
  {
    title: "Understand the change",
    what: "Each changed file is classed by risk and read with what it calls into.",
    stages: ["s1_risk", "s2_comprehension"],
  },
  {
    title: "Find issues",
    what: "Every rule is walked against every change, and every deletion is accounted for.",
    stages: ["s3_adversarial", "s4_deletions"],
  },
  {
    title: "Prove each finding",
    what: "Two independent verifiers must each trace the failure through the code.",
    stages: ["s5_verification", "s5b_second_verification"],
  },
  {
    title: "Report",
    what: "Coverage is audited, then you confirm. Only proven findings can be confirmed.",
    stages: ["s6_audit"],
  },
] as const;

export type StepState = "done" | "now" | "next";

/**
 * Where a review is: the steps before the running stage's done, its own now.
 * The report is the person's step: now while the review waits on them, done
 * once it is complete.
 */
export function stepStates(input: {
  /** Whether a stage has finished, the app-code stages included. */
  stageDone: (stage: string) => boolean;
  executing: string | null;
  status: string;
}): StepState[] {
  return STEPS.map((step, index) => {
    if (index === STEPS.length - 1) {
      if (input.status === "complete") return "done";
      if (input.status === "awaiting_confirmation") return "now";
    }
    if ((step.stages as readonly string[]).includes(input.executing ?? "")) return "now";
    return step.stages.every((stage) => input.stageDone(stage)) ? "done" : "next";
  });
}

export interface FindingTallies {
  raised: number;
  /** The first verifier's proof held. */
  provenOnce: number;
  /** Both verifiers' proofs held. */
  provenTwice: number;
  /** Not proven: an open question, or one left out unproven (D-190). */
  open: number;
  /** The verifier refuted it. */
  refuted: number;
  /** Its quotation was not the code at those lines. */
  discarded: number;
  /** Still a candidate, not yet ruled on. */
  toProve: number;
}

export function findingTallies(
  findings: readonly {
    status: string;
    killedBy?: string | null;
    dismissedFrom?: string | null;
    proofJson?: string | null;
    secondProofJson?: string | null;
  }[],
): FindingTallies {
  const count = (keep: (finding: (typeof findings)[number]) => boolean) =>
    findings.filter(keep).length;
  return {
    raised: findings.length,
    provenOnce: count((finding) => Boolean(finding.proofJson)),
    provenTwice: count((finding) => Boolean(finding.secondProofJson)),
    open: count(
      (finding) =>
        finding.status === "open_question" ||
        (finding.status === "dismissed" && finding.dismissedFrom === "open_question"),
    ),
    refuted: count((finding) => finding.status === "killed" && finding.killedBy === "verification"),
    discarded: count(
      (finding) => finding.status === "killed" && finding.killedBy === "quote_check",
    ),
    toProve: count((finding) => finding.status === "candidate"),
  };
}

export interface StepFacts {
  /** Rules the review is frozen with; null before it is frozen. */
  rules: number | null;
  files: number;
  tallies: FindingTallies;
  /** Findings waiting on the person's decision. */
  waiting: number;
}

export interface StepUsage {
  requests: number;
  ms: number;
}

/**
 * Each step's requests and the time they took. A stage row is one request
 * (stage-executions.ts), retries and failures included, since each was sent;
 * the app-code steps write none.
 */
export function stepUsage(
  rows: readonly { stage: string; startedAt: string; endedAt: string | null }[],
): StepUsage[] {
  return STEPS.map((step) => {
    const mine = rows.filter((row) => (step.stages as readonly string[]).includes(row.stage));
    return {
      requests: mine.length,
      ms: mine.reduce(
        (sum, row) =>
          row.endedAt === null
            ? sum
            : sum + Math.max(0, Date.parse(row.endedAt) - Date.parse(row.startedAt)),
        0,
      ),
    };
  });
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const noneOr = (n: number, rest: string) => `${n === 0 ? "none" : n} ${rest}`;

/**
 * What each step came to on a review that has reached a person. Reviews from
 * before the second verifier (WP-E) have no verifier model, and their proven
 * findings were proven once.
 */
export function stepResult(
  index: number,
  facts: StepFacts & { status: string; secondVerifier: boolean },
): string {
  const { tallies } = facts;
  switch (index) {
    case 0:
      return facts.rules === null
        ? "The sweeps marked every line a rule names."
        : `${facts.rules} rules frozen for this review, and the sweeps marked every line a rule names.`;
    case 1:
      return facts.files === 1
        ? "1 changed file classed by risk and read with what it calls into."
        : `${facts.files} changed files classed by risk and read with what they call into.`;
    case 2:
      return `${tallies.raised === 0 ? "No candidates" : counted(tallies.raised, "candidate", "candidates")} raised, and every change and deletion accounted for.`;
    case 3: {
      if (tallies.raised === 0) return "Nothing to prove.";
      const proven = facts.secondVerifier
        ? noneOr(tallies.provenTwice, "proven by both verifiers")
        : noneOr(tallies.provenOnce, "proven");
      const open =
        tallies.open === 0
          ? "no open questions"
          : counted(tallies.open, "open question", "open questions");
      const line = `${proven}, ${open}, ${noneOr(tallies.refuted, "refuted")}, ${noneOr(tallies.discarded, "discarded")} for quoting code that was not there.`;
      return line.charAt(0).toUpperCase() + line.slice(1);
    }
    default:
      return facts.status === "complete"
        ? "Coverage audited, every finding decided, and the report written."
        : "Coverage audited. Your confirmation, then the report.";
  }
}

/** The one line each step's card shows. */
export function stepCount(index: number, state: StepState, facts: StepFacts): string {
  if (state === "next") return "Waiting";
  const { tallies } = facts;
  switch (index) {
    case 0:
      return facts.rules === null ? "Freezing the ruleset" : `${facts.rules} rules frozen`;
    case 1:
      return state === "done" ? `${facts.files} files read` : `Reading ${facts.files} files`;
    case 2:
      // Running, it has raised what it has so far, which is not yet a result.
      if (state === "now") {
        return tallies.raised === 0 ? "Walking the rules" : `${tallies.raised} candidates so far`;
      }
      return `${tallies.raised} candidates raised`;
    case 3:
      return state === "done"
        ? `${tallies.provenTwice} proven by both verifiers`
        : `${tallies.toProve} to prove`;
    default:
      return state === "done" ? "Reported" : `${facts.waiting} wait for you`;
  }
}

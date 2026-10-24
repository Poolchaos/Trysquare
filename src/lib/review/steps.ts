/**
 * The five steps a person reads, mapped onto the ten stages that do the
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
    what: "Every rule is walked against every change, every deletion is accounted for, and the project's screens are graded when its e2e saved any.",
    stages: ["s3_adversarial", "s4_deletions", "s4b_design_grading"],
  },
  {
    title: "Prove each finding",
    what: "Two independent verifiers must each trace the failure through the code, and a screen graded C or D must be graded so again by a second grader.",
    stages: ["s5_verification", "s5b_second_verification", "s5c_design_second"],
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
  /**
   * A first verifier's proof held, whatever became of it after: the second
   * may since have disagreed, or a person dismissed it.
   */
  provenOnce: number;
  /** Proven by the first verifier and not since an open question. */
  proven: number;
  /** Both verifiers' proofs held. */
  provenTwice: number;
  /** Not proven: an open question, or one left out unproven (D-190). */
  open: number;
  /** The verifier refuted it. */
  refuted: number;
  /** Its quotation was not the code at those lines. */
  discarded: number;
  /** Proven by the first verifier and held for the second (WP-E). */
  withSecond: number;
  /** Still a candidate the first verifier has not proven. */
  toProve: number;
}

/**
 * What became of each finding. proven, refuted, discarded, open and toProve
 * divide what was raised, each finding in exactly one.
 */
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
  const isOpen = (finding: (typeof findings)[number]) =>
    finding.status === "open_question" ||
    (finding.status === "dismissed" && finding.dismissedFrom === "open_question");
  // Proven by its status too: rows from before proofs were kept have none
  // (0012). A dismissal from before its origin was kept (0013) cannot say.
  const wasProven = (finding: (typeof findings)[number]) =>
    finding.status === "verified" ||
    finding.status === "confirmed" ||
    (finding.status === "dismissed" && finding.dismissedFrom === "verified") ||
    (finding.status !== "killed" && Boolean(finding.proofJson));
  return {
    raised: findings.length,
    provenOnce: count(wasProven),
    proven: count((finding) => wasProven(finding) && !isOpen(finding)),
    provenTwice: count((finding) => Boolean(finding.secondProofJson)),
    open: count(isOpen),
    refuted: count((finding) => finding.status === "killed" && finding.killedBy === "verification"),
    discarded: count(
      (finding) => finding.status === "killed" && finding.killedBy === "quote_check",
    ),
    withSecond: count((finding) => finding.status === "candidate" && Boolean(finding.proofJson)),
    toProve: count((finding) => finding.status === "candidate" && !finding.proofJson),
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
 * the app-code steps write none. The rows one call writes share its start
 * and end as each is written, so a call is timed once, to its last row.
 */
export function stepUsage(
  rows: readonly { stage: string; startedAt: string; endedAt: string | null }[],
): StepUsage[] {
  return STEPS.map((step) => {
    const mine = rows.filter((row) => (step.stages as readonly string[]).includes(row.stage));
    const calls = new Map<string, number>();
    for (const row of mine) {
      if (row.endedAt === null) continue;
      const key = `${row.stage} ${row.startedAt}`;
      const ms = Math.max(0, Date.parse(row.endedAt) - Date.parse(row.startedAt));
      calls.set(key, Math.max(calls.get(key) ?? 0, ms));
    }
    return {
      requests: mine.length,
      ms: [...calls.values()].reduce((sum, ms) => sum + ms, 0),
    };
  });
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const noneOr = (n: number, rest: string) => `${n === 0 ? "none" : n} ${rest}`;

/** What grading the project's screens came to (WP-I step 5), when it ran. */
export interface DesignTallies {
  /** Screens graded C or D by the first grader. */
  raised: number;
  /** Of those, graded C or D again by the second. */
  proven: number;
  /** Of those, passed by the second, so open questions. */
  open: number;
}

export function designTallies(
  rows: readonly { kind: string; status: string; dismissedFrom?: string | null }[],
): DesignTallies {
  const screens = rows.filter((row) => row.kind === "design");
  const isOpen = (row: (typeof screens)[number]) =>
    row.status === "open_question" ||
    (row.status === "dismissed" && row.dismissedFrom === "open_question");
  return {
    raised: screens.length,
    proven: screens.filter((row) => !isOpen(row) && row.status !== "candidate").length,
    open: screens.filter(isOpen).length,
  };
}

/**
 * What each step came to on a review that has reached a person. Reviews from
 * before the second verifier (WP-E) have no verifier model, and their proven
 * findings were proven once.
 */
export function stepResult(
  index: number,
  facts: StepFacts & { status: string; secondVerifier: boolean; design?: DesignTallies },
): string {
  const { tallies } = facts;
  const design = facts.design?.raised ? facts.design : undefined;
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
      return (
        `${tallies.raised === 0 ? "No candidates" : counted(tallies.raised, "candidate", "candidates")} raised, and every change and deletion accounted for.` +
        (design ? ` ${counted(design.raised, "screen", "screens")} graded C or D.` : "")
      );
    case 3: {
      const screens = design
        ? ` The second grader agreed on ${design.proven} of ${counted(design.raised, "screen", "screens")} graded C or D${design.open > 0 ? `, leaving ${design.open} open` : ""}.`
        : "";
      if (tallies.raised === 0) {
        return design ? `Nothing to prove in the code.${screens}` : "Nothing to prove.";
      }
      const proven = facts.secondVerifier
        ? noneOr(tallies.provenTwice, "proven by both verifiers")
        : noneOr(tallies.provenOnce, "proven");
      const open =
        tallies.open === 0
          ? "no open questions"
          : counted(tallies.open, "open question", "open questions");
      const line = `${proven}, ${open}, ${noneOr(tallies.refuted, "refuted")}, ${noneOr(tallies.discarded, "discarded")} for quoting code that was not there.`;
      return line.charAt(0).toUpperCase() + line.slice(1) + screens;
    }
    default:
      return facts.status === "complete"
        ? "Coverage audited, every finding decided, and the report written."
        : "Coverage audited. Your confirmation, then the report.";
  }
}

/**
 * The one line each step's card shows. Given the stage in flight, since a
 * step grading screens is not walking rules or proving code (review round 8).
 */
export function stepCount(
  index: number,
  state: StepState,
  facts: StepFacts,
  executing: string | null = null,
): string {
  if (state === "next") return "Waiting";
  if (state === "now" && executing === "s4b_design_grading") return "Grading the screens";
  if (state === "now" && executing === "s5c_design_second") return "Grading the screens again";
  const { tallies } = facts;
  switch (index) {
    case 0:
      return facts.rules === null
        ? "Freezing the ruleset"
        : `${counted(facts.rules, "rule", "rules")} frozen`;
    case 1:
      return state === "done"
        ? `${counted(facts.files, "file", "files")} read`
        : `Reading ${counted(facts.files, "file", "files")}`;
    case 2:
      // Running, it has raised what it has so far, which is not yet a result.
      if (state === "now") {
        return tallies.raised === 0
          ? "Walking the rules"
          : `${counted(tallies.raised, "candidate", "candidates")} so far`;
      }
      return `${counted(tallies.raised, "candidate", "candidates")} raised`;
    case 3:
      if (state === "done") return `${tallies.provenTwice} proven by both verifiers`;
      // Once the first has ruled on every one, the second is proving the rest.
      return tallies.toProve === 0 && tallies.withSecond > 0
        ? `${tallies.withSecond} with the second verifier`
        : `${tallies.toProve} to prove`;
    default:
      return state === "done" ? "Reported" : `${counted(facts.waiting, "waits", "wait")} for you`;
  }
}

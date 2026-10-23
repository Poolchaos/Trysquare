"use client";

/**
 * Setting up a review: four decisions in the order a person makes them.
 *
 * The branch pickers list what the remote has now, because this screen fetches
 * before it lists. Everything else on the page is a choice with a sensible
 * default, so the fastest path is: pick a branch, press start.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SELECTABLE_REVIEW_EFFORTS, type ReviewEffort } from "@/lib/domain/enums";
import { effortRunsOn } from "@/lib/models/effort-support";
import { pairedVerifierFor, secondVerifierReadiness } from "@/lib/models/pairing";
import {
  defaultModel,
  isSelectable,
  pickerOrder,
  probeAgeInWords,
  type ModelAvailability,
} from "@/lib/models/availability";
import { Loading, PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Mono,
  Problem,
  Select,
  Textarea,
} from "@/components/ui";
import { asSentence, send } from "@/components/request";
import { type SignIn } from "@/lib/engine/sign-in-command";
import {
  BillingNotice,
  billingOf,
  SignInLine,
  TerminalEnvironmentNote,
  type Billing,
} from "@/components/billing-notice";
import {
  ManagedPolicyNotice,
  managedPolicyOf,
  type ManagedPolicy,
} from "@/components/managed-policy-notice";

interface Branch {
  name: string;
  commit: string;
  subject: string;
  committedAt: string;
  ahead: number;
  behind: number;
}

interface Ruleset {
  id: string;
  name: string;
  tier: string;
  version: number;
  ruleCount: number;
}

interface Link {
  id: string;
  dependencyProjectId: string;
  dependencyName: string;
  packageName: string;
}

interface Preflight {
  pins: {
    primary: { fromCommit: string; mergeBaseCommit: string; subject: string; files: number };
    linked?: { fromCommit: string; subject: string; files: number };
  };
  files: number;
  hunks: number;
  sweepHits: number;
  sweepProblems: string[];
  sweepLiterals: string[];
  changedSymbols: number;
  estimatedTokens: number;
  contextWindow: number | null;
  withinWindow: boolean | null;
  requests: number;
  excludedPairs: number;
  profile: string;
  modelProfile: string | null;
  downgradedFrom: string | null;
  requestsByProfile: Record<string, number>;
}

interface Model {
  id: string;
  family: string;
  displayName: string;
  availability: ModelAvailability;
  contextWindow: number | null;
  profileId: string;
  recommended: boolean;
  sortOrder: number;
  lastProbedAt: string | null;
  lastError: string | null;
}

/**
 * Derived from the shared list rather than restated, so the screen cannot
 * drift from what the server accepts. The CLI's top tier is deliberately
 * absent; the server refuses it too. Extra high is listed only for a model
 * that runs it (D-122).
 */
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High (recommended)",
  xhigh: "Extra high",
};
const EFFORTS = (["xhigh", "high", "medium", "low"] as const)
  .filter((effort) => SELECTABLE_REVIEW_EFFORTS.includes(effort))
  .map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] ?? effort }));

function NewReview() {
  const router = useRouter();
  const search = useSearchParams();
  const projectId = search.get("projectId") ?? "";
  // Arrived from a branch row on the project page, which already made this
  // choice; making it again would be busywork.
  const prefilledBranch = search.get("fromBranch") ?? "";

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [branchesAsOf, setBranchesAsOf] = useState<Date | null>(null);
  // Why a read failed, said where it matters (5.13, U9): in the branch card
  // for the branch list, at the head of the form for the project, rulesets
  // and models, by the dependency's fields for its branches.
  const [branchProblem, setBranchProblem] = useState("");
  // One per read that failed, each its own line: joined, a dropped
  // connection's three messages ran together into one sentence (D-137).
  const [readProblems, setReadProblems] = useState<{ read: string; error: string }[]>([]);
  // Not read is not empty: an unread list claimed "No rulesets imported yet"
  // and "Import a ruleset first" (D-137).
  const [rulesetReadFailed, setRulesetReadFailed] = useState(false);
  // No such project, from a stale bookmark or one deleted in another tab:
  // the way back, not a Try again that could never work (D-139).
  const [projectMissing, setProjectMissing] = useState(false);
  // Every read again, and the screen shows them in flight: the branch list
  // cleared, so refs from before are not left to pick from (D-138).
  const retryReads = () => {
    setReadProblems([]);
    setBranchProblem("");
    setBranches(null);
    // The lines about the refs from last time go with the refs (D-139).
    setStale(null);
    setBranchesAsOf(null);
    // A ticked dependency's branches are read again too, Start off meanwhile
    // (D-146).
    setLinkBranchesFor("");
    setRefreshCount((count) => count + 1);
  };
  const [linkProblem, setLinkProblem] = useState("");
  // Bumped by the Refresh control, so the branch list re-fetches on demand.
  const [refreshCount, setRefreshCount] = useState(0);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [probing, setProbing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [fromBranch, setFromBranch] = useState(prefilledBranch);
  const [chosenInto, setChosenInto] = useState("");
  const [rulesetId, setRulesetId] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  // Extra high chosen and then a model that does not run it: what is shown
  // and sent falls back to high rather than an effort the run would not get.
  const efforts = EFFORTS.filter((option) => effortRunsOn(model, option.value));
  const chosenEffort = efforts.some((option) => option.value === effort) ? effort : "high";

  /**
   * A person picking a model. The choice itself goes back to high when the
   * model does not run it, not only what is shown: kept, it came back as
   * Extra high on a model that does, and a review started then ran at it.
   */
  function chooseModel(id: string) {
    setModel(id);
    setEffort(effortRunsOn(id, chosenEffort as ReviewEffort) ? chosenEffort : "high");
  }
  const [intent, setIntent] = useState("");
  // "" means the model's own profile; anything else is a deliberate downgrade
  // sent with both the pre-flight and the creation, so the numbers previewed
  // are the numbers the run will have.
  const [profileOverride, setProfileOverride] = useState("");
  const [engineMode, setEngineMode] = useState("headless");
  const [showAllModels, setShowAllModels] = useState(false);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const [links, setLinks] = useState<Link[]>([]);
  const [includeLink, setIncludeLink] = useState<string>("");
  const [linkBranches, setLinkBranches] = useState<Branch[]>([]);
  // The dependency's branch, once chosen by hand; null until then.
  const [chosenLinkFrom, setChosenLinkFrom] = useState<string | null>(null);
  const [linkInto, setLinkInto] = useState("");
  // Which dependency's branch read has answered, and a count to read again.
  const [linkBranchesFor, setLinkBranchesFor] = useState("");
  const [linkAttempt, setLinkAttempt] = useState(0);
  // Ticked, and still linked: a link removed in another tab, seen at a read
  // again, left the dependency ticked out of sight, and Start off for good
  // beside a line about a box no longer there (D-144).
  const included = links.some((link) => link.dependencyProjectId === includeLink)
    ? includeLink
    : "";
  const includedName =
    links.find((link) => link.dependencyProjectId === included)?.dependencyName ?? "";
  const linkRead = included !== "" && linkBranchesFor === included;
  // Suggested until chosen by hand: the dependency's branch of the same name
  // as the one under review, following it when it moves. Written once and
  // kept, it stayed on the first branch's name after the primary moved, the
  // hint still vouching for it (D-145).
  const suggestedLinkFrom = linkBranches.some((branch) => branch.name === fromBranch)
    ? fromBranch
    : "";
  const linkFrom = chosenLinkFrom ?? suggestedLinkFrom;
  const [preflightAnswer, setPreflightAnswer] = useState<{
    key: string;
    body: Preflight | null;
    error: string;
  } | null>(null);

  // Asked once as the screen opens, and free: a sign-in that bills per token
  // is said before Start, while it can still be changed, not in a run note
  // on a review already billing (D-161). Anything else the CLI cannot do is
  // refused at Start, with its reason (MVP 6.2). What was shown is sent with
  // Create and Start, and the server refuses a billing sign-in this page did
  // not show, so a check that failed, or a sign-in changed since, is shown
  // then (review of D-161).
  const [billing, setBilling] = useState<Billing | null>(null);
  const [managedPolicy, setManagedPolicy] = useState<ManagedPolicy | null>(null);
  const [refusedSignIn, setRefusedSignIn] = useState<SignIn | null>(null);
  /** The review a refused Start left, removed at the next press if still a draft. */
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // One answer for both engines: an interactive review's commands read
      // no settings either (D-174). The terminal they run in, which this
      // cannot see, is said apart.
      const sent = await send<{
        cli: { state: string; authMethod?: string };
        signIn?: SignIn;
        managedPolicy?: ManagedPolicy;
      }>("/api/auth", {}, "The CLI could not be checked");
      if (cancelled || !sent.ok) return;
      setBilling(billingOf(sent.body.cli, sent.body.signIn));
      setManagedPolicy(managedPolicyOf(sent.body.managedPolicy));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One effect, one guarded async body. Everything this screen needs is
  // fetched together so the form does not appear a field at a time.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    void (async () => {
      const [branchList, rulesetList, modelList, detail] = await Promise.all([
        send<{ branches: Branch[]; stale?: string | null; defaultBranch: string }>(
          `/api/projects/${projectId}/branches`,
          {},
          "The branches could not be listed",
        ),
        send<{ rulesets: Ruleset[] }>("/api/rulesets", {}, "The rulesets could not be read"),
        send<{ models: Model[]; lastUsed: string | null }>(
          "/api/models",
          {},
          "The models could not be read",
        ),
        send<{ links?: Link[] }>(
          `/api/projects/${projectId}`,
          {},
          "This project could not be read",
        ),
      ]);
      if (cancelled) return;

      // Named by the read, and keyed by it: the same words from the server
      // for each, as a second server holding the data directory gives, were
      // three identical lines under one key, with no way to tell them apart
      // (D-138).
      setReadProblems(
        (
          [
            ["Project", detail],
            ["Rulesets", rulesetList],
            ["Models", modelList],
          ] as const
        ).flatMap(([read, sent]) => (sent.ok ? [] : [{ read, error: sent.error }])),
      );
      setRulesetReadFailed(!rulesetList.ok);
      setProjectMissing(
        (!detail.ok && detail.status === 404) || (!branchList.ok && branchList.status === 404),
      );
      if (detail.ok) {
        const linksNow = detail.body.links ?? [];
        setLinks(linksNow);
        // A link gone takes its tick with it: kept, the box came back ticked
        // when the link was restored, its old branches shown as read while
        // they were read again (D-145, D-146).
        setIncludeLink((ticked) =>
          linksNow.some((link) => link.dependencyProjectId === ticked) ? ticked : "",
        );
      }

      // A refused list, for a clone not ready say, is neither a repository
      // with nothing pushed nor a list fetched a moment ago, which is what an
      // empty list beside "Fetched from the remote at" said (D-134).
      if (branchList.ok) {
        setBranchProblem("");
        setBranches(branchList.body.branches);
        setStale(branchList.body.stale ?? null);
        setBranchesAsOf(new Date());
        setChosenInto((current) => current || branchList.body.defaultBranch);
      } else {
        setBranchProblem(branchList.error);
        // The refs it described are not on screen any more (D-137).
        setStale(null);
      }

      if (rulesetList.ok) {
        const listed = rulesetList.body.rulesets;
        setRulesets(listed);
        setRulesetId((current) => current || (listed[0]?.id ?? ""));
      }

      // Only a model a probe currently vouches for is picked by default: the
      // one used last, else the first in the picker; with none probed, nothing
      // is chosen and the picker says why (MVP 7.1).
      if (modelList.ok) {
        const ordered = pickerOrder(modelList.body.models);
        setModels(ordered);
        const chosen = defaultModel(ordered, modelList.body.lastUsed ?? null);
        setModel((current) => current || chosen);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshCount]);

  const usableModels = models.filter((row) => isSelectable(row.availability));
  const unprobed = models.filter((row) => !isSelectable(row.availability));
  // Everything, until one model can actually run a review. Before that the
  // unprobed rows are the whole point of the panel.
  const shownModels = usableModels.length === 0 || showAllModels ? models : usableModels;

  async function probe(id: string) {
    setError("");
    setProbing(id);
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(id)}/probe`, {
        method: "POST",
      });
      if (!response.ok) {
        // Said out loud. A probe that failed silently left the row reading
        // unknown with no reason, so the only thing to do was press it again.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The probe did not complete.");
        return;
      }
      const { model: probed } = (await response.json()) as { model: Omit<Model, "availability"> };
      const listed = await send<{ models: Model[] }>(
        "/api/models",
        {},
        "The probe finished, but the models could not be read again",
      );
      if (!listed.ok) {
        setError(listed.error);
        return;
      }
      setModels(pickerOrder(listed.body.models));
      // Probing is what someone does to use the model, so a successful probe
      // selects it unless a choice was already made.
      const fresh = listed.body.models.find((row) => row.id === probed.id);
      if (fresh && isSelectable(fresh.availability)) {
        setModel((current) => current || fresh.id);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The probe could not be sent.");
    } finally {
      setProbing(null);
    }
  }

  // The dependency's own branches, once one is included.
  useEffect(() => {
    if (included === "") return;
    let cancelled = false;
    void (async () => {
      const sent = await send<{ branches: Branch[]; defaultBranch: string }>(
        `/api/projects/${included}/branches`,
        {},
        "The dependency's branches could not be listed",
      );
      if (cancelled) return;
      setLinkBranchesFor(included);
      // A refusal was dropped, and the dependency's branch fields simply never
      // appeared (D-134).
      setLinkProblem(sent.ok ? "" : sent.error);
      if (!sent.ok) {
        // No branches to choose from, so no pair: kept, a refusal stood beside
        // the old pair, and Start sent it (D-145). A branch chosen by hand
        // stays chosen, unsent with no list to stand in (D-146).
        setLinkBranches([]);
        setLinkInto("");
        return;
      }
      const body = sent.body;
      const listed = (name: string | null) =>
        name !== null && body.branches.some((branch) => branch.name === name);
      // Suggested from these, never assumed: a dependency branch with the
      // same name as the one being reviewed is almost always the other half
      // of the change, and almost always is not always. A choice the new list
      // no longer has goes.
      setLinkBranches(body.branches);
      setChosenLinkFrom((chosen) => (listed(chosen) ? chosen : null));
      setLinkInto((current) => (listed(current) ? current : body.defaultBranch));
    })();
    return () => {
      cancelled = true;
    };
  }, [included, linkAttempt, refreshCount]);

  /**
   * The branch to compare against, never the branch under review.
   *
   * Derived rather than corrected in place: this project's detected default
   * genuinely can be the branch being reviewed, and a pair like that has an
   * empty diff. A review of nothing comes back clean and reads exactly like a
   * review that found nothing wrong, which is the one confusion this app
   * exists to prevent.
   */
  const intoBranch =
    chosenInto === "" || chosenInto === fromBranch
      ? ((branches ?? []).find((branch) => branch.name !== fromBranch)?.name ?? "")
      : chosenInto;
  // The dependency's the same way: its pair could be one branch against
  // itself, an empty half of the review that reads as clean (D-144).
  const linkIntoBranch =
    linkInto === "" || linkInto === linkFrom
      ? (linkBranches.find((branch) => branch.name !== linkFrom)?.name ?? "")
      : linkInto;

  // The size of the review, recomputed whenever the decisions that change it
  // do. Free and read-only, so it can run on every change without a thought.
  const readyToPreflight =
    projectId !== "" && fromBranch !== "" && intoBranch !== "" && rulesetId !== "" && model !== "";

  // What the pre-flight is asked about. An answer shows only while it is
  // the answer to the question asked now: the one for the choices before
  // stayed up while the next was read, its counts beside a Start that would
  // review the new choices (5.14, audit U11).
  // The request itself, made once: sent only when it changes, it was sent
  // again for values that change nothing in it, the tick of a dependency
  // with no branch chosen and that dependency's branches arriving (D-147).
  const preflightBody = JSON.stringify({
    projectId,
    fromBranch,
    intoBranch,
    rulesetId,
    model,
    ...(profileOverride === "" ? {} : { profileId: profileOverride }),
    ...(included && linkFrom && linkIntoBranch
      ? { linked: { projectId: included, fromBranch: linkFrom, intoBranch: linkIntoBranch } }
      : {}),
  });
  // A Refresh asks again: a branch pushed to since keeps its name, and an
  // answer from before it, "changes nothing" say, stood (D-146).
  const preflightKey = JSON.stringify([preflightBody, refreshCount]);
  const answered = preflightAnswer?.key === preflightKey ? preflightAnswer : null;
  const preflight = answered?.body ?? null;
  const preflightError = answered?.error ?? "";
  const preflightPending = readyToPreflight && answered === null;

  useEffect(() => {
    if (!readyToPreflight) return;
    let cancelled = false;
    const key = preflightKey;
    void (async () => {
      const sent = await send<Preflight>(
        "/api/reviews/preflight",
        { method: "POST", body: preflightBody },
        "The pre-flight could not be run",
      );
      if (cancelled) return;
      setPreflightAnswer({
        key,
        body: sent.ok ? sent.body : null,
        error: sent.ok ? "" : sent.error,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [readyToPreflight, preflightKey, preflightBody]);

  type Refused = { error?: string; code?: string; cli?: { state?: unknown }; signIn?: SignIn };
  /**
   * A refusal for a billing sign-in this page had not shown shows it, for the
   * next Start; one for a CLI that cannot run drops it, since the sign-in it
   * spoke of is gone, and sets a signed-out CLI's command apart (review of the
   * D-162 fixes).
   */
  function showRefusal(refused: Refused) {
    if (refused.code === "BillingNotShown") setBilling(billingOf(refused.cli, refused.signIn));
    if (refused.code === "CliNotReady") {
      setBilling(null);
      if (refused.signIn) setRefusedSignIn(refused.signIn);
    }
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setRefusedSignIn(null);
    setStarting(true);
    const choices = {
      projectId,
      fromBranch,
      intoBranch,
      model,
      effort: chosenEffort,
      ...(engineMode === "headless" ? {} : { engineMode }),
      ...(profileOverride === "" ? {} : { profileId: profileOverride }),
      ...(intent.trim() === "" ? {} : { intent }),
      ...(included && linkFrom && linkIntoBranch
        ? {
            linked: {
              projectId: included,
              fromBranch: linkFrom,
              intoBranch: linkIntoBranch,
            },
          }
        : {}),
    };
    try {
      // The draft a refused Start left is removed while it is still one:
      // kept, each press left another (review of the D-162 fixes), and
      // started again, it ran on the branch tips pinned at its first press,
      // or was pressed at for ever once started or cancelled elsewhere
      // (review of the D-163 fixes). Made afresh, the review is pinned to
      // the tips as they are now. The server judges whether it still is
      // one: a review put in line keeps the status draft, and read from here
      // one queued from another tab was removed (review of the D-164 fixes).
      // One no longer a draft, or gone, is left; a removal that failed is
      // said, and the draft kept for the next press, not a second made.
      if (draft !== null) {
        const removed = await send(
          `/api/reviews/${draft}?unstarted=1`,
          { method: "DELETE" },
          "The review this screen left could not be removed",
        );
        const leftAlone =
          !removed.ok && (removed.status === 404 || removed.body.code === "NotAnUnstartedDraft");
        if (!removed.ok && !leftAlone) {
          setError(`${asSentence(removed.error)} Press Start again to try again.`);
          return;
        }
        setDraft(null);
      }
      const created = await fetch("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          ...choices,
          ...(billing === null ? {} : { billingShown: billing.state }),
        }),
      });
      const body = (await created.json()) as Refused & { review?: { id: string } };
      if (!created.ok || !body.review) {
        showRefusal(body);
        setError(body.error ?? "The review could not be created.");
        return;
      }
      const reviewId = body.review.id;

      const started = await fetch(`/api/reviews/${reviewId}/start`, {
        method: "POST",
        body: JSON.stringify({
          rulesetId,
          ...(billing === null ? {} : { billingShown: billing.state }),
        }),
      });
      if (!started.ok) {
        const problem = (await started.json()) as Refused;
        showRefusal(problem);
        setError(problem.error ?? "The review was created but could not be started.");
        setDraft(reviewId);
        return;
      }
      router.push(`/reviews/${reviewId}`);
    } catch (problem) {
      // Without this the button simply returned to idle, which reads as a
      // click that did not register rather than a request that failed.
      setError(problem instanceof Error ? problem.message : "The review could not be started.");
    } finally {
      setStarting(false);
    }
  }

  const shown = (branches ?? []).filter((branch) => branch.name.includes(filter));

  // A dependency ticked without both its branches was dropped from the
  // review it was ticked for, without a word (5.14, audit U11).
  // Not read, or refused, is incomplete too: Start stayed on beside a pair
  // that was being read again, or that a refusal stood beside (D-145).
  const linkIncomplete =
    included !== "" &&
    (!linkRead || linkProblem !== "" || linkFrom === "" || linkIntoBranch === "");
  const baseReady = fromBranch !== "" && intoBranch !== "" && model !== "" && rulesetId !== "";
  // The profile the chosen model is registered for, from the models read:
  // taken from the pre-flight, it went whenever an answer was pending, and
  // the downgrade list widened to profiles the server refuses (D-147).
  const modelProfile = models.find((row) => row.id === model)?.profileId ?? null;
  // A half with no change ran and read as clean (D-145).
  const emptyHalves = preflight
    ? [
        ...(preflight.pins.primary.files === 0
          ? [`${fromBranch} changes nothing against ${intoBranch}`]
          : []),
        ...(preflight.pins.linked?.files === 0
          ? [`The dependency's ${linkFrom} changes nothing against ${linkIntoBranch}`]
          : []),
      ]
    : [];
  // Every finding the first verifier proves is proven again on the other
  // strong family (WP-E), which the server refuses to start without. Read
  // from the models here, not the pre-flight, so a probe in the list above
  // counts at once. In Mode B too: its command names the paired model.
  const pairedId = pairedVerifierFor(models.find((row) => row.id === model)?.family);
  const paired = models.find((row) => row.id === pairedId);
  const secondVerifier = secondVerifierReadiness(pairedId, paired?.availability);
  const verifierMissing = model !== "" && !secondVerifier.usable;
  // Started anyway, the run stopped at its sweep, which will not pass a
  // pattern it could not run (5.14, audit U11).
  const wouldRefuse = preflight !== null && preflight.sweepProblems.length > 0;
  // And not before the pre-flight for these choices has answered: on beside
  // "Working out...", Start offered a review nothing had yet sized (D-147).
  const ready =
    baseReady &&
    !linkIncomplete &&
    emptyHalves.length === 0 &&
    !wouldRefuse &&
    !verifierMissing &&
    !preflightPending;

  if (!projectId) {
    return (
      <>
        <PageHeader title="New review" />
        <PageBody>
          <Problem>
            No project was chosen. Pick one from <Link href="/projects">Projects</Link>.
          </Problem>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New review"
        subtitle="The branch you want reviewed, and what to compare it against."
      />
      <PageBody>
        <form
          onSubmit={start}
          // Enter on a text box, a radio or a checkbox submits its form, and
          // this one starts a paid review: a keystroke meant for the branch
          // filter, or to pick a branch or a model, started one (5.2; the
          // review of 5.1 to 5.4). Only Start review submits; a text area
          // keeps its newline, and a link and the Advanced fold keep their
          // Enter, which taken here opened nothing (D-144).
          onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (
              event.key === "Enter" &&
              !["BUTTON", "TEXTAREA", "A", "SUMMARY"].includes(target.tagName)
            ) {
              event.preventDefault();
            }
          }}
          className="grid max-w-3xl gap-5"
        >
          {readProblems.length > 0 ? (
            <div className="grid gap-2">
              {readProblems.map(({ read, error: problem }) => (
                <Problem key={read}>
                  {read}: {problem}
                </Problem>
              ))}
              {/* One Try again on the screen: the branch card's covers this
                  when it has one, and both re-read everything (D-138). */}
              {branchProblem ? null : (
                <div>
                  <Button type="button" onClick={retryReads}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          {stale ? (
            <Problem>
              The branch list could not be refreshed, so these are the refs from last time: {stale}
            </Problem>
          ) : null}

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Branch to review</span>
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter branches"
                aria-label="Filter branches"
                className="max-w-56"
              />
            </div>

            {branchesAsOf && !branchProblem ? (
              <p className="mb-2 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                {stale
                  ? "Cached refs, shown because the remote could not be reached."
                  : `Fetched from the remote at ${branchesAsOf.toLocaleTimeString()}.`}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-[var(--color-ink)]"
                  onClick={() => {
                    setBranches(null);
                    setStale(null);
                    setBranchesAsOf(null);
                    setLinkBranchesFor("");
                    setRefreshCount((count) => count + 1);
                  }}
                >
                  Refresh
                </button>
              </p>
            ) : null}

            {branchProblem ? (
              <Loading
                error={branchProblem}
                {...(projectMissing
                  ? { back: { href: "/projects", label: "All projects" } }
                  : { onRetry: retryReads })}
              />
            ) : branches === null ? (
              <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
                Fetching the latest branches...
              </p>
            ) : (
              <ul className="-mx-1 max-h-72 overflow-y-auto p-1">
                {shown.map((branch) => (
                  <li key={branch.name}>
                    {/* Relative, so the hidden radio is placed inside its label and
                        focusing it scrolls the list to it: placed outside, arrow
                        keys chose branches out of sight (review of the D-149 fixes). */}
                    <label
                      className={`relative flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                        fromBranch === branch.name
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                          : "border-transparent hover:bg-[var(--color-surface-sunken)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="fromBranch"
                        className="sr-only"
                        checked={fromBranch === branch.name}
                        onChange={() => setFromBranch(branch.name)}
                      />
                      <Mono className="min-w-0 flex-1 truncate text-sm">{branch.name}</Mono>
                      <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                        {branch.ahead > 0 ? `${branch.ahead} ahead` : null}
                        {branch.ahead > 0 && branch.behind > 0 ? ", " : null}
                        {branch.behind > 0 ? `${branch.behind} behind` : null}
                      </span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 ? (
                  <li className="py-6">
                    <Empty
                      title={
                        (branches ?? []).length === 0
                          ? "This repository has no branches to review"
                          : "No branch matches that filter"
                      }
                    >
                      {(branches ?? []).length === 0
                        ? "Nothing has been pushed to it yet, or the clone could not read its refs."
                        : `${(branches ?? []).length} branch(es) are here; the filter is hiding them.`}
                    </Empty>
                  </li>
                ) : null}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Compare against" hint="Usually the branch it will merge into.">
              <Select value={intoBranch} onChange={(event) => setChosenInto(event.target.value)}>
                {/* The branch under review is not a candidate: comparing it
                    with itself has an empty diff, and a review of nothing
                    comes back clean and reads like a review that found
                    nothing wrong. This project's detected default genuinely
                    is the feature branch, so the collision is reachable on
                    the first render rather than only by a determined user. */}
                {(branches ?? [])
                  .filter((branch) => branch.name !== fromBranch)
                  .map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field
              label="Rules"
              hint="What the change is judged against, frozen when the review starts."
            >
              <Select value={rulesetId} onChange={(event) => setRulesetId(event.target.value)}>
                {rulesets.length === 0 ? (
                  <option value="">
                    {rulesetReadFailed
                      ? "The rulesets could not be read"
                      : "No rulesets imported yet"}
                  </option>
                ) : null}
                {[...new Set(rulesets.map((ruleset) => ruleset.tier))].map((tier) => (
                  <optgroup key={tier} label={tier}>
                    {rulesets
                      .filter((ruleset) => ruleset.tier === tier)
                      .map((ruleset) => (
                        <option key={ruleset.id} value={ruleset.id}>
                          {ruleset.name} (v{ruleset.version}, {ruleset.ruleCount} rule
                          {ruleset.ruleCount === 1 ? "" : "s"})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
              {rulesetId ? (
                <Link
                  href={`/rulesets/${rulesetId}`}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  See which rules apply
                </Link>
              ) : null}
            </Field>

            <Field label="Effort" hint="How hard the model thinks. Fixed once the review starts.">
              <Select value={chosenEffort} onChange={(event) => setEffort(event.target.value)}>
                {efforts.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Card className="p-4">
            <h2 className="text-heading font-medium">Model</h2>
            <p className="mt-1 mb-3 text-xs text-[var(--color-ink-muted)]">
              Only a model a fresh probe vouches for can run a review. A probe is one tiny paid
              call, made only when you press the button (never on a timer).
            </p>
            <ul className="grid gap-1" data-testid="model-picker">
              {shownModels.map((row) => {
                const selectable = isSelectable(row.availability);
                return (
                  <li key={row.id}>
                    <label
                      className={`relative flex items-center gap-3 rounded-md border px-3 py-2 ${
                        model === row.id
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                          : "border-transparent"
                      } ${selectable ? "cursor-pointer hover:bg-[var(--color-surface-sunken)]" : "opacity-70"}`}
                    >
                      <input
                        type="radio"
                        name="model"
                        className="sr-only"
                        disabled={!selectable}
                        checked={model === row.id}
                        onChange={() => chooseModel(row.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Mono className="text-sm">{row.displayName}</Mono>
                          {row.recommended ? <Badge tone="good">recommended</Badge> : null}
                          {!selectable ? (
                            <Badge tone="neutral">
                              {row.availability === "unavailable" ? "unavailable" : "unknown"}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                          {row.availability === "unavailable" && row.lastError
                            ? row.lastError
                            : [
                                row.contextWindow === null
                                  ? null
                                  : `${row.contextWindow.toLocaleString("en-US")} token window`,
                                `${row.profileId} profile`,
                                probeAgeInWords(row.lastProbedAt),
                              ]
                                .filter(Boolean)
                                .join(", ")}
                        </span>
                      </span>
                      {!selectable ? (
                        <Button
                          type="button"
                          disabled={probing !== null}
                          onClick={() => void probe(row.id)}
                        >
                          {probing === row.id ? "Probing..." : "Probe"}
                        </Button>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            {/* Once something is usable, the models that are not stop being
                the bulk of the page. They stay one click away, because
                probing one is how it becomes usable. */}
            {unprobed.length > 0 && usableModels.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllModels((shown) => !shown)}
                className="mt-2 text-xs text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                {showAllModels
                  ? "Hide the models that need probing"
                  : `Show ${unprobed.length} model(s) that need probing`}
              </button>
            ) : null}
          </Card>

          <Field
            label="What was this change meant to do? (optional)"
            hint="Treated as a claim to check against the code, never as instructions. If the change does not do what you describe, that is itself a finding."
          >
            <Textarea
              rows={3}
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="Rename the prefs field and migrate every consumer."
            />
          </Field>

          <details className="rounded-lg border border-[var(--color-border)]">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Advanced</summary>
            <div className="grid gap-4 border-t border-[var(--color-border)] p-4">
              <Field
                label="Engine"
                hint="Headless runs the CLI unattended with read-only tools and spends your usage. Interactive writes each stage's prompt into the review's bundle and waits for you to save the answer beside it, so the tokens are spent in your own session and the usage recorded here stays at zero."
              >
                <Select
                  value={engineMode}
                  data-testid="engine-mode"
                  onChange={(event) => setEngineMode(event.target.value)}
                >
                  <option value="headless">Headless</option>
                  <option value="interactive">Interactive</option>
                </Select>
              </Field>

              <Field
                label="Profile"
                hint="How the adversarial work is divided into requests. The same rules are applied either way; a weaker profile sends them in more, smaller requests."
              >
                <Select
                  value={profileOverride}
                  data-testid="profile-override"
                  onChange={(event) => setProfileOverride(event.target.value)}
                >
                  <option value="">
                    The model&apos;s own
                    {modelProfile ? ` (${modelProfile})` : ""}
                  </option>
                  {["chunked", "decomposed"]
                    .filter((candidate) => {
                      // Only genuine downgrades are offered: the server refuses
                      // anything stronger than the model is registered for.
                      const rank = ["full-context", "chunked", "decomposed"];
                      const base = modelProfile ?? "full-context";
                      return rank.indexOf(candidate) > rank.indexOf(base);
                    })
                    .map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                </Select>
              </Field>

              {preflight ? (
                <div className="text-xs text-[var(--color-ink-muted)]">
                  <p className="mb-1 font-medium text-[var(--color-ink)]">Requests by profile</p>
                  <ul className="grid gap-0.5">
                    {Object.entries(preflight.requestsByProfile).map(([name, count]) => (
                      <li key={name} className="flex justify-between gap-4 tabular-nums">
                        <span>{name}</span>
                        <span>
                          {count} request{count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {preflight.downgradedFrom ? (
                    <p className="mt-2">
                      Downgraded from {preflight.downgradedFrom} to {preflight.profile} on purpose;
                      the run will record it.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>

          {links.length > 0 ? (
            <Card className="p-4">
              <h2 className="text-heading font-medium">Review a dependency at the same time</h2>
              <p className="mt-1 mb-3 text-xs text-[var(--color-ink-muted)]">
                A change to an exported type only breaks at the consumer, so reviewing both halves
                together is the only way to catch one that never migrated.
              </p>
              <div className="grid gap-3">
                {links.map((link) => (
                  <label key={link.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeLink === link.dependencyProjectId}
                      onChange={(event) => {
                        setIncludeLink(event.target.checked ? link.dependencyProjectId : "");
                        setLinkBranchesFor("");
                        setLinkProblem("");
                        setLinkBranches([]);
                        setChosenLinkFrom(null);
                        setLinkInto("");
                      }}
                    />
                    <span>
                      Include {link.dependencyName}{" "}
                      <Mono className="text-xs text-[var(--color-ink-muted)]">
                        {link.packageName}
                      </Mono>
                    </span>
                  </label>
                ))}

                {included !== "" && !linkRead ? (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    Reading {includedName}&apos;s branches...
                  </p>
                ) : null}
                {linkRead && linkProblem ? (
                  <div className="grid gap-2">
                    <Problem>{linkProblem}</Problem>
                    <div>
                      <Button
                        type="button"
                        onClick={() => {
                          setLinkProblem("");
                          setLinkBranchesFor("");
                          setLinkAttempt((attempt) => attempt + 1);
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                ) : null}
                {linkRead && !linkProblem && linkBranches.length < 2 ? (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    {linkBranches.length === 0
                      ? `${includedName} has no branches to review, so it cannot be included: untick it.`
                      : `${includedName} has one branch, so there is nothing to compare it against: untick it.`}
                  </p>
                ) : null}
                {linkRead && linkBranches.length > 1 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Its branch"
                      hint={
                        chosenLinkFrom === null && linkFrom !== ""
                          ? "Suggested: it has a branch of the same name."
                          : undefined
                      }
                    >
                      <Select
                        value={linkFrom}
                        onChange={(event) => setChosenLinkFrom(event.target.value)}
                      >
                        <option value="">Choose a branch</option>
                        {linkBranches.map((branch) => (
                          <option key={branch.name} value={branch.name}>
                            {branch.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Compare against">
                      <Select
                        value={linkIntoBranch}
                        onChange={(event) => setLinkInto(event.target.value)}
                      >
                        {linkBranches
                          .filter((branch) => branch.name !== linkFrom)
                          .map((branch) => (
                            <option key={branch.name} value={branch.name}>
                              {branch.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {preflightPending ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              Working out what this review will examine...
            </p>
          ) : null}
          {readyToPreflight && preflightError ? <Problem>{preflightError}</Problem> : null}

          {readyToPreflight && preflight ? (
            <Card className="p-4">
              <h2 className="mb-3 text-heading font-medium">What this review will examine</h2>
              <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <Row
                  label="Files changed"
                  value={
                    preflight.pins.linked
                      ? `${preflight.pins.primary.files} here, ${preflight.pins.linked.files} in the dependency`
                      : String(preflight.files)
                  }
                />
                <Row label="Hunks" value={String(preflight.hunks)} />
                <Row label="Sweep hits" value={String(preflight.sweepHits)} />
                {preflight.changedSymbols > 0 ? (
                  <Row label="Changed exports" value={String(preflight.changedSymbols)} />
                ) : null}
                <Row label="Model requests" value={String(preflight.requests)} />
                <Row label="Second verifier" value={paired?.displayName ?? pairedId} />
                <Row
                  label="Estimated tokens"
                  value={preflight.estimatedTokens.toLocaleString("en-US")}
                />
                <Row
                  label="Reviewing"
                  value={`${preflight.pins.primary.fromCommit.slice(0, 8)} ${preflight.pins.primary.subject}`}
                />
                <Row
                  label="Merge base"
                  value={preflight.pins.primary.mergeBaseCommit.slice(0, 8)}
                />
                {preflight.pins.linked ? (
                  <Row
                    label="With dependency"
                    value={`${preflight.pins.linked.fromCommit.slice(0, 8)} ${preflight.pins.linked.subject}`}
                  />
                ) : null}
              </dl>

              {emptyHalves.length > 0 ? (
                <div className="mt-3">
                  <Problem>
                    {emptyHalves.join(". ")}, so a review of it would find nothing and read as
                    clean. Choose a branch with a change.
                  </Problem>
                </div>
              ) : null}

              {preflight.contextWindow === null ? (
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                  This model has not been probed, so its context window is unknown and the review
                  will send each batch as one request without splitting.
                </p>
              ) : preflight.withinWindow === false ? (
                <p className="mt-3 text-xs text-[var(--color-warning)]">
                  The prompt is larger than this model&apos;s usable window, so the review will be
                  split into more, smaller requests.
                </p>
              ) : null}

              {preflight.sweepProblems.length > 0 ? (
                <div className="mt-3">
                  <Problem>
                    {preflight.sweepProblems.length} sweep pattern(s) could not run, so the review
                    would refuse to start: {preflight.sweepProblems.join("; ")}
                  </Problem>
                </div>
              ) : null}

              {preflight.sweepLiterals.length > 0 ? (
                // Not a warning: the pattern runs either way. But a pattern
                // read as text matches different things from the same pattern
                // read as a regex, and which one happened is worth knowing
                // before the findings arrive rather than after.
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                  {preflight.sweepLiterals.length} sweep pattern(s) are not valid regular
                  expressions and will be searched for as literal text:{" "}
                  {preflight.sweepLiterals.join("; ")}
                </p>
              ) : null}

              {preflight.excludedPairs > 0 ? (
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                  {preflight.excludedPairs} rule and file pair(s) are outside this profile and will
                  be recorded as deliberately not checked.
                </p>
              ) : null}

              <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                The commits are pinned again when the review starts, so these counts are a preview
                rather than a promise.
              </p>
            </Card>
          ) : null}

          {error ? <Problem>{error}</Problem> : null}
          {error && refusedSignIn ? <SignInLine signIn={refusedSignIn} /> : null}

          {/* An interactive review starts no CLI here, but the commands it
              prints run this one (review of the D-162 fixes). */}
          {billing === null ? null : (
            <BillingNotice
              billing={billing}
              what={engineMode === "headless" ? "review" : "interactive"}
            />
          )}
          {engineMode === "interactive" ? <TerminalEnvironmentNote /> : null}
          {managedPolicy === null ? null : <ManagedPolicyNotice policy={managedPolicy} />}

          {/* Wrapping, each button on one line: at phone width the reason and a
              probe beside Start squeezed both buttons onto two and three. */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || starting}
              className="whitespace-nowrap"
            >
              {starting ? "Starting..." : "Start review"}
            </Button>
            {rulesets.length === 0 && !rulesetReadFailed ? (
              <span className="text-sm text-[var(--color-ink-muted)]">
                Import a ruleset first:{" "}
                <Link href="/rulesets" className="underline">
                  Rulesets
                </Link>
              </span>
            ) : wouldRefuse ||
              emptyHalves.length > 0 ||
              (baseReady && linkIncomplete) ||
              (baseReady && verifierMissing) ? (
              // Every reason Start is off, not the first alone: an empty half's
              // line stood alone beside a dependency with no branch (D-146),
              // and so did a refusal's (review of the D-147 fixes).
              // The dependency's only when the rest is ready: beside a branch
              // or a model not yet chosen it read as the only reason.
              <span className="text-sm text-[var(--color-ink-muted)]">
                {[
                  ...(wouldRefuse
                    ? ["The pre-flight says this review would refuse to start: see above."]
                    : []),
                  ...(emptyHalves.length > 0
                    ? ["The pre-flight found a half of this review with no change: see above."]
                    : []),
                  ...(baseReady && verifierMissing
                    ? [
                        `The second verifier, ${paired?.displayName ?? pairedId}, ` +
                          `${secondVerifier.reason}.`,
                      ]
                    : []),
                  ...(baseReady && linkIncomplete
                    ? [
                        !linkRead
                          ? "Reading the dependency's branches..."
                          : linkProblem
                            ? "The dependency's branches could not be read: try again above, or untick it."
                            : linkBranches.length < 2
                              ? "The dependency has nothing to compare: untick it."
                              : "Choose the dependency's branch, or untick it.",
                      ]
                    : []),
                ].join(" ")}
              </span>
            ) : (
              <span className="text-sm text-[var(--color-ink-muted)]">
                {baseReady && preflightPending
                  ? "The pre-flight is still working out what this review will examine."
                  : "The commits are pinned when the review starts."}
              </span>
            )}
            {baseReady && verifierMissing ? (
              // Here, not only in the list: once a model is usable the list folds
              // the unprobed ones away.
              <Button
                type="button"
                disabled={probing !== null}
                onClick={() => void probe(pairedId)}
                className="whitespace-nowrap"
              >
                {probing === pairedId ? "Probing..." : `Probe ${paired?.displayName ?? pairedId}`}
              </Button>
            ) : null}
          </div>
        </form>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}

export default function NewReviewPage() {
  // The Suspense boundary is required because this screen reads search
  // params. A null fallback would render a blank page until the client took
  // over, so it falls back to the header it is about to show anyway.
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="New review" />
          <PageBody>
            <p className="text-sm text-[var(--color-ink-muted)]">Fetching the latest branches...</p>
          </PageBody>
        </>
      }
    >
      <NewReview />
    </Suspense>
  );
}

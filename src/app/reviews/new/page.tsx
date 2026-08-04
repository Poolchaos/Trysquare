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
import { SELECTABLE_REVIEW_EFFORTS } from "@/lib/domain/enums";
import {
  isSelectable,
  pickerOrder,
  probeAgeInWords,
  type ModelAvailability,
} from "@/lib/models/availability";
import { PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Mono,
  Problem,
  Select,
  Textarea,
} from "@/components/ui";

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
 * absent; the server refuses it too.
 */
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High (recommended)",
};
const EFFORTS = ["high", "medium", "low"]
  .filter((effort) => (SELECTABLE_REVIEW_EFFORTS as readonly string[]).includes(effort))
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
  const [intent, setIntent] = useState("");
  // "" means the model's own profile; anything else is a deliberate downgrade
  // sent with both the pre-flight and the creation, so the numbers previewed
  // are the numbers the run will have.
  const [profileOverride, setProfileOverride] = useState("");
  const [engineMode, setEngineMode] = useState("headless");

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const [links, setLinks] = useState<Link[]>([]);
  const [includeLink, setIncludeLink] = useState<string>("");
  const [linkBranches, setLinkBranches] = useState<Branch[]>([]);
  const [linkFrom, setLinkFrom] = useState("");
  const [linkInto, setLinkInto] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightError, setPreflightError] = useState("");

  // One effect, one guarded async body. Everything this screen needs is
  // fetched together so the form does not appear a field at a time.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    void (async () => {
      const [branchList, rulesetList, modelList, detail] = await Promise.all([
        fetch(`/api/projects/${projectId}/branches`).then((response) => response.json()),
        fetch("/api/rulesets").then((response) => response.json()),
        fetch("/api/models").then((response) => response.json()),
        fetch(`/api/projects/${projectId}`).then((response) => response.json()),
      ]);
      if (cancelled) return;

      setLinks(detail.links ?? []);

      setBranches(branchList.branches ?? []);
      setStale(branchList.stale ?? null);
      setBranchesAsOf(new Date());
      if (branchList.error) setError(String(branchList.error));
      setChosenInto((current) => current || (branchList.defaultBranch ?? ""));

      setRulesets(rulesetList.rulesets);
      setRulesetId((current) => current || (rulesetList.rulesets[0]?.id ?? ""));

      // Only a model a probe currently vouches for is picked by default; with
      // none probed, nothing is chosen and the picker says why.
      setModels(pickerOrder(modelList.models as Model[]));
      const usable = pickerOrder(modelList.models as Model[]).find((row) =>
        isSelectable(row.availability),
      );
      setModel((current) => current || (usable?.id ?? ""));
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshCount]);

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
      const listed = await fetch("/api/models").then(
        (r) => r.json() as Promise<{ models: Model[] }>,
      );
      setModels(pickerOrder(listed.models));
      // Probing is what someone does to use the model, so a successful probe
      // selects it unless a choice was already made.
      const fresh = listed.models.find((row) => row.id === probed.id);
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
    if (includeLink === "") return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/projects/${includeLink}/branches`);
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { branches: Branch[]; defaultBranch: string };
      setLinkBranches(body.branches);
      // Suggested, never assumed: a dependency branch with the same name as
      // the one being reviewed is almost always the other half of the change,
      // and almost always is not always.
      const sameName = body.branches.find((branch) => branch.name === fromBranch);
      setLinkFrom((current) => current || sameName?.name || "");
      setLinkInto((current) => current || body.defaultBranch);
    })();
    return () => {
      cancelled = true;
    };
  }, [includeLink, fromBranch]);

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

  // The size of the review, recomputed whenever the decisions that change it
  // do. Free and read-only, so it can run on every change without a thought.
  const readyToPreflight =
    projectId !== "" && fromBranch !== "" && intoBranch !== "" && rulesetId !== "" && model !== "";

  useEffect(() => {
    if (!readyToPreflight) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/reviews/preflight", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          fromBranch,
          intoBranch,
          rulesetId,
          model,
          ...(profileOverride === "" ? {} : { profileId: profileOverride }),
          ...(includeLink && linkFrom && linkInto
            ? { linked: { projectId: includeLink, fromBranch: linkFrom, intoBranch: linkInto } }
            : {}),
        }),
      });
      if (cancelled) return;
      const body = await response.json();
      setPreflight(response.ok ? (body as Preflight) : null);
      setPreflightError(
        response.ok ? "" : ((body as { error?: string }).error ?? "The pre-flight failed."),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    readyToPreflight,
    projectId,
    fromBranch,
    intoBranch,
    rulesetId,
    model,
    profileOverride,
    includeLink,
    linkFrom,
    linkInto,
  ]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStarting(true);
    try {
      const created = await fetch("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          fromBranch,
          intoBranch,
          model,
          effort,
          ...(engineMode === "headless" ? {} : { engineMode }),
          ...(profileOverride === "" ? {} : { profileId: profileOverride }),
          ...(intent.trim() === "" ? {} : { intent }),
          ...(includeLink && linkFrom && linkInto
            ? { linked: { projectId: includeLink, fromBranch: linkFrom, intoBranch: linkInto } }
            : {}),
        }),
      });
      const body = (await created.json()) as { review?: { id: string }; error?: string };
      if (!created.ok || !body.review) {
        setError(body.error ?? "The review could not be created.");
        return;
      }

      const started = await fetch(`/api/reviews/${body.review.id}/start`, {
        method: "POST",
        body: JSON.stringify({ rulesetId }),
      });
      if (!started.ok) {
        const problem = (await started.json()) as { error?: string };
        setError(problem.error ?? "The review was created but could not be started.");
        return;
      }
      router.push(`/reviews/${body.review.id}`);
    } catch (problem) {
      // Without this the button simply returned to idle, which reads as a
      // click that did not register rather than a request that failed.
      setError(problem instanceof Error ? problem.message : "The review could not be started.");
    } finally {
      setStarting(false);
    }
  }

  const shown = (branches ?? []).filter((branch) => branch.name.includes(filter));

  const ready = fromBranch !== "" && intoBranch !== "" && model !== "" && rulesetId !== "";

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
        <form onSubmit={start} className="grid max-w-3xl gap-5">
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
                className="max-w-56"
              />
            </div>

            {branchesAsOf ? (
              <p className="mb-2 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                {stale
                  ? "Cached refs, shown because the remote could not be reached."
                  : `Fetched from the remote at ${branchesAsOf.toLocaleTimeString()}.`}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-[var(--color-ink)]"
                  onClick={() => {
                    setBranches(null);
                    setRefreshCount((count) => count + 1);
                  }}
                >
                  Refresh
                </button>
              </p>
            ) : null}

            {branches === null ? (
              <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
                Fetching the latest branches...
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {shown.map((branch) => (
                  <li key={branch.name}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
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
                  <li className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
                    No branch matches that filter.
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
                {rulesets.length === 0 ? <option value="">No rulesets imported yet</option> : null}
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
              <Select value={effort} onChange={(event) => setEffort(event.target.value)}>
                {EFFORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Card className="p-4">
            <h2 className="text-sm font-medium">Model</h2>
            <p className="mt-1 mb-3 text-xs text-[var(--color-ink-muted)]">
              Only a model a fresh probe vouches for can run a review. A probe is one tiny paid
              call, made only when you press the button (never on a timer).
            </p>
            <ul className="grid gap-1" data-testid="model-picker">
              {models.map((row) => {
                const selectable = isSelectable(row.availability);
                return (
                  <li key={row.id}>
                    <label
                      className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
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
                        onChange={() => setModel(row.id)}
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
                    {preflight?.modelProfile ? ` (${preflight.modelProfile})` : ""}
                  </option>
                  {["chunked", "decomposed"]
                    .filter((candidate) => {
                      // Only genuine downgrades are offered: the server refuses
                      // anything stronger than the model is registered for.
                      const rank = ["full-context", "chunked", "decomposed"];
                      const base = preflight?.modelProfile ?? "full-context";
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
                  <p className="mb-1 font-medium text-[var(--color-ink)]">
                    Adversarial requests by profile
                  </p>
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
              <h2 className="text-sm font-medium">Review a dependency at the same time</h2>
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
                        setLinkBranches([]);
                        setLinkFrom("");
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

                {includeLink !== "" && linkBranches.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Its branch"
                      hint={
                        linkBranches.some((branch) => branch.name === fromBranch)
                          ? "Suggested: it has a branch of the same name."
                          : undefined
                      }
                    >
                      <Select
                        value={linkFrom}
                        onChange={(event) => setLinkFrom(event.target.value)}
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
                        value={linkInto}
                        onChange={(event) => setLinkInto(event.target.value)}
                      >
                        {linkBranches.map((branch) => (
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

          {readyToPreflight && preflightError ? <Problem>{preflightError}</Problem> : null}

          {readyToPreflight && preflight ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium">What this review will examine</h2>
              <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <Row label="Files changed" value={String(preflight.files)} />
                <Row label="Hunks" value={String(preflight.hunks)} />
                <Row label="Sweep hits" value={String(preflight.sweepHits)} />
                {preflight.changedSymbols > 0 ? (
                  <Row label="Changed exports" value={String(preflight.changedSymbols)} />
                ) : null}
                <Row label="Model requests" value={String(preflight.requests)} />
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
                    would refuse to start: {preflight.sweepProblems[0]}
                  </Problem>
                </div>
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

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!ready || starting}>
              {starting ? "Starting..." : "Start review"}
            </Button>
            {rulesets.length === 0 ? (
              <span className="text-sm text-[var(--color-ink-muted)]">
                Import a ruleset first:{" "}
                <Link href="/rulesets" className="underline">
                  Rulesets
                </Link>
              </span>
            ) : (
              <span className="text-sm text-[var(--color-ink-muted)]">
                The commits are pinned when the review starts.
              </span>
            )}
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

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
import { PageBody, PageHeader } from "@/components/page";
import { Button, Card, Field, Input, Mono, Problem, Select, Textarea } from "@/components/ui";

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
}

interface Model {
  id: string;
  displayName: string;
  availability: string;
  contextWindow: number | null;
  recommended: boolean;
  lastError: string | null;
}

const EFFORTS = [
  { value: "medium", label: "Medium" },
  { value: "high", label: "High (recommended)" },
  { value: "max", label: "Max" },
  { value: "low", label: "Low" },
];

function NewReview() {
  const router = useRouter();
  const search = useSearchParams();
  const projectId = search.get("projectId") ?? "";
  // Arrived from a branch row on the project page, which already made this
  // choice; making it again would be busywork.
  const prefilledBranch = search.get("fromBranch") ?? "";

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [filter, setFilter] = useState("");

  const [fromBranch, setFromBranch] = useState(prefilledBranch);
  const [intoBranch, setIntoBranch] = useState("");
  const [rulesetId, setRulesetId] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  const [intent, setIntent] = useState("");

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // One effect, one guarded async body. Everything this screen needs is
  // fetched together so the form does not appear a field at a time.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    void (async () => {
      const [branchList, rulesetList, modelList] = await Promise.all([
        fetch(`/api/projects/${projectId}/branches`).then((response) => response.json()),
        fetch("/api/rulesets").then((response) => response.json()),
        fetch("/api/models").then((response) => response.json()),
      ]);
      if (cancelled) return;

      setBranches(branchList.branches ?? []);
      setStale(branchList.stale ?? null);
      if (branchList.error) setError(String(branchList.error));
      setIntoBranch((current) => current || (branchList.defaultBranch ?? ""));

      setRulesets(rulesetList.rulesets);
      setRulesetId((current) => current || (rulesetList.rulesets[0]?.id ?? ""));

      setModels(modelList.models);
      const usable = modelList.models.find((row: Model) => row.availability === "available");
      setModel((current) => current || (usable?.id ?? modelList.models[0]?.id ?? ""));
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
          ...(intent.trim() === "" ? {} : { intent }),
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
              <Select value={intoBranch} onChange={(event) => setIntoBranch(event.target.value)}>
                {(branches ?? []).map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Rules" hint="What the change is judged against, frozen at the start.">
              <Select value={rulesetId} onChange={(event) => setRulesetId(event.target.value)}>
                {rulesets.length === 0 ? <option value="">No rulesets imported yet</option> : null}
                {rulesets.map((ruleset) => (
                  <option key={ruleset.id} value={ruleset.id}>
                    {ruleset.name} (v{ruleset.version})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Model">
              <Select value={model} onChange={(event) => setModel(event.target.value)}>
                {models.map((row) => (
                  <option
                    key={row.id}
                    value={row.id}
                    disabled={row.availability !== "available" && row.availability !== "unknown"}
                  >
                    {row.displayName}
                    {row.availability === "available" ? "" : ` (${row.availability})`}
                  </option>
                ))}
              </Select>
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

export default function NewReviewPage() {
  return (
    <Suspense fallback={null}>
      <NewReview />
    </Suspense>
  );
}

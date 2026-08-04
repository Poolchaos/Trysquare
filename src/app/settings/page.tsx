"use client";

/**
 * Settings, sign-in, and which models this account can actually use.
 *
 * Probing is a button and never a background task. A probe is a real call that
 * spends a fraction of a cent, and an app that probed on a timer would spend
 * someone's usage while they were not looking.
 */

import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Empty, Field, Input, Mono, Problem } from "@/components/ui";

interface Model {
  id: string;
  displayName: string;
  availability: string;
  contextWindow: number | null;
  lastProbedAt: string | null;
  lastError: string | null;
  recommended: boolean;
}

interface Auth {
  loggedIn: boolean;
  usesSubscription: boolean;
  authMethod?: string;
  subscriptionType?: string;
}

const FIELDS = [
  {
    key: "maxConcurrentReviews",
    label: "Reviews at once",
    hint: "Two share one usage limit and make each other slower.",
  },
  {
    key: "stageTimeoutMinutes",
    label: "Stage timeout (minutes)",
    hint: "How long one stage may take before the run gives up on it.",
  },
  {
    key: "stageMaxBudgetUsd",
    label: "Budget per call (USD)",
    hint: "A ceiling on any single model call. Zero removes the ceiling.",
  },
] as const;

interface SystemInfo {
  dataDir: string;
  exportsDir: string;
  counts: { projects: number; reviews: number; rulesets: number };
  running: number;
}

export default function SettingsPage() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [settings, setSettings] = useState<Record<string, number> | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [probing, setProbing] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [modelList, settingList, systemInfo] = await Promise.all([
        fetch("/api/models").then((response) => response.json()),
        fetch("/api/settings").then((response) => response.json()),
        fetch("/api/system").then((response) => response.json()),
      ]);
      if (cancelled) return;
      setModels(modelList.models);
      setSettings(settingList.settings);
      setSystem(systemInfo as SystemInfo);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: string, raw: string) {
    setError("");
    setSaved(false);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setError(`${key} needs a number.`);
      return;
    }
    const response = await fetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
    const body = (await response.json()) as { settings?: Record<string, number>; error?: string };
    if (!response.ok) {
      setError(body.error ?? "That setting could not be saved.");
      return;
    }
    setSettings(body.settings ?? null);
    setSaved(true);
  }

  async function probe(id: string) {
    setError("");
    setProbing(id);
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(id)}/probe`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "The probe failed.");
        return;
      }
      const refreshed = (await (await fetch("/api/models")).json()) as { models: Model[] };
      setModels(refreshed.models);
    } finally {
      setProbing("");
    }
  }

  /**
   * Probes every registered model, one at a time.
   *
   * Sequential rather than parallel: each probe is a real call against one
   * account's rate limit, and firing eight at once is how a convenience
   * button becomes the reason a review pauses.
   */
  async function probeAll() {
    setError("");
    for (const model of models ?? []) {
      setProbing(model.id);
      try {
        await fetch(`/api/models/${encodeURIComponent(model.id)}/probe`, { method: "POST" });
      } catch {
        // One unreachable model must not stop the rest; its row keeps
        // whatever the last probe said, and the list below shows it.
      }
    }
    setProbing("");
    const refreshed = (await (await fetch("/api/models")).json()) as { models: Model[] };
    setModels(refreshed.models);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Reviews run through the Claude Code CLI using your existing sign-in. This app stores no API key."
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">How a run behaves</h2>
            {settings === null ? null : (
              <div className="grid gap-4">
                {FIELDS.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    <Input
                      type="number"
                      defaultValue={settings[field.key]}
                      onBlur={(event) => void save(field.key, event.target.value)}
                    />
                  </Field>
                ))}
                {saved ? (
                  <p className="text-xs text-[var(--color-good)]">Saved.</p>
                ) : (
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    Saved when you leave the field.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold">Sign-in</h2>
            <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
              Runs the CLI&apos;s own status check locally. Nothing is sent anywhere and nothing is
              spent.
            </p>
            {auth ? (
              <div className="mb-3 grid gap-1 text-sm">
                <p>{auth.loggedIn ? "Signed in." : "Not signed in."}</p>
                {auth.loggedIn ? (
                  <p
                    className={
                      auth.usesSubscription
                        ? "text-[var(--color-good)]"
                        : "text-[var(--color-warning)]"
                    }
                  >
                    {auth.usesSubscription
                      ? `Runs draw on your ${auth.subscriptionType ?? "subscription"}, at no extra cost.`
                      : "This sign-in bills per token rather than drawing on a subscription."}
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button
              disabled={checkingAuth}
              onClick={async () => {
                setCheckingAuth(true);
                try {
                  const response = await fetch("/api/auth");
                  if (response.ok) setAuth(((await response.json()) as { auth: Auth }).auth);
                } finally {
                  setCheckingAuth(false);
                }
              }}
            >
              {checkingAuth ? "Checking..." : "Check sign-in"}
            </Button>
          </Card>
        </div>

        <Card className="mt-6 p-4">
          <h2 className="mb-1 text-sm font-semibold">Where everything is kept</h2>
          {system === null ? (
            <p className="text-xs text-[var(--color-ink-muted)]">Reading...</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
                Clones, worktrees, bundles, logs and the database live here. Move it by setting
                TRYSQUARE_DATA before starting the server.
              </p>
              <Mono className="block break-all text-sm">{system.dataDir}</Mono>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                Holding {system.counts.projects} project(s), {system.counts.reviews} review(s) and{" "}
                {system.counts.rulesets} ruleset(s). Exported reports are written to{" "}
                <Mono className="break-all">{system.exportsDir}</Mono> and survive deleting any of
                it.
              </p>
            </>
          )}
        </Card>

        <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="mb-1 text-sm font-semibold">Models</h2>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Probing asks the CLI whether a model is usable and what context window it has. Each
              probe is a real call, so it happens only when you ask.
            </p>
          </div>
          <Button
            disabled={probing !== "" || (models?.length ?? 0) === 0}
            onClick={() => void probeAll()}
          >
            {probing === "" ? "Probe all" : "Probing..."}
          </Button>
        </div>

        {models === null ? null : models.length === 0 ? (
          <Empty title="No models registered yet">
            They are registered when the server starts.
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {models.map((model) => (
              <li key={model.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {model.displayName}
                      {model.recommended ? <Badge tone="accent">recommended</Badge> : null}
                    </span>
                    <Mono className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
                      {model.id}
                    </Mono>
                    {model.lastError ? (
                      <span className="mt-1 block text-xs text-[var(--color-critical)]">
                        {model.lastError}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
                    {model.contextWindow ? (
                      <span>{model.contextWindow.toLocaleString("en-US")} tokens</span>
                    ) : null}
                    {model.lastProbedAt ? (
                      <span>probed {model.lastProbedAt.slice(0, 10)}</span>
                    ) : null}
                    <Badge tone={model.availability === "available" ? "good" : "neutral"}>
                      {model.availability}
                    </Badge>
                    <Button disabled={probing !== ""} onClick={() => void probe(model.id)}>
                      {probing === model.id ? "Probing..." : "Probe"}
                    </Button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <Card className="mt-8 max-w-2xl border-[var(--color-critical)] p-4">
          <h2 className="mb-1 text-sm font-semibold text-[var(--color-critical)]">Danger zone</h2>
          <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
            Deletes every project, review and ruleset, and the clones, worktrees, bundles and logs
            on disk. Exported reports are kept: a report is the thing a review was for. Refused
            while a review is running.
          </p>

          {wiped ? (
            <p className="mb-3 text-sm text-[var(--color-good)]">{wiped}</p>
          ) : confirmingWipe ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={wiping}
                onClick={async () => {
                  setError("");
                  setWiping(true);
                  try {
                    const response = await fetch("/api/system/data", { method: "DELETE" });
                    const body = (await response.json()) as {
                      deleted?: { projects: number; reviews: number; rulesets: number };
                      error?: string;
                    };
                    if (!response.ok || !body.deleted) {
                      setError(body.error ?? "The data could not be deleted.");
                      return;
                    }
                    setWiped(
                      `Deleted ${body.deleted.projects} project(s), ${body.deleted.reviews} ` +
                        `review(s) and ${body.deleted.rulesets} ruleset(s). Exports were kept.`,
                    );
                    setConfirmingWipe(false);
                    const refreshed = (await (await fetch("/api/system")).json()) as SystemInfo;
                    setSystem(refreshed);
                  } finally {
                    setWiping(false);
                  }
                }}
              >
                {wiping ? "Deleting..." : "Yes, delete everything"}
              </Button>
              <Button variant="quiet" onClick={() => setConfirmingWipe(false)}>
                Keep it all
              </Button>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {system
                  ? `${system.counts.projects} project(s), ${system.counts.reviews} review(s), ${system.counts.rulesets} ruleset(s).`
                  : ""}
              </span>
            </div>
          ) : (
            <Button onClick={() => setConfirmingWipe(true)}>Delete all data</Button>
          )}
        </Card>
      </PageBody>
    </>
  );
}

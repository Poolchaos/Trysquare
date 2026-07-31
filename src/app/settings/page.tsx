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

export default function SettingsPage() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [settings, setSettings] = useState<Record<string, number> | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [probing, setProbing] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [modelList, settingList] = await Promise.all([
        fetch("/api/models").then((response) => response.json()),
        fetch("/api/settings").then((response) => response.json()),
      ]);
      if (cancelled) return;
      setModels(modelList.models);
      setSettings(settingList.settings);
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

        <h2 className="mt-8 mb-1 text-sm font-semibold">Models</h2>
        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
          Probing asks the CLI whether a model is usable and what context window it has. Each probe
          is a real call, so it happens only when you ask.
        </p>

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
      </PageBody>
    </>
  );
}

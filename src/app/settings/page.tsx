"use client";

/**
 * Settings, sign-in, and which models this account can actually use.
 *
 * Probing is a button and never a background task. A probe is a real call that
 * spends a fraction of a cent, and an app that probed on a timer would spend
 * someone's usage while they were not looking.
 */

import { useEffect, useState } from "react";
import { Loading, PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Empty, Field, Input, Mono, Problem } from "@/components/ui";
import { send } from "@/components/request";

interface Model {
  id: string;
  displayName: string;
  availability: string;
  contextWindow: number | null;
  lastProbedAt: string | null;
  lastError: string | null;
  recommended: boolean;
}

/** As `readCliStatus` answers, one state each (MVP 6.1, audit E2). */
type CliStatus =
  | { state: "notFound"; message: string }
  | { state: "cannotRun"; path?: string; version?: string; message: string }
  | { state: "signedOut"; path: string; version: string }
  | { state: "perToken"; path: string; version: string; authMethod?: string }
  | { state: "subscription"; path: string; version: string; subscriptionType?: string };

/** "max" as the CLI reports it, "Max plan's" as a person reads it. */
function planName(subscriptionType: string | undefined): string {
  if (subscriptionType === undefined || subscriptionType === "") return "subscription's";
  return `${subscriptionType.charAt(0).toUpperCase()}${subscriptionType.slice(1)} plan's`;
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
  const [settings, setSettings] = useState<Record<string, number | string> | null>(null);
  // The path the server was started with, which wins over the one kept here.
  const [environmentPath, setEnvironmentPath] = useState<string | null>(null);
  const [pathSaved, setPathSaved] = useState(false);
  const [pathProblem, setPathProblem] = useState("");
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliProblem, setCliProblem] = useState("");
  const [checkingCli, setCheckingCli] = useState(false);
  const [probing, setProbing] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState("");

  // Each read answers for its own section: one that fails says why there,
  // with Try again, while the others draw. A failed read left its section
  // blank, or "Reading..." for good (5.13, U9).
  const [readErrors, setReadErrors] = useState<
    Partial<Record<"models" | "settings" | "system", string>>
  >({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryReads = () => {
    setReadErrors({});
    setLoadAttempt((attempt) => attempt + 1);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [modelList, settingList, systemInfo] = await Promise.all([
        send<{ models: Model[] }>("/api/models", {}, "The models could not be read"),
        send<{
          settings: Record<string, number | string>;
          environment?: { claudePath: string | null };
        }>("/api/settings", {}, "The settings could not be read"),
        send<SystemInfo>("/api/system", {}, "Where everything is kept could not be read"),
      ]);
      if (cancelled) return;
      const failed: Partial<Record<"models" | "settings" | "system", string>> = {};
      if (modelList.ok) setModels(modelList.body.models);
      else failed.models = modelList.error;
      if (settingList.ok) {
        setSettings(settingList.body.settings);
        setEnvironmentPath(settingList.body.environment?.claudePath ?? null);
      } else failed.settings = settingList.error;
      if (systemInfo.ok) setSystem(systemInfo.body);
      else failed.system = systemInfo.error;
      setReadErrors(failed);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  async function save(field: (typeof FIELDS)[number], input: HTMLInputElement) {
    setError("");
    setSaved(false);
    const restore = () => {
      if (settings !== null) input.value = String(settings[field.key]);
    };
    // A number field reads "" for what is not yet a number, "1e" or "-", as
    // much as for an empty one, so that is asked first: such input was told
    // it had been left empty (review of 5.1 to 5.4).
    if (input.validity.badInput) {
      restore();
      setError(`${field.label} needs a number, so it was not changed.`);
      return;
    }
    // An emptied field is a field left alone, not a request for zero:
    // Number("") is 0, and for the budget zero removes the ceiling, so
    // clearing it lifted the cap on every model call without a word (5.3).
    if (input.value.trim() === "") {
      restore();
      setError(
        `${field.label} was left empty, so it was not changed.` +
          (field.key === "stageMaxBudgetUsd" ? " To remove the ceiling, enter 0." : ""),
      );
      return;
    }
    const sent = await send<{ settings?: Record<string, number | string> }>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ [field.key]: Number(input.value) }) },
      "That setting could not be saved",
    );
    if (!sent.ok) {
      setError(sent.error);
      return;
    }
    setSettings(sent.body.settings ?? null);
    setSaved(true);
  }

  async function savePath(input: HTMLInputElement) {
    const kept = String(settings?.claudePath ?? "");
    if (input.value.trim() === kept) {
      input.value = kept;
      return;
    }
    setPathProblem("");
    setPathSaved(false);
    // Empty is a choice here, not a slip: it means the CLI npm install put in
    // node_modules, then PATH.
    const sent = await send<{ settings?: Record<string, number | string> }>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ claudePath: input.value }) },
      "The CLI path could not be saved",
    );
    if (!sent.ok) {
      input.value = kept;
      setPathProblem(sent.error);
      return;
    }
    setSettings(sent.body.settings ?? null);
    input.value = String(sent.body.settings?.claudePath ?? "");
    setPathSaved(true);
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
            <h2 className="mb-3 text-heading font-semibold">How a run behaves</h2>
            {settings === null ? (
              <Loading
                {...(readErrors.settings ? { error: readErrors.settings } : {})}
                onRetry={retryReads}
              />
            ) : (
              <div className="grid gap-4">
                {FIELDS.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    <Input
                      type="number"
                      defaultValue={settings[field.key]}
                      onBlur={(event) => void save(field, event.currentTarget)}
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
            <h2 className="mb-1 text-heading font-semibold">Claude Code</h2>
            <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
              Finds the CLI reviews run through and runs its own version and sign-in checks locally.
              Nothing is sent anywhere and nothing is spent.
            </p>
            {settings === null ? null : (
              <div className="mb-3 grid gap-1">
                <Field
                  label="CLI path"
                  hint="Empty uses the CLI npm install put in node_modules, then claude on PATH. Saved when you leave the field; Check the CLI to see whether it runs."
                >
                  <Input
                    defaultValue={String(settings.claudePath ?? "")}
                    placeholder="The CLI installed with this app"
                    spellCheck={false}
                    onBlur={(event) => void savePath(event.currentTarget)}
                  />
                </Field>
                {environmentPath === null ? null : (
                  <p className="text-xs text-[var(--color-warning)]">
                    TRYSQUARE_CLAUDE_PATH is set to{" "}
                    <Mono className="break-all">{environmentPath}</Mono> for this server, and wins
                    over the path here.
                  </p>
                )}
                {pathSaved ? <p className="text-xs text-[var(--color-good)]">Saved.</p> : null}
                {pathProblem === "" ? null : <Problem>{pathProblem}</Problem>}
              </div>
            )}
            {cli ? (
              <div className="mb-3 grid gap-1 text-sm" data-testid="cli-status">
                {cli.state === "notFound" || cli.path === undefined ? null : (
                  <p className="text-xs text-[var(--color-ink-muted)]" data-testid="cli-path">
                    <Mono className="break-all">{cli.path}</Mono>
                    {cli.version === undefined ? null : `, ${cli.version}`}
                  </p>
                )}
                {cli.state === "notFound" ? (
                  <>
                    <p className="text-[var(--color-critical)]">No Claude Code CLI was found.</p>
                    <p className="text-xs break-words text-[var(--color-ink-muted)]">
                      {cli.message}
                    </p>
                  </>
                ) : cli.state === "cannotRun" ? (
                  <>
                    <p className="text-[var(--color-critical)]">The CLI cannot run reviews.</p>
                    <p className="text-xs break-words text-[var(--color-ink-muted)]">
                      {cli.message}
                    </p>
                  </>
                ) : cli.state === "signedOut" ? (
                  <p className="text-[var(--color-warning)]">Not signed in.</p>
                ) : cli.state === "perToken" ? (
                  <p className="text-[var(--color-warning)]">
                    {cli.authMethod === undefined
                      ? "Signed in, but the CLI did not say how, so whether reviews draw on a subscription or bill per token is not known. Reviews still run."
                      : `Signed in, but this sign-in (${cli.authMethod}) bills per token rather than drawing on a subscription. Reviews still run.`}
                  </p>
                ) : (
                  <p className="text-[var(--color-good)]">
                    {/* What the CLI's support article says of headless runs, and no more:
                        they draw on the plan's usage limits (DECISIONS, 2026-07-30). */}
                    Signed in. Reviews draw on your {planName(cli.subscriptionType)} usage limits
                    rather than billing per token.
                  </p>
                )}
              </div>
            ) : null}
            {cliProblem === "" ? null : (
              <div className="mb-3">
                <Problem>{cliProblem}</Problem>
              </div>
            )}
            <Button
              disabled={checkingCli}
              onClick={async () => {
                setCheckingCli(true);
                try {
                  const sent = await send<{ cli: CliStatus }>(
                    "/api/auth",
                    { method: "GET" },
                    "The CLI could not be checked",
                  );
                  if (sent.ok) {
                    setCli(sent.body.cli);
                    setCliProblem("");
                  } else {
                    setCli(null);
                    setCliProblem(sent.error);
                  }
                } finally {
                  setCheckingCli(false);
                }
              }}
            >
              {checkingCli ? "Checking..." : "Check the CLI"}
            </Button>
          </Card>
        </div>

        <Card className="mt-6 p-4">
          <h2 className="mb-1 text-heading font-semibold">Where everything is kept</h2>
          {system === null ? (
            <Loading
              {...(readErrors.system ? { error: readErrors.system } : {})}
              onRetry={retryReads}
            />
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
            <h2 className="mb-1 text-heading font-semibold">Models</h2>
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

        {models === null ? (
          <Loading
            {...(readErrors.models ? { error: readErrors.models } : {})}
            onRetry={retryReads}
          />
        ) : models.length === 0 ? (
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
          <h2 className="mb-1 text-heading font-semibold text-[var(--color-critical)]">
            Danger zone
          </h2>
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

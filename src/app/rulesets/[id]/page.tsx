"use client";

/**
 * One ruleset: every rule it contains, what each says, and which apply.
 *
 * Switching a rule off or changing its severity moves the ruleset's version,
 * which the page says out loud, because a review's report names the version
 * it was judged against and two different rule sets must never share one.
 */

import { use, useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader, PageLoading } from "@/components/page";
import { Badge, Button, Card, Input, Mono, Problem, Select, severityTone } from "@/components/ui";
import { send } from "@/components/request";

interface Detail {
  ruleset: {
    id: string;
    name: string;
    tier: string;
    version: number;
    sourceDoc: string | null;
    createdAt: string;
    updatedAt: string;
    isDefault: boolean;
  };
  directives: { section: string; title: string; contentMd: string }[];
  rules: {
    code: string;
    title: string;
    severity: string;
    tags: string[];
    sweepPatterns: string[];
    enabled: boolean;
  }[];
}

const SEVERITIES = ["CRITICAL", "WARNING", "NITPICK"];
const TIERS = ["global", "tech", "project"];

export default function RulesetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState("");
  // The ruleset does not exist: the way back, not a Try again that could
  // never work (D-138).
  const [loadMissing, setLoadMissing] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showDirectives, setShowDirectives] = useState(false);
  const [openDirective, setOpenDirective] = useState("");
  const [openSweeps, setOpenSweeps] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateTier, setDuplicateTier] = useState("global");
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicated, setDuplicated] = useState("");

  // Read again after a change; one that fails says so, where it used to
  // leave the page showing the ruleset as it was before (audit finding U2).
  const load = useCallback(async () => {
    const sent = await send<Detail>(
      `/api/rulesets/${id}`,
      {},
      "This ruleset could not be read again",
    );
    if (sent.ok) setDetail(sent.body);
    else setError(sent.error);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sent = await send<Detail>(`/api/rulesets/${id}`, {}, "This ruleset could not be read");
      if (cancelled) return;
      if (sent.ok) setDetail(sent.body);
      else {
        setLoadError(sent.error);
        setLoadMissing(sent.status === 404);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadAttempt]);

  async function amend(code: string, patch: { enabled?: boolean; severity?: string }) {
    setError("");
    setBusy(code);
    try {
      const sent = await send(
        `/api/rulesets/${id}/rules/${encodeURIComponent(code)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        "The rule could not be changed",
      );
      if (!sent.ok) {
        setError(sent.error);
        return;
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  /** The ruleset a new review starts on (D-225); one at a time, so it moves. */
  async function makeDefault(on: boolean) {
    setError("");
    setBusy("default");
    try {
      const sent = await send(
        `/api/rulesets/${id}/default`,
        { method: on ? "PUT" : "DELETE" },
        "The default could not be changed",
      );
      if (!sent.ok) {
        setError(sent.error);
        return;
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  async function duplicate() {
    setError("");
    setBusy("duplicate");
    try {
      const sent = await send<{ rulesetId?: string }>(
        `/api/rulesets/${id}/duplicate`,
        {
          method: "POST",
          body: JSON.stringify({
            tier: duplicateTier,
            ...(duplicateName.trim() === "" ? {} : { name: duplicateName.trim() }),
          }),
        },
        "The ruleset could not be duplicated",
      );
      if (!sent.ok || !sent.body.rulesetId) {
        setError(sent.ok ? "The ruleset could not be duplicated." : sent.error);
        return;
      }
      setDuplicating(false);
      setDuplicated(sent.body.rulesetId);
    } finally {
      setBusy("");
    }
  }

  if (!detail) {
    return (
      <PageLoading
        title="Ruleset"
        {...(loadError === "" ? {} : { error: loadError })}
        {...(loadMissing
          ? { back: { href: "/rulesets", label: "All rulesets" } }
          : {
              onRetry: () => {
                setLoadError("");
                setLoadAttempt((attempt) => attempt + 1);
              },
            })}
      />
    );
  }

  const off = detail.rules.filter((rule) => !rule.enabled).length;

  return (
    <>
      <PageHeader
        title={detail.ruleset.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <Badge>{detail.ruleset.tier}</Badge>
            <span>version {detail.ruleset.version}</span>
            <span>
              {detail.rules.length} rule(s)
              {off > 0 ? `, ${off} switched off` : ""}
            </span>
            {detail.ruleset.isDefault ? <Badge tone="accent">default for new reviews</Badge> : null}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy !== ""}
              onClick={() => void makeDefault(!detail.ruleset.isDefault)}
            >
              {detail.ruleset.isDefault
                ? "Stop using by default"
                : "Use by default for new reviews"}
            </Button>
            <Button onClick={() => setDuplicating((open) => !open)}>Duplicate to tier</Button>
            <a href={`/api/rulesets/${id}/export`} download>
              <Button>Export document</Button>
            </a>
          </span>
        }
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}

        {duplicating ? (
          <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-40">
              <label className="mb-1.5 block text-sm font-medium" htmlFor="duplicate-tier">
                Copy into tier
              </label>
              <Select
                id="duplicate-tier"
                value={duplicateTier}
                onChange={(event) => setDuplicateTier(event.target.value)}
              >
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-56 flex-1">
              <label className="mb-1.5 block text-sm font-medium" htmlFor="duplicate-name">
                Called
              </label>
              <Input
                id="duplicate-name"
                value={duplicateName}
                onChange={(event) => setDuplicateName(event.target.value)}
                placeholder={`${detail.ruleset.name} (${duplicateTier})`}
              />
            </div>
            <Button variant="primary" disabled={busy !== ""} onClick={() => void duplicate()}>
              Copy as version 1
            </Button>
            <p className="w-full text-xs text-[var(--color-ink-muted)]">
              The copy keeps the toggles as they stand and starts its own history: a rule proven
              here can become a standard elsewhere without rewriting the document. A name already in
              use is refused rather than overwritten.
            </p>
          </Card>
        ) : null}

        {duplicated ? (
          <p className="mb-4 rounded-md border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[var(--color-good)]">
            Copied.{" "}
            <a href={`/rulesets/${duplicated}`} className="underline">
              Open the copy
            </a>
            .
          </p>
        ) : null}

        <p className="mb-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
          A switched-off rule is left out of the rules a new review is judged against, and its
          mechanical sweeps do not run. Changing a severity is a new standard, so it moves the
          version too. Reviews already started keep the rules they were frozen with. The exported
          document always contains every rule, because it is the document that was imported.
        </p>
        <p className="mb-4 text-xs text-[var(--color-ink-faint)]">
          {detail.ruleset.sourceDoc ? `Imported from ${detail.ruleset.sourceDoc}. ` : ""}
          Created {detail.ruleset.createdAt.slice(0, 10)}, last changed{" "}
          {detail.ruleset.updatedAt.slice(0, 10)}.
        </p>

        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Tags</th>
                <th className="px-3 py-2 font-medium">Sweeps</th>
                <th className="px-3 py-2 text-right font-medium">Applies</th>
              </tr>
            </thead>
            <tbody>
              {detail.rules.map((rule) => (
                <tr
                  key={rule.code}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    rule.enabled ? "" : "opacity-55"
                  }`}
                >
                  <td className="px-3 py-2">
                    <Mono className="text-xs text-[var(--color-ink-muted)]">{rule.code}</Mono>
                    <span className="ml-2">{rule.title}</span>
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <span className="sr-only">Severity of rule {rule.code}</span>
                      <Badge tone={severityTone(rule.severity)}>{rule.severity}</Badge>
                      <Select
                        value={rule.severity}
                        disabled={busy !== ""}
                        onChange={(event) =>
                          void amend(rule.code, { severity: event.target.value })
                        }
                        className="w-auto px-2 py-1 text-xs"
                      >
                        {SEVERITIES.map((severity) => (
                          <option key={severity} value={severity}>
                            {severity}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                    {rule.tags.join(", ") || "any"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                    {rule.sweepPatterns.length === 0 ? (
                      "0"
                    ) : (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-[var(--color-ink)]"
                        aria-expanded={openSweeps === rule.code}
                        onClick={() =>
                          setOpenSweeps((open) => (open === rule.code ? "" : rule.code))
                        }
                      >
                        {rule.sweepPatterns.length}
                      </button>
                    )}
                    {openSweeps === rule.code ? (
                      <ul className="mt-1 grid gap-0.5">
                        {rule.sweepPatterns.map((pattern) => (
                          <li key={pattern}>
                            <Mono className="text-xs">{pattern}</Mono>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <label className="inline-flex items-center gap-2">
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {rule.enabled ? "on" : "off"}
                      </span>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={busy !== ""}
                        onChange={(event) =>
                          void amend(rule.code, { enabled: event.target.checked })
                        }
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <button
          type="button"
          className="mt-6 text-sm text-[var(--color-accent)] hover:underline"
          onClick={() => setShowDirectives((shown) => !shown)}
        >
          {showDirectives ? "Hide" : "Show"} the {detail.directives.length} process directive(s)
        </button>
        {showDirectives ? (
          <ul className="mt-2 grid gap-1 text-sm">
            {detail.directives.map((directive) => {
              const key = `${directive.section}-${directive.title}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    aria-expanded={openDirective === key}
                    onClick={() => setOpenDirective((open) => (open === key ? "" : key))}
                  >
                    {directive.section}: {directive.title}
                  </button>
                  {openDirective === key ? (
                    // Verbatim, because this is what the model is given.
                    <pre className="mt-1 mb-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs whitespace-pre-wrap">
                      <code className="font-[family-name:var(--font-mono)]">
                        {directive.contentMd}
                      </code>
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </PageBody>
    </>
  );
}

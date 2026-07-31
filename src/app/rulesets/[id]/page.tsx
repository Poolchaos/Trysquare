"use client";

/**
 * One ruleset: every rule it contains, and which of them apply.
 *
 * Switching a rule off moves the ruleset's version, which the page says out
 * loud, because a review's report names the version it was judged against and
 * two different rule sets must never share one.
 */

import { use, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Mono, Problem, severityTone } from "@/components/ui";

interface Detail {
  ruleset: { id: string; name: string; tier: string; version: number };
  directives: { section: string; title: string }[];
  rules: {
    code: string;
    title: string;
    severity: string;
    tags: string[];
    sweepPatterns: number;
    enabled: boolean;
  }[];
}

export default function RulesetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showDirectives, setShowDirectives] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/rulesets/${id}`);
      if (response.ok && !cancelled) setDetail((await response.json()) as Detail);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function toggle(code: string, enabled: boolean) {
    setError("");
    setBusy(code);
    try {
      const response = await fetch(`/api/rulesets/${id}/rules/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "That did not work.");
        return;
      }
      const refreshed = await fetch(`/api/rulesets/${id}`);
      if (refreshed.ok) setDetail((await refreshed.json()) as Detail);
    } finally {
      setBusy("");
    }
  }

  if (!detail) return <PageBody>Loading...</PageBody>;

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
          </span>
        }
        actions={
          <a href={`/api/rulesets/${id}/export`} download>
            <Button>Export document</Button>
          </a>
        }
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}

        <p className="mb-4 max-w-2xl text-sm text-[var(--color-ink-muted)]">
          A switched-off rule is left out of the rules a new review is judged against, and its
          mechanical sweeps do not run. Reviews already started keep the rules they were frozen
          with. The exported document always contains every rule, because it is the document that
          was imported.
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
                    <Badge tone={severityTone(rule.severity)}>{rule.severity}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                    {rule.tags.join(", ") || "any"}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{rule.sweepPatterns}</td>
                  <td className="px-3 py-2 text-right">
                    <label className="inline-flex items-center gap-2">
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {rule.enabled ? "on" : "off"}
                      </span>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={busy !== ""}
                        onChange={(event) => void toggle(rule.code, event.target.checked)}
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
          <ul className="mt-2 grid gap-1 text-sm text-[var(--color-ink-muted)]">
            {detail.directives.map((directive) => (
              <li key={`${directive.section}-${directive.title}`}>
                {directive.section}: {directive.title}
              </li>
            ))}
          </ul>
        ) : null}
      </PageBody>
    </>
  );
}

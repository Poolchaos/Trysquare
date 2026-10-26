"use client";

/**
 * Rulesets: the standards a review is judged against.
 *
 * Importing is a paste rather than a file picker, because the document usually
 * already lives in another repository and copying it here is one step fewer
 * than saving it out first.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loading, PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Problem,
  Select,
  Textarea,
} from "@/components/ui";
import { send } from "@/components/request";

interface Ruleset {
  id: string;
  name: string;
  tier: string;
  version: number;
  ruleCount: number;
  sourceDoc: string | null;
  updatedAt: string;
}

/** Widest reach first: what applies everywhere, then per stack, then per repo. */
const TIER_ORDER = ["global", "tech", "project"];

export default function RulesetsPage() {
  const [rulesets, setRulesets] = useState<Ruleset[] | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("global");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  // The server's question when a different document would replace a stored
  // ruleset: it is asked, not done (5.9, A5). Dropped when the form changes,
  // so Replace never sends a name or document the question was not about.
  const [replacing, setReplacing] = useState("");
  const [importing, setImporting] = useState(false);

  // Why the list could not be read, said where it would be (5.13, U9): a
  // failed read used to leave the list empty for good, with no word.
  const [loadError, setLoadError] = useState("");
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const load = useCallback(async () => {
    const sent = await send<{ rulesets: Ruleset[]; defaultRulesetId: string | null }>(
      "/api/rulesets",
      {},
      "The rulesets could not be read",
    );
    if (!sent.ok) {
      setLoadError(sent.error);
      return;
    }
    setLoadError("");
    setRulesets(sent.body.rulesets);
    setDefaultId(sent.body.defaultRulesetId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sent = await send<{ rulesets: Ruleset[]; defaultRulesetId: string | null }>(
        "/api/rulesets",
        {},
        "The rulesets could not be read",
      );
      if (cancelled) return;
      if (sent.ok) {
        setRulesets(sent.body.rulesets);
        setDefaultId(sent.body.defaultRulesetId);
      } else setLoadError(sent.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  async function importRuleset(replace: boolean) {
    // One at a time: a second click while the first was out landed as a
    // ruleset that already exists (audit finding U2).
    if (importing) return;
    setImporting(true);
    try {
      await importNow(replace);
    } finally {
      setImporting(false);
    }
  }

  async function importNow(replace: boolean) {
    setError("");
    setResult("");
    setReplacing("");
    const sent = await send(
      "/api/rulesets/import",
      {
        method: "POST",
        body: JSON.stringify({ name, tier, markdown, ...(replace ? { replace: true } : {}) }),
      },
      "The document could not be imported",
    );
    const body = sent.body as {
      error?: string;
      code?: string;
      unmapped?: { line: number; text: string }[];
      rules?: number;
      directives?: number;
      version?: number;
      changed?: boolean;
      fidelity?: { totalLines: number; mappedLines: number };
    };
    if (sent.status === 409 && body.code === "RulesetExists") {
      setReplacing(body.error ?? `A ruleset called "${name}" already exists.`);
      return;
    }
    if (!sent.ok) {
      // A blocked import names the lines it would have dropped, so the fix is
      // an edit to the document rather than a guess.
      setError(
        sent.error +
          (body.unmapped?.length
            ? " " +
              body.unmapped
                .slice(0, 5)
                .map((entry) => `Line ${entry.line}: "${entry.text.trim()}"`)
                .join(" ") +
              (body.unmapped.length > 5 ? ` (and ${body.unmapped.length - 5} more)` : "")
            : ""),
      );
      return;
    }
    setResult(
      `Imported ${body.rules} rule(s) and ${body.directives} directive(s) as version ${body.version}` +
        (body.changed === false ? ", unchanged from what was already stored." : ".") +
        (body.fidelity
          ? ` All ${body.fidelity.totalLines} lines of the document are accounted for.`
          : ""),
    );
    setMarkdown("");
    await load();
  }

  return (
    <>
      <PageHeader
        title="Rulesets"
        subtitle="What a review checks against. Frozen onto a review when it starts, so editing one never changes a past review."
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void importRuleset(false);
              }}
              className="grid gap-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setReplacing("");
                    }}
                  />
                </Field>
                <Field label="Tier">
                  <Select
                    value={tier}
                    onChange={(event) => {
                      setTier(event.target.value);
                      setReplacing("");
                    }}
                  >
                    <option value="global">Global</option>
                    <option value="tech">Technology</option>
                    <option value="project">Project</option>
                  </Select>
                </Field>
              </div>
              <Field
                label="Protocol document"
                hint="Rejected if it produces no rules, because a review judged against nothing comes back clean."
              >
                <Textarea
                  rows={12}
                  value={markdown}
                  onChange={(event) => {
                    setMarkdown(event.target.value);
                    setReplacing("");
                  }}
                  placeholder="Paste the markdown protocol here"
                  className="font-[family-name:var(--font-mono)] text-xs"
                />
              </Field>
              {error ? <Problem>{error}</Problem> : null}
              {replacing ? (
                <div className="grid gap-2">
                  <p className="text-sm">{replacing}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={importing}
                      onClick={() => void importRuleset(true)}
                    >
                      Replace {name.trim()}
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setReplacing("")}>
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : null}
              {result ? (
                <p className="rounded-md border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[var(--color-good)]">
                  {result}
                </p>
              ) : null}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={importing || name === "" || markdown === ""}
                >
                  {importing ? "Importing..." : "Import"}
                </Button>
              </div>
            </form>
          </Card>

          <div>
            {rulesets !== null && loadError ? (
              <div className="mb-4">
                <Problem>{loadError}</Problem>
              </div>
            ) : null}
            {rulesets === null ? (
              <Loading
                {...(loadError === "" ? {} : { error: loadError })}
                onRetry={() => {
                  setLoadError("");
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              />
            ) : rulesets.length === 0 ? (
              <Empty title="No rulesets yet">
                Paste a protocol document to the left. Every review needs one.
              </Empty>
            ) : (
              TIER_ORDER.filter((tier) => rulesets.some((ruleset) => ruleset.tier === tier)).map(
                (tier) => (
                  <div key={tier} className="mb-4">
                    <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                      {tier} ({rulesets.filter((ruleset) => ruleset.tier === tier).length})
                    </h2>
                    <ul className="grid gap-2">
                      {rulesets
                        .filter((ruleset) => ruleset.tier === tier)
                        .map((ruleset) => (
                          <li key={ruleset.id}>
                            <Card className="flex flex-wrap items-center justify-between gap-3 p-3 hover:border-[var(--color-border-strong)]">
                              <span className="min-w-0">
                                <Link
                                  href={`/rulesets/${ruleset.id}`}
                                  className="font-medium hover:underline"
                                >
                                  {ruleset.name}
                                </Link>
                                {ruleset.id === defaultId ? (
                                  <span className="ml-2">
                                    <Badge tone="accent">default</Badge>
                                  </span>
                                ) : null}
                                <span className="block text-xs text-[var(--color-ink-muted)]">
                                  {ruleset.ruleCount} rule{ruleset.ruleCount === 1 ? "" : "s"}
                                  {ruleset.sourceDoc ? `, from ${ruleset.sourceDoc}` : ""}
                                </span>
                              </span>
                              <span className="text-xs text-[var(--color-ink-muted)]">
                                v{ruleset.version}
                              </span>
                            </Card>
                          </li>
                        ))}
                    </ul>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

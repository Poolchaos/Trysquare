"use client";

/**
 * Rulesets: the standards a review is judged against.
 *
 * Importing is a paste rather than a file picker, because the document usually
 * already lives in another repository and copying it here is one step fewer
 * than saving it out first. A ruleset can also start with no document, its
 * rules written on its own page (RA-6), or from a template the app ships
 * (RT-1), which is what the form opens on: a person with no protocol of
 * their own has nothing to paste.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
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

/** A template on the shelf, as the server lists it. */
interface Template {
  slug: string;
  name: string;
  purpose: string;
  version: number;
  ruleCount: number;
  /** The run that proved it on a model, or null while none has been made. */
  modelRun: { date: string; evidence: string } | null;
}

/** What a new ruleset starts from: a template, a pasted document, or nothing. */
const STARTS = [
  { value: "template", label: "A template" },
  { value: "document", label: "A document" },
  { value: "none", label: "No document" },
] as const;
type Start = (typeof STARTS)[number]["value"];

export default function RulesetsPage() {
  const router = useRouter();
  const [rulesets, setRulesets] = useState<Ruleset[] | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("global");
  const [start, setStart] = useState<Start>("template");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templatesError, setTemplatesError] = useState("");
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  const [templateSlug, setTemplateSlug] = useState("");
  const [creating, setCreating] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sent = await send<{ templates: Template[] }>(
        "/api/ruleset-templates",
        {},
        "The templates could not be read",
      );
      if (cancelled) return;
      if (sent.ok) setTemplates(sent.body.templates);
      else setTemplatesError(sent.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [templatesAttempt]);

  // The one picked, or the first while none is: the shelf is short, and the
  // first is the most general.
  const template = templates?.find((entry) => entry.slug === templateSlug) ?? templates?.[0];

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

  async function createEmpty() {
    if (creating) return;
    setCreating(true);
    setError("");
    setResult("");
    const sent = await send<{ rulesetId: string }>(
      "/api/rulesets",
      { method: "POST", body: JSON.stringify({ name, tier }) },
      "The ruleset could not be created",
    );
    if (!sent.ok) {
      setError(sent.error);
      setCreating(false);
      return;
    }
    // Opened, and `creating` left on until the page goes: what comes next is
    // writing its first rule, and a second press would ask for the name twice.
    router.push(`/rulesets/${sent.body.rulesetId}`);
  }

  async function startFromTemplate() {
    if (creating || template === undefined) return;
    setCreating(true);
    setError("");
    setResult("");
    const called = name.trim();
    const sent = await send<{ rulesetId: string }>(
      `/api/ruleset-templates/${encodeURIComponent(template.slug)}/use`,
      {
        method: "POST",
        body: JSON.stringify({ tier, ...(called === "" ? {} : { name: called }) }),
      },
      "The ruleset could not be started from the template",
    );
    if (!sent.ok) {
      setError(sent.error);
      setCreating(false);
      return;
    }
    // Opened, as one started with no document is: its rules are there to read.
    router.push(`/rulesets/${sent.body.rulesetId}`);
  }

  function submit() {
    if (start === "template") return startFromTemplate();
    return start === "document" ? importRuleset(false) : createEmpty();
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
              data-testid="new-ruleset"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="grid gap-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Name"
                  {...(start === "template" && template !== undefined
                    ? { hint: `Left empty, the ruleset is called ${template.name}.` }
                    : {})}
                >
                  <Input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setReplacing("");
                      // A name refused as taken is answered by changing it.
                      if (start !== "document") setError("");
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
              <fieldset>
                <legend className="text-sm font-medium">Start from</legend>
                <div className="flex flex-wrap gap-x-6">
                  {STARTS.map((option) => (
                    <label
                      key={option.value}
                      className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
                    >
                      {/* Drawn in the app's accent and for the theme in use: left
                          alone, the dot is the browser's blue beside a teal
                          button, and a white disc on the dark theme. */}
                      <input
                        type="radio"
                        name="start"
                        className="scheme-light-dark accent-[var(--color-accent)]"
                        checked={start === option.value}
                        onChange={() => {
                          setStart(option.value);
                          // What was said was about the other way of starting.
                          setError("");
                          setResult("");
                          setReplacing("");
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {start === "none" ? (
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    The ruleset starts with no rules. You write them on its page, and a review will
                    not start on it until it has one.
                  </p>
                ) : null}
              </fieldset>
              {start !== "template" ? null : templates === null ? (
                templatesError ? (
                  <div className="grid gap-2">
                    <Problem>{templatesError}</Problem>
                    <div>
                      <Button
                        type="button"
                        onClick={() => {
                          setTemplatesError("");
                          setTemplatesAttempt((attempt) => attempt + 1);
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-ink-muted)]">Reading the templates...</p>
                )
              ) : templates.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-muted)]">
                  This version of the app ships no template. Start from a document, or from none.
                </p>
              ) : (
                <fieldset>
                  <legend className="text-sm font-medium">Template</legend>
                  <div className="mt-1.5 grid gap-2">
                    {templates.map((entry) => (
                      // The whole block is the control, so a thumb has more
                      // than a 13px dot to find. The accent marks the one
                      // chosen and nothing else here.
                      <label
                        key={entry.slug}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 has-[:checked]:border-[var(--color-accent)]"
                      >
                        <input
                          type="radio"
                          name="template"
                          className="mt-1 scheme-light-dark accent-[var(--color-accent)]"
                          checked={template?.slug === entry.slug}
                          onChange={() => setTemplateSlug(entry.slug)}
                        />
                        <span className="grid min-w-0 flex-1 gap-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-sm font-medium">{entry.name}</span>
                            <span className="text-xs text-[var(--color-ink-muted)] tabular-nums">
                              {entry.ruleCount} rule{entry.ruleCount === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="text-sm text-[var(--color-ink-muted)]">
                            {entry.purpose}
                          </span>
                          {/* Said until a run against its fixture is on
                              record: a template that reads well may find
                              nothing. */}
                          <span className="text-xs text-[var(--color-ink-muted)]">
                            {entry.modelRun
                              ? `Run against a model on ${entry.modelRun.date}.`
                              : "Not yet run against a model."}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {start === "document" ? (
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
              ) : null}
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
                {start === "template" ? (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={creating || template === undefined}
                  >
                    {creating ? "Starting..." : "Use this template"}
                  </Button>
                ) : start === "document" ? (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={importing || name === "" || markdown === ""}
                  >
                    {importing ? "Importing..." : "Import"}
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" disabled={creating || name.trim() === ""}>
                    {creating ? "Creating..." : "Create ruleset"}
                  </Button>
                )}
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
                Start one from a template, paste a protocol document, or start with no document and
                write its rules on its page. Every review needs a ruleset.
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

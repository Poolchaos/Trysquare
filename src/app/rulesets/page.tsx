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
import { PageBody, PageHeader } from "@/components/page";
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

interface Ruleset {
  id: string;
  name: string;
  tier: string;
  version: number;
  sourceDoc: string | null;
}

export default function RulesetsPage() {
  const [rulesets, setRulesets] = useState<Ruleset[] | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("global");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/rulesets");
    const body = (await response.json()) as { rulesets: Ruleset[] };
    setRulesets(body.rulesets);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/rulesets");
      const body = (await response.json()) as { rulesets: Ruleset[] };
      if (!cancelled) setRulesets(body.rulesets);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function importRuleset(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResult("");
    const response = await fetch("/api/rulesets/import", {
      method: "POST",
      body: JSON.stringify({ name, tier, markdown }),
    });
    const body = (await response.json()) as {
      error?: string;
      rules?: number;
      directives?: number;
      version?: number;
      changed?: boolean;
    };
    if (!response.ok) {
      setError(body.error ?? "The document could not be imported.");
      return;
    }
    setResult(
      `Imported ${body.rules} rule(s) and ${body.directives} directive(s) as version ${body.version}` +
        (body.changed === false ? ", unchanged from what was already stored." : "."),
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
            <form onSubmit={importRuleset} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Tier">
                  <Select value={tier} onChange={(event) => setTier(event.target.value)}>
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
                  onChange={(event) => setMarkdown(event.target.value)}
                  placeholder="Paste the markdown protocol here"
                  className="font-[family-name:var(--font-mono)] text-xs"
                />
              </Field>
              {error ? <Problem>{error}</Problem> : null}
              {result ? (
                <p className="rounded-md border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[var(--color-good)]">
                  {result}
                </p>
              ) : null}
              <div>
                <Button type="submit" variant="primary" disabled={name === "" || markdown === ""}>
                  Import
                </Button>
              </div>
            </form>
          </Card>

          <div>
            {rulesets === null ? null : rulesets.length === 0 ? (
              <Empty title="No rulesets yet">
                Paste a protocol document to the left. Every review needs one.
              </Empty>
            ) : (
              <ul className="grid gap-2">
                {rulesets.map((ruleset) => (
                  <li key={ruleset.id}>
                    <Card className="flex items-center justify-between gap-3 p-3 hover:border-[var(--color-border-strong)]">
                      <Link
                        href={`/rulesets/${ruleset.id}`}
                        className="font-medium hover:underline"
                      >
                        {ruleset.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Badge>{ruleset.tier}</Badge>
                        <span className="text-xs text-[var(--color-ink-muted)]">
                          v{ruleset.version}
                        </span>
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

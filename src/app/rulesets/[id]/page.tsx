"use client";

/**
 * One ruleset: every rule it contains, what each says, and which apply.
 *
 * Switching a rule off or changing its severity moves the ruleset's version,
 * which the page says out loud, because a review's report names the version
 * it was judged against and two different rule sets must never share one.
 */

import { useRouter } from "next/navigation";
import { Fragment, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MarkdownText } from "@/components/markdown";
import { PageBody, PageHeader, PageLoading } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Input,
  Mono,
  Problem,
  Select,
  Textarea,
  severityTone,
} from "@/components/ui";
import { asSentence, send } from "@/components/request";
import type { DirectiveSection } from "@/lib/domain/enums";
import { inferTags } from "@/lib/rulesets/import";
import { parseRuleBlock, startingRuleBlock } from "@/lib/rulesets/rule-edit";
import { directiveSectionLabel } from "@/lib/rulesets/sections";

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
  directives: { section: DirectiveSection; title: string; contentMd: string }[];
  rules: {
    code: string;
    title: string;
    severity: string;
    tags: string[];
    /** The section of the document the rule sits under. */
    group: string;
    sweepPatterns: string[];
    enabled: boolean;
    text: string;
    raw: string;
  }[];
}

const SEVERITIES = ["CRITICAL", "WARNING", "NITPICK"];
const TIERS = ["global", "tech", "project"];

/**
 * A rule's text, written as the markdown it is, heading line and all: an
 * existing rule's (RA-2), or a new one's from its starting block (RA-3).
 *
 * One field and no form: the server reads the block with the importer's own
 * parser, so what the model is given stays the person's words (D-265). Save
 * is off while the text is what the field opened on, and a refusal is the
 * server's, beside the field, with the text kept as typed.
 */
function RuleEditor({
  field,
  label,
  opensOn,
  hint,
  saveLabel,
  place,
  onSave,
  onCancel,
}: {
  field: string;
  label: string;
  opensOn: string;
  hint: string;
  saveLabel: string;
  /** Where the text as it stands will go, for a rule that has no place yet. */
  place?: (markdown: string) => ReactNode;
  /** Sends the text, answering with the server's refusal, or "" once saved. */
  onSave: (markdown: string) => Promise<string>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(opensOn);
  const [refusal, setRefusal] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setRefusal("");
    setSaving(true);
    try {
      setRefusal(await onSave(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor={field}>
          {label}
        </label>
        <Textarea
          id={field}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            // It was about the text as sent, which this is no longer: left
            // up, it named a line since rewritten.
            setRefusal("");
          }}
          rows={Math.min(Math.max(value.split("\n").length + 1, 8), 30)}
          spellCheck={false}
          className="w-full font-[family-name:var(--font-mono)] text-xs"
        />
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      </div>
      {place ? place(value) : null}
      <div>
        <p className="mb-1 text-xs font-medium text-[var(--color-ink-muted)]">As it will read</p>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          {/* Less the heading line, which the row above carries, and only
              that: a line typed before the heading was left out of what
              "will read" while the refusal under it named that line. */}
          <MarkdownText
            text={(/^#{1,6}\s/.test(value) ? value.slice(value.indexOf("\n") + 1) : value).trim()}
          />
        </div>
      </div>
      {refusal ? <Problem>{refusal}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={saving || value === opensOn}
          onClick={() => void save()}
        >
          {saving ? "Saving..." : saveLabel}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A new rule, written from a starting block in the protocol's shape (RA-3).
 *
 * It goes after the last rule of a section of the ruleset's document, the
 * last section unless another is picked: a rule takes its tags from the
 * section it sits under and from its title, so where it goes is said, with
 * the tags the text as it stands would get, before anything is saved.
 */
function NewRule({
  rulesetId,
  version,
  rules,
  reload,
  onAdded,
  onCancel,
}: {
  rulesetId: string;
  version: number;
  rules: Detail["rules"];
  /** Reads the ruleset again, answering with its version, or null when it could not be read. */
  reload: () => Promise<number | null>;
  onAdded: (code: string, section: string, sweeps: Moved[]) => Promise<void>;
  onCancel: () => void;
}) {
  // Each section once, in the document's order, with the rule it ends on.
  const sections = [...new Map(rules.map((rule) => [rule.group, rule.code]))];
  // The one picked while it still has a rule to follow, else the last: a
  // section whose last rule was removed meanwhile stayed named here, with
  // its tags, while the rule went after the ruleset's last rule.
  const [picked, setSection] = useState<string | null>(null);
  const section = sections.some(([name]) => name === picked)
    ? (picked ?? "")
    : (sections.at(-1)?.[0] ?? "");
  const after = sections.find(([name]) => name === section)?.[1];

  return (
    <RuleEditor
      field="new-rule-markdown"
      label="New rule as markdown"
      opensOn={startingRuleBlock(rules.map((rule) => rule.code))}
      hint="The heading line carries the rule's code and title. Replace each line of the starting text, or take that part out."
      saveLabel="Add rule"
      onCancel={onCancel}
      place={(markdown) => {
        const read = parseRuleBlock(markdown);
        return (
          <div>
            {sections.length > 1 ? (
              <>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="new-rule-section">
                  Section
                </label>
                <Select
                  id="new-rule-section"
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                  className="sm:w-auto"
                >
                  {sections.map(([name]) => (
                    <option key={name} value={name}>
                      {name === "" ? "Before the first section" : name}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {sections.length > 1
                ? "The rule goes after the last rule of this section of the ruleset's document."
                : sections.length === 1
                  ? "The rule goes after the last rule of the ruleset's document."
                  : "The rule goes to the end of the ruleset's document."}
              {/* With no rule yet, the section is the server's to read from
                  the document, so no tags are promised here. */}
              {"refusal" in read || sections.length === 0
                ? ""
                : ` Tagged ${inferTags(section, read.rule.title).join(", ")}, from the section's name and the rule's title.`}
            </p>
          </div>
        );
      }}
      onSave={async (markdown) => {
        const sent = await send<{ code: string; sweeps: Moved[] }>(
          `/api/rulesets/${rulesetId}/rules`,
          {
            method: "POST",
            body: JSON.stringify({ markdown, version, ...(after === undefined ? {} : { after }) }),
          },
          "The rule could not be added",
        );
        if (!sent.ok) {
          // Behind the ruleset: read again with the text kept, as a save is.
          if (sent.body.code !== "RulesetChangedError") return sent.error;
          const stands = await reload();
          return stands === null
            ? sent.error
            : `Not added yet. The ruleset was changed since this page read it. The page now shows it as it stands, at version ${stands}, and your text is kept: press Add rule again.`;
        }
        await onAdded(sent.body.code, section, sent.body.sweeps);
        return "";
      }}
    />
  );
}

/** A rule whose sweep patterns a change moved, as the server answers: those it has now, and how many it had. */
interface Moved {
  code: string;
  patterns: string[];
  had: number;
}

/**
 * Said with a change that moved sweep patterns (RA-5b): a table row in one
 * rule's text can give another rule a pattern, or take it away with the row.
 */
function sweepsMovedText(moved: Moved[]): string {
  const count = (patterns: number) => (patterns === 0 ? "none" : String(patterns));
  const rules = moved.map(({ code, patterns, had }) =>
    patterns.length === had
      ? `rule ${code} still has ${had}, not the same ${had === 1 ? "one" : "ones"}`
      : `rule ${code} now has ${count(patterns.length)} (it had ${count(had)})`,
  );
  return `That also changed sweep patterns, which are read from table rows anywhere in the ruleset's document: ${rules.join(", ")}.`;
}

const takeFocus = (node: HTMLElement | null) => {
  node?.focus();
};

/**
 * Said where the rule was, since its row is gone (RA-4). It takes the focus
 * as it is drawn: the button that had it went with the rule, and the next
 * Tab would otherwise start from the top of the page.
 */
function RemovedNote({ code, moved }: { code: string; moved: Moved[] }) {
  return (
    <p
      role="status"
      tabIndex={-1}
      ref={takeFocus}
      className="rounded-md border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[var(--color-good)]"
    >
      Rule {code} removed. Reviews already run keep it.
      {moved.length > 0 ? ` ${sweepsMovedText(moved)}` : ""}
    </p>
  );
}

/**
 * The day a stored time fell on where the reader is. The stored text is UTC,
 * and cut to its first ten characters it named the day before or after for a
 * reader away from UTC.
 */
function dayOf(stored: string): string {
  return new Date(stored).toLocaleDateString(undefined, { dateStyle: "medium" });
}

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
  const [openRule, setOpenRule] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateTier, setDuplicateTier] = useState("global");
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicated, setDuplicated] = useState("");
  const [editingRule, setEditingRule] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ code: string; section: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState("");
  const [removeRefusal, setRemoveRefusal] = useState<{ code: string; text: string } | null>(null);
  // The rule last removed here, and the rule that came after it.
  const [removed, setRemoved] = useState<{
    code: string;
    before: string | null;
    moved: Moved[];
  } | null>(null);
  // Said in the opened rule a save or an add left it in, until the next change.
  const [sweepsNote, setSweepsNote] = useState<{ at: string; moved: Moved[] } | null>(null);
  // Remove rule is not drawn while its question is, so when the question is
  // put away with the rule still there it takes the focus back.
  const backToRemove = useRef(false);
  const focusBack = useCallback((node: HTMLButtonElement | null) => {
    if (node === null || !backToRemove.current) return;
    backToRemove.current = false;
    node.focus();
  }, []);
  const router = useRouter();

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
    return sent.ok ? sent.body : null;
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
    setRemoved(null);
    setSweepsNote(null);
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

  /**
   * One rule, asked once (RA-4). A refusal because this page was behind the
   * ruleset is answered by reading the ruleset again, so the next press is
   * made of it as it stands.
   */
  async function removeRule(code: string, version: number, before: string | null) {
    setRemoveRefusal(null);
    setError("");
    setBusy("remove");
    try {
      const sent = await send<{ sweeps: Moved[] }>(
        `/api/rulesets/${id}/rules/${encodeURIComponent(code)}?version=${version}`,
        { method: "DELETE" },
        "The rule could not be removed",
      );
      if (sent.ok) {
        await load();
        setConfirmingRemove("");
        setOpenRule("");
        setAdded(null);
        setSweepsNote(null);
        setRemoved({ code, before, moved: sent.body.sweeps });
        return;
      }
      const behind =
        sent.body.code === "RulesetChangedError" || sent.body.code === "RuleNotFoundError";
      const read = behind
        ? await send<Detail>(`/api/rulesets/${id}`, {}, "This ruleset could not be read again")
        : null;
      if (!read?.ok) {
        backToRemove.current = true;
        setConfirmingRemove("");
        setRemoveRefusal({
          code,
          text: read ? `${asSentence(sent.error)} ${read.error}` : sent.error,
        });
        return;
      }
      setDetail(read.body);
      setConfirmingRemove("");
      const stands = `the page now shows it as it stands, at version ${read.body.ruleset.version}`;
      if (read.body.rules.some((rule) => rule.code === code)) {
        backToRemove.current = true;
        setRemoveRefusal({
          code,
          text: `Rule ${code} was not removed. The ruleset changed since this page read it, and ${stands}. Remove the rule again if it should still go.`,
        });
      } else {
        setOpenRule("");
        setError(
          `Rule ${code} was already gone. The ruleset changed since this page read it, and ${stands}.`,
        );
      }
    } finally {
      setBusy("");
    }
  }

  /** One ruleset, asked once (RA-1). Its page is gone after, so the list it is. */
  async function remove() {
    setDeleteError("");
    setBusy("delete");
    try {
      const sent = await send(
        `/api/rulesets/${id}`,
        { method: "DELETE" },
        "The ruleset could not be deleted",
      );
      if (sent.ok) {
        router.push("/rulesets");
        return;
      }
      setDeleteError(sent.error);
      setConfirmingDelete(false);
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
  // With no rule and no directive there is nothing an export could hold: the
  // server refuses one, and the control says so and stays off (RA-6).
  const noDocument = detail.rules.length === 0 && detail.directives.length === 0;
  // Before the rule that came after it, or at the end when that was the
  // last rule or is no longer here.
  const removedBefore =
    removed === null
      ? undefined
      : detail.rules.some((rule) => rule.code === removed.before)
        ? removed.before
        : null;
  const removedRow =
    removed === null ? null : (
      <tr
        key={`removed-${removed.code}`}
        role="row"
        className="block border-b border-[var(--color-border)] last:border-0 sm:table-row"
      >
        <td role="cell" colSpan={5} className="block px-3 py-2 sm:table-cell">
          <RemovedNote code={removed.code} moved={removed.moved} />
        </td>
      </tr>
    );

  return (
    <>
      <PageHeader
        title={detail.ruleset.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <Badge>{detail.ruleset.tier}</Badge>
            <span>version {detail.ruleset.version}</span>
            <span>
              {`${detail.rules.length} ${detail.rules.length === 1 ? "rule" : "rules"}`}
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
            {noDocument ? (
              <Button disabled aria-describedby="no-document">
                Export document
              </Button>
            ) : (
              <a href={`/api/rulesets/${id}/export`} download>
                <Button>Export document</Button>
              </a>
            )}
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
          document holds every rule&apos;s text, switched off or not: a severity changed with the
          picker here is not written into it.
        </p>
        <p className="mb-4 text-xs text-[var(--color-ink-faint)]">
          {detail.ruleset.sourceDoc ? `Imported from ${detail.ruleset.sourceDoc}. ` : ""}
          Created {dayOf(detail.ruleset.createdAt)}, last changed {dayOf(detail.ruleset.updatedAt)}.
        </p>

        <div data-testid="rules">
          {detail.rules.length === 0 ? (
            <Card className="grid gap-3 p-4">
              {removed ? (
                <RemovedNote key={removed.code} code={removed.code} moved={removed.moved} />
              ) : null}
              <p className="text-sm text-[var(--color-ink-muted)]">
                This ruleset has no rules, so a review will not start on it. Add a rule below.
                {noDocument ? (
                  <>
                    {" "}
                    <span id="no-document">
                      It has no document to export until a rule is written into it.
                    </span>
                  </>
                ) : null}
              </p>
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              {/* Below sm a rule is a stack, not a row: five columns do not fit a
              phone, and the last three sat past the card's edge. The header
              row goes, and Tags and Sweeps say their own names. The roles are
              written out because a table drawn as blocks loses them. */}
              <table role="table" className="block w-full text-sm sm:table">
                <thead role="rowgroup" className="hidden sm:table-header-group">
                  <tr
                    role="row"
                    className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]"
                  >
                    <th role="columnheader" className="px-3 py-2 font-medium">
                      Rule
                    </th>
                    <th role="columnheader" className="px-3 py-2 font-medium">
                      Severity
                    </th>
                    <th role="columnheader" className="px-3 py-2 font-medium">
                      Tags
                    </th>
                    <th role="columnheader" className="px-3 py-2 font-medium">
                      Sweeps
                    </th>
                    <th role="columnheader" className="px-3 py-2 text-right font-medium">
                      Applies
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block sm:table-row-group">
                  {detail.rules.map((rule, index) => (
                    <Fragment key={rule.code}>
                      {removedBefore === rule.code ? removedRow : null}
                      <tr
                        role="row"
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-2 last:border-0 sm:table-row sm:p-0"
                      >
                        <td role="cell" className="sm:px-3 sm:py-2">
                          <Mono className="text-xs text-[var(--color-ink-muted)]">{rule.code}</Mono>
                          {/* A rule switched off is set back by its title's
                              colour and its badge's, never by the row's
                              opacity: at 55% its tags, its badge and "off"
                              fell under AA contrast in both themes. */}
                          <button
                            type="button"
                            className={`ml-2 text-left underline-offset-2 hover:underline ${
                              rule.enabled ? "" : "text-[var(--color-ink-muted)]"
                            }`}
                            aria-expanded={openRule === rule.code}
                            onClick={() => {
                              // Each was about the rule as it was opened.
                              setConfirmingRemove("");
                              setRemoveRefusal(null);
                              backToRemove.current = false;
                              setOpenRule((open) => (open === rule.code ? "" : rule.code));
                            }}
                          >
                            {rule.title}
                          </button>
                        </td>
                        <td role="cell" className="col-span-2 sm:px-3 sm:py-2">
                          <label className="inline-flex items-center gap-2">
                            <span className="sr-only">Severity of rule {rule.code}</span>
                            <Badge tone={rule.enabled ? severityTone(rule.severity) : "neutral"}>
                              {rule.severity}
                            </Badge>
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
                        <td
                          role="cell"
                          className="col-span-2 text-xs text-[var(--color-ink-muted)] sm:px-3 sm:py-2"
                        >
                          <span className="sm:hidden">Tags: </span>
                          {rule.tags.join(", ") || "any"}
                        </td>
                        <td
                          role="cell"
                          className="col-span-2 text-xs text-[var(--color-ink-muted)] sm:px-3 sm:py-2 sm:text-sm"
                        >
                          <span className="sm:hidden">Sweeps: </span>
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
                        <td
                          role="cell"
                          className="col-start-2 row-start-1 text-right sm:px-3 sm:py-2"
                        >
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
                      {openRule === rule.code ? (
                        <tr
                          role="row"
                          className="block border-b border-[var(--color-border)] last:border-0 sm:table-row"
                        >
                          <td role="cell" colSpan={5} className="block px-3 pb-3 sm:table-cell">
                            {/* No wider than the screen, and pinned to the card's
                          visible edge should the card ever scroll sideways.
                          Shown whole, with no scroll box of its own: one a
                          keyboard cannot reach is an axe failure
                          (scrollable-region-focusable). */}
                            <div
                              data-testid="rule-text"
                              className="sticky left-3 max-w-[min(48rem,calc(100vw-5.5rem))] rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3"
                            >
                              {editingRule === rule.code ? (
                                <RuleEditor
                                  field={`rule-markdown-${rule.code}`}
                                  label={`Rule ${rule.code} as markdown`}
                                  opensOn={rule.raw}
                                  hint="The heading line carries the rule's code and title. Reviews already run keep the text they ran with."
                                  saveLabel="Save rule"
                                  onCancel={() => setEditingRule("")}
                                  onSave={async (markdown) => {
                                    const sent = await send<{ code: string; sweeps: Moved[] }>(
                                      `/api/rulesets/${id}/rules/${encodeURIComponent(rule.code)}`,
                                      {
                                        method: "PUT",
                                        body: JSON.stringify({
                                          markdown,
                                          version: detail.ruleset.version,
                                        }),
                                      },
                                      "The rule could not be saved",
                                    );
                                    if (!sent.ok) {
                                      // Behind the ruleset: read again with
                                      // the text kept, so the next press is
                                      // made of the ruleset as it stands. A
                                      // reload was the only way, and lost
                                      // what was typed.
                                      if (sent.body.code !== "RulesetChangedError") {
                                        return sent.error;
                                      }
                                      const fresh = await load();
                                      if (fresh === null) return sent.error;
                                      const stands = `The page now shows the ruleset as it stands, at version ${fresh.ruleset.version}, and your text is kept`;
                                      const now = fresh.rules.find(
                                        (entry) => entry.code === rule.code,
                                      );
                                      return now !== undefined && now.raw !== rule.raw
                                        ? `Not saved yet. Rule ${rule.code}'s text was changed since this page read it. ${stands}: press Save rule again to put it in place of that change, or Cancel to see the rule as it now reads.`
                                        : `Not saved yet. The ruleset was changed since this page read it, though not rule ${rule.code}'s text. ${stands}: press Save rule again.`;
                                    }
                                    setEditingRule("");
                                    setRemoved(null);
                                    setSweepsNote(
                                      sent.body.sweeps.length > 0
                                        ? { at: sent.body.code, moved: sent.body.sweeps }
                                        : null,
                                    );
                                    setOpenRule(sent.body.code);
                                    await load();
                                    return "";
                                  }}
                                />
                              ) : (
                                <>
                                  {sweepsNote?.at === rule.code ? (
                                    <p
                                      role="status"
                                      className="mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                                    >
                                      {sweepsMovedText(sweepsNote.moved)}
                                    </p>
                                  ) : null}
                                  {rule.text === "" ? (
                                    <p className="text-sm text-[var(--color-ink-muted)]">
                                      This rule has no text under its heading. Edit text to write
                                      what it asks.
                                    </p>
                                  ) : (
                                    <MarkdownText text={rule.text} />
                                  )}
                                  {confirmingRemove === rule.code ? (
                                    <div className="mt-3 grid gap-3">
                                      {/* What a removal is, against the switch in
                                      the row above that keeps the text. */}
                                      <p className="text-sm">
                                        {`Removing rule ${rule.code} takes its text out of this ruleset and out of the document it exports. Reviews already run keep it. To keep the text and leave the rule out of new reviews, switch it off instead.`}
                                      </p>
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          variant="primary"
                                          disabled={busy !== ""}
                                          onClick={() =>
                                            void removeRule(
                                              rule.code,
                                              detail.ruleset.version,
                                              detail.rules[index + 1]?.code ?? null,
                                            )
                                          }
                                        >
                                          {busy === "remove"
                                            ? "Removing..."
                                            : `Yes, remove rule ${rule.code}`}
                                        </Button>
                                        {/* The focus lands on the answer that
                                        changes nothing. */}
                                        <Button
                                          variant="quiet"
                                          autoFocus
                                          disabled={busy !== ""}
                                          onClick={() => {
                                            backToRemove.current = true;
                                            setConfirmingRemove("");
                                          }}
                                        >
                                          Keep it
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      {removeRefusal?.code === rule.code ? (
                                        <div className="mt-3">
                                          <Problem>{removeRefusal.text}</Problem>
                                        </div>
                                      ) : null}
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <Button onClick={() => setEditingRule(rule.code)}>
                                          Edit text
                                        </Button>
                                        <Button
                                          ref={focusBack}
                                          onClick={() => {
                                            setRemoveRefusal(null);
                                            setConfirmingRemove(rule.code);
                                          }}
                                        >
                                          Remove rule
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {removedBefore === null ? removedRow : null}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        {adding ? (
          <div className="mt-3" data-testid="new-rule">
            <Card className="p-4">
              <NewRule
                rulesetId={id}
                version={detail.ruleset.version}
                rules={detail.rules}
                reload={async () => (await load())?.ruleset.version ?? null}
                onCancel={() => setAdding(false)}
                onAdded={async (code, section, sweeps) => {
                  setAdding(false);
                  setAdded({ code, section });
                  setSweepsNote(sweeps.length > 0 ? { at: code, moved: sweeps } : null);
                  setOpenRule(code);
                  await load();
                }}
              />
            </Card>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="new-rule">
            <Button
              onClick={() => {
                setAdded(null);
                setRemoved(null);
                setSweepsNote(null);
                setAdding(true);
              }}
            >
              Add a rule
            </Button>
            {/* Where it went, since its row may be a screen above. */}
            {added ? (
              <p
                role="status"
                className="rounded-md border border-[var(--color-good)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[var(--color-good)]"
              >
                Rule {added.code} added{added.section === "" ? "" : ` to ${added.section}`}, and
                opened above.
              </p>
            ) : null}
          </div>
        )}

        {detail.directives.length === 0 ? (
          // A ruleset started in the app has none (RA-6), and a control to
          // show nothing said nothing of what a review is then given.
          <p className="mt-6 max-w-2xl text-sm text-[var(--color-ink-muted)]">
            No process directives: the parts of a protocol that are not rules come with an imported
            document or a template and are not written here. A review on this ruleset is given its
            rules and the app&apos;s own instructions.
          </p>
        ) : (
          <button
            type="button"
            className="mt-6 text-sm text-[var(--color-accent)] hover:underline"
            onClick={() => setShowDirectives((shown) => !shown)}
          >
            {showDirectives ? "Hide" : "Show"} the {detail.directives.length} process directive
            {detail.directives.length === 1 ? "" : "s"}
          </button>
        )}
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
                    {directiveSectionLabel(directive.section)}: {directive.title}
                  </button>
                  {openDirective === key ? (
                    // Verbatim, because this is what the model is given. Whole,
                    // with no scroll of its own: a box a keyboard cannot
                    // reach is an axe failure, as it was for a rule's text.
                    <pre className="mt-1 mb-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs whitespace-pre-wrap wrap-anywhere">
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

        <Card className="mt-6 p-4">
          <h2 className="mb-1 text-heading font-semibold">Delete ruleset</h2>
          <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
            Removes this ruleset&apos;s rules and directives. A review already run keeps the rules
            it ran with.
            {detail.ruleset.isDefault
              ? " It is the default for new reviews, which will then tick the first ruleset listed instead."
              : ""}
          </p>
          {/* Said here, beside the control that was refused: the page's own
              error is a screen above. */}
          {deleteError ? (
            <div className="mb-3">
              <Problem>{deleteError}</Problem>
            </div>
          ) : null}
          {confirmingDelete ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy !== ""} onClick={() => void remove()}>
                {busy === "delete" ? "Deleting..." : `Yes, delete ${detail.ruleset.name}`}
              </Button>
              <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button onClick={() => setConfirmingDelete(true)}>Delete</Button>
          )}
        </Card>
      </PageBody>
    </>
  );
}

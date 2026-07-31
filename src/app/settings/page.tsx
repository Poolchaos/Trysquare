"use client";

/** The models this account can actually use, and how fresh that answer is. */

import { useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Card, Empty, Mono } from "@/components/ui";

interface Model {
  id: string;
  displayName: string;
  availability: string;
  contextWindow: number | null;
  lastProbedAt: string | null;
  lastError: string | null;
  recommended: boolean;
}

export default function SettingsPage() {
  const [models, setModels] = useState<Model[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const body = (await (await fetch("/api/models")).json()) as { models: Model[] };
      if (!cancelled) setModels(body.models);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Reviews run through the Claude Code CLI using your existing subscription. This app stores no API key."
      />
      <PageBody>
        <h2 className="mb-3 text-sm font-semibold">Models</h2>
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
                    <span className="text-sm font-medium">{model.displayName}</span>
                    <Mono className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
                      {model.id}
                    </Mono>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
                    {model.contextWindow ? (
                      <span>{model.contextWindow.toLocaleString("en-US")} tokens</span>
                    ) : null}
                    <Badge tone={model.availability === "available" ? "good" : "neutral"}>
                      {model.availability}
                    </Badge>
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

"use client";

/**
 * Projects: what this app has cloned, and how to add another.
 *
 * A clone runs in the background, so the list polls while any project is still
 * cloning and stops when none is. A failed clone shows git's own message,
 * because "clone failed" tells nobody whether it was the address, the network
 * or their SSH key.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loading, PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Empty, Field, Input, Mono, Problem } from "@/components/ui";
import { send } from "@/components/request";
import { StoredCredentialsNotice } from "@/components/stored-credentials-notice";

interface Project {
  id: string;
  name: string;
  gitUrl: string;
  defaultBranch: string;
  cloneStatus: string;
  cloneError: string | null;
  lastFetchedAt: string | null;
  reviewCount: number;
  dependencies: { id: string; name: string; packageName: string }[];
  cleanAddress?: string | null;
}

/**
 * How long ago, in the coarsest useful unit.
 *
 * A fetch is stale in a way that matters by the day, so minutes are only
 * spelled out while they are the whole story.
 */
function fetchedInWords(at: string | null): string {
  if (at === null) return "never fetched";
  const minutes = Math.floor((Date.now() - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "never fetched";
  if (minutes < 1) return "fetched just now";
  if (minutes < 60) return `fetched ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fetched ${hours} h ago`;
  return `fetched ${Math.floor(hours / 24)} d ago`;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [fetching, setFetching] = useState("");
  const [error, setError] = useState("");
  /** The project an address already is, when adding it again was refused. */
  const [duplicateOf, setDuplicateOf] = useState("");

  // Why the list could not be read, said where it would be (5.13, U9): a
  // failed read used to leave "Loading..." there for good.
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const load = useCallback(async () => {
    const sent = await send<{ projects: Project[] }>(
      "/api/projects",
      {},
      "The projects could not be read",
    );
    if (!sent.ok) {
      setLoadError(sent.error);
      return null;
    }
    setLoadError("");
    setProjects(sent.body.projects);
    return sent.body.projects;
  }, []);

  // Guarded against unmount rather than fired and forgotten: navigating away
  // during the first fetch would otherwise set state on a gone component.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sent = await send<{ projects: Project[] }>(
        "/api/projects",
        {},
        "The projects could not be read",
      );
      if (cancelled) return;
      if (sent.ok) setProjects(sent.body.projects);
      else setLoadError(sent.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // Polls only while something is actually cloning, so an idle screen is idle.
  // Both unfinished states, not just pending. Polling on pending alone worked
  // only while nothing ever wrote "cloning", and would have left a clone in
  // progress frozen on screen the moment that changed.
  const cloning =
    projects?.some(
      (project) => project.cloneStatus === "pending" || project.cloneStatus === "cloning",
    ) ?? false;
  useEffect(() => {
    if (!cloning) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [cloning, load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setDuplicateOf("");
    setAdding(true);
    try {
      const sent = await send(
        "/api/projects",
        { method: "POST", body: JSON.stringify({ gitUrl }) },
        "The project could not be added",
      );
      if (!sent.ok) {
        setError(sent.error);
        // The address is already a project: the way to it, not a dead end
        // (5.7, audit A2).
        setDuplicateOf(typeof sent.body.projectId === "string" ? sent.body.projectId : "");
        return;
      }
      setGitUrl("");
      await load();
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <PageHeader title="Projects" subtitle="Cloned read-only. Nothing here is ever written to." />
      <PageBody>
        <Card className="mb-6 p-4">
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Field
                label="Add a project"
                hint="Uses your machine's git credentials, never a password or token in the address."
              >
                <Input
                  value={gitUrl}
                  onChange={(event) => setGitUrl(event.target.value)}
                  placeholder="git@github.com:you/your-app.git"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={adding || gitUrl.trim() === ""}>
              {adding ? "Cloning..." : "Add project"}
            </Button>
          </form>
          {error ? (
            <div className="mt-3">
              <Problem>
                {error}{" "}
                {duplicateOf ? (
                  <Link href={`/projects/${duplicateOf}`} className="underline">
                    Open it
                  </Link>
                ) : null}
              </Problem>
            </div>
          ) : null}
        </Card>

        {projects !== null && loadError ? (
          <div className="mb-4">
            <Problem>{loadError}</Problem>
          </div>
        ) : null}
        {projects === null ? (
          <Loading
            {...(loadError === "" ? {} : { error: loadError })}
            onRetry={() => {
              setLoadError("");
              setLoadAttempt((attempt) => attempt + 1);
            }}
          />
        ) : projects.length === 0 ? (
          <Empty title="No projects yet">
            Add a repository above. Trysquare clones it read-only, then you pick two branches and
            the rules to review them against.
          </Empty>
        ) : (
          // One column no wider than the page: an auto column grew to the
          // address, which truncates only inside a bounded one, and the row
          // ran off a phone.
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {/* A failed clone opens too: its page says why and
                            can try again (5.7, audit U6). */}
                        {project.cloneStatus === "ready" || project.cloneStatus === "failed" ? (
                          <Link
                            href={`/projects/${project.id}`}
                            className="font-medium hover:underline"
                          >
                            {project.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{project.name}</span>
                        )}
                        {project.cloneStatus === "pending" ? (
                          <Badge tone="accent">queued</Badge>
                        ) : project.cloneStatus === "cloning" ? (
                          <Badge tone="accent">cloning</Badge>
                        ) : project.cloneStatus === "failed" ? (
                          <Badge tone="critical">clone failed</Badge>
                        ) : (
                          <Badge tone="neutral">{project.defaultBranch}</Badge>
                        )}
                      </div>
                      <Mono className="mt-1 block truncate text-xs text-[var(--color-ink-muted)]">
                        {project.gitUrl}
                      </Mono>
                    </div>
                    {project.cloneStatus === "ready" ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Button
                          disabled={fetching !== ""}
                          onClick={async () => {
                            setError("");
                            setFetching(project.id);
                            try {
                              const response = await fetch(`/api/projects/${project.id}/fetch`, {
                                method: "POST",
                              });
                              if (!response.ok) {
                                const body = (await response.json()) as { error?: string };
                                setError(body.error ?? "The fetch did not work.");
                                return;
                              }
                              await load();
                            } finally {
                              setFetching("");
                            }
                          }}
                        >
                          {fetching === project.id ? "Fetching..." : "Fetch now"}
                        </Button>
                        <Link href={`/reviews/new?projectId=${project.id}`}>
                          <Button variant="secondary">Review a branch</Button>
                        </Link>
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span>{fetchedInWords(project.lastFetchedAt)}</span>
                    <span>
                      {project.reviewCount} review{project.reviewCount === 1 ? "" : "s"}
                    </span>
                    {project.dependencies.map((dependency) => (
                      // The link is what makes a two-repository review
                      // possible, so the list says which projects have one.
                      <Badge key={dependency.id} tone="neutral">
                        {dependency.packageName}
                      </Badge>
                    ))}
                  </div>
                  <StoredCredentialsNotice cleanAddress={project.cleanAddress} className="mt-3" />
                  {project.cloneError ? (
                    // Focusable and named: it scrolls sideways, and a box
                    // that scrolls must be reachable by keyboard.
                    <pre
                      tabIndex={0}
                      role="group"
                      aria-label={`Why ${project.name} could not be cloned`}
                      className="mt-3 overflow-x-auto rounded border border-[var(--color-critical)] bg-[var(--color-critical-soft)] p-3 text-xs text-[var(--color-critical)]"
                    >
                      {project.cloneError}
                    </pre>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

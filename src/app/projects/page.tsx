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
import { PageBody, PageHeader } from "@/components/page";
import { Badge, Button, Card, Empty, Field, Input, Mono, Problem } from "@/components/ui";

interface Project {
  id: string;
  name: string;
  gitUrl: string;
  defaultBranch: string;
  cloneStatus: string;
  cloneError: string | null;
  lastFetchedAt: string | null;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/projects");
    const body = (await response.json()) as { projects: Project[] };
    setProjects(body.projects);
    return body.projects;
  }, []);

  // Guarded against unmount rather than fired and forgotten: navigating away
  // during the first fetch would otherwise set state on a gone component.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/projects");
      const body = (await response.json()) as { projects: Project[] };
      if (!cancelled) setProjects(body.projects);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Polls only while something is actually cloning, so an idle screen is idle.
  const cloning = projects?.some((project) => project.cloneStatus === "pending") ?? false;
  useEffect(() => {
    if (!cloning) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [cloning, load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setAdding(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({ gitUrl }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The project could not be added.");
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
                hint="Uses your machine's git credentials. This app stores no secrets."
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
          {error ? <div className="mt-3">{error ? <Problem>{error}</Problem> : null}</div> : null}
        </Card>

        {projects === null ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Loading...</p>
        ) : projects.length === 0 ? (
          <Empty title="No projects yet">
            Add a repository above. Trysquare clones it read-only, then you pick two branches and
            the rules to review them against.
          </Empty>
        ) : (
          <ul className="grid gap-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{project.name}</span>
                        {project.cloneStatus === "pending" ? (
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
                      <Link href={`/reviews/new?projectId=${project.id}`}>
                        <Button variant="secondary">Review a branch</Button>
                      </Link>
                    ) : null}
                  </div>
                  {project.cloneError ? (
                    <pre className="mt-3 overflow-x-auto rounded border border-[var(--color-critical)] bg-[var(--color-critical-soft)] p-3 text-xs text-[var(--color-critical)]">
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

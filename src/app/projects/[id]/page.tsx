"use client";

/**
 * One project: its branches, its dependency links, and its reviews.
 *
 * The branch table is the point of the page. Everything a person needs to
 * decide which branch is worth reviewing is in the row: how far it has moved
 * from the default branch, what the last commit said, and when. Reviewing one
 * is a link from that row rather than a separate screen you arrive at empty.
 */

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/page";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Mono,
  Problem,
  Select,
  statusTone,
} from "@/components/ui";

interface Detail {
  project: {
    id: string;
    name: string;
    gitUrl: string;
    defaultBranch: string;
    cloneStatus: string;
    cloneError: string | null;
    lastFetchedAt: string | null;
  };
  links: { id: string; dependencyName: string; packageName: string }[];
  linkable: { id: string; name: string }[];
  reviews: {
    id: string;
    fromBranch: string;
    intoBranch: string;
    status: string;
    createdAt: string;
  }[];
}

interface Branches {
  branches: {
    name: string;
    subject: string;
    committedAt: string;
    ahead: number;
    behind: number;
  }[];
  defaultBranch: string;
  stale: string | null;
  lastFetchedAt: string | null;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [branches, setBranches] = useState<Branches | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [dependencyId, setDependencyId] = useState("");
  const [packageName, setPackageName] = useState("");

  const load = useCallback(async () => {
    const [detailResponse, branchResponse] = await Promise.all([
      fetch(`/api/projects/${id}`),
      fetch(`/api/projects/${id}/branches`),
    ]);
    if (detailResponse.ok) setDetail((await detailResponse.json()) as Detail);
    if (branchResponse.ok) setBranches((await branchResponse.json()) as Branches);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [detailResponse, branchResponse] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch(`/api/projects/${id}/branches`),
      ]);
      if (cancelled) return;
      if (detailResponse.ok) setDetail((await detailResponse.json()) as Detail);
      if (branchResponse.ok) setBranches((await branchResponse.json()) as Branches);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function call(path: string, init: RequestInit, onDone?: () => void) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "That did not work.");
        return false;
      }
      onDone?.();
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <PageBody>Loading...</PageBody>;

  const { project } = detail;
  const shown = (branches?.branches ?? []).filter((branch) => branch.name.includes(filter));

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <Mono className="text-xs">{project.gitUrl}</Mono>
            <span>default {project.defaultBranch}</span>
            <span>
              {project.lastFetchedAt
                ? `fetched ${project.lastFetchedAt.slice(0, 16).replace("T", " ")}`
                : "never fetched"}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              disabled={busy}
              onClick={() => void call(`/api/projects/${id}/fetch`, { method: "POST" })}
            >
              Fetch now
            </Button>
            <Link href={`/reviews/new?projectId=${id}`}>
              <Button variant="primary">New review</Button>
            </Link>
          </>
        }
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}
        {project.cloneError ? (
          <pre className="mb-4 overflow-x-auto rounded border border-[var(--color-critical)] bg-[var(--color-critical-soft)] p-3 text-xs text-[var(--color-critical)]">
            {project.cloneError}
          </pre>
        ) : null}
        {branches?.stale ? (
          <div className="mb-4">
            <Problem>These branches are from the last successful fetch: {branches.stale}</Problem>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Branches</h2>
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter"
                className="max-w-56"
              />
            </div>

            {branches === null ? (
              <p className="text-sm text-[var(--color-ink-muted)]">Fetching the latest refs...</p>
            ) : shown.length === 0 ? (
              <Empty title="No branch matches that filter" />
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Ahead</th>
                      <th className="px-3 py-2 font-medium">Behind</th>
                      <th className="px-3 py-2 font-medium">Last commit</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((branch) => (
                      <tr
                        key={branch.name}
                        className="border-b border-[var(--color-border)] last:border-0"
                      >
                        <td className="px-3 py-2">
                          <Mono className="text-xs">{branch.name}</Mono>
                          {branch.name === branches.defaultBranch ? (
                            <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                              default
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-ink-muted)]">{branch.ahead}</td>
                        <td className="px-3 py-2 text-[var(--color-ink-muted)]">{branch.behind}</td>
                        <td className="max-w-64 truncate px-3 py-2 text-[var(--color-ink-muted)]">
                          {branch.subject}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {branch.name === branches.defaultBranch ? null : (
                            <Link
                              href={`/reviews/new?projectId=${id}&fromBranch=${encodeURIComponent(branch.name)}`}
                              className="text-xs text-[var(--color-accent)] hover:underline"
                            >
                              Review
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            <h2 className="mt-8 mb-3 text-sm font-semibold">Reviews</h2>
            {detail.reviews.length === 0 ? (
              <Empty title="No reviews of this project yet">
                Pick a branch above to review it.
              </Empty>
            ) : (
              <ul className="grid gap-2">
                {detail.reviews.map((review) => (
                  <li key={review.id}>
                    <Link href={`/reviews/${review.id}`}>
                      <Card className="flex flex-wrap items-center gap-2 p-3 text-sm hover:border-[var(--color-border-strong)]">
                        <Badge tone={statusTone(review.status)}>
                          {review.status.replace(/_/g, " ")}
                        </Badge>
                        <Mono className="text-xs text-[var(--color-ink-muted)]">
                          {review.fromBranch} into {review.intoBranch}
                        </Mono>
                        <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                          {review.createdAt.slice(0, 10)}
                        </span>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="grid gap-4 self-start">
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">Dependencies</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                A linked project can be reviewed alongside this one, so a changed type is traced to
                the consumer that never migrated.
              </p>

              {detail.links.length > 0 ? (
                <ul className="mb-3 grid gap-2">
                  {detail.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{link.dependencyName}</span>
                        <Mono className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {link.packageName}
                        </Mono>
                      </span>
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          void call(`/api/projects/${id}/links/${link.id}`, { method: "DELETE" })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {detail.linkable.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-faint)]">
                  {detail.links.length === 0
                    ? "Add another project first, then link it here."
                    : "Every other project is already linked."}
                </p>
              ) : (
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void call(
                      `/api/projects/${id}/links`,
                      {
                        method: "POST",
                        body: JSON.stringify({ dependencyProjectId: dependencyId, packageName }),
                      },
                      () => {
                        setDependencyId("");
                        setPackageName("");
                      },
                    );
                  }}
                >
                  <Field label="Project">
                    <Select
                      value={dependencyId}
                      onChange={(event) => setDependencyId(event.target.value)}
                    >
                      <option value="">Choose a project</option>
                      {detail.linkable.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Package name" hint="As it appears in package.json.">
                    <Input
                      value={packageName}
                      onChange={(event) => setPackageName(event.target.value)}
                      placeholder="@acme/shared-core"
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={busy || dependencyId === "" || packageName.trim() === ""}
                  >
                    Link dependency
                  </Button>
                </form>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">Delete project</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                Removes the clone from disk. Refused while any review still refers to it.
              </p>
              {confirmingDelete ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={async () => {
                      const gone = await call(`/api/projects/${id}`, { method: "DELETE" });
                      if (gone) window.location.href = "/projects";
                    }}
                  >
                    Yes, delete {project.name}
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setConfirmingDelete(true)}>Delete</Button>
              )}
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

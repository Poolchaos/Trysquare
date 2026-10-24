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
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader, PageLoading } from "@/components/page";
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
  statusLabel,
  statusTone,
} from "@/components/ui";
import { send, type Sent } from "@/components/request";
import type { ProjectChecks } from "@/lib/projects/checks";

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
  checks: ProjectChecks;
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

const underWay = (cloneStatus: string | undefined) =>
  cloneStatus === "pending" || cloneStatus === "cloning";

/**
 * The project and its branches, read side by side. Never throws.
 *
 * The project is handed to `onProject` the moment it arrives, so the page
 * draws without waiting for the branches: their route runs git fetch first,
 * seconds on a large or distant remote, and the page drew nothing until it
 * was done (5.13, U10).
 *
 * Side by side, the two reads can straddle the clone finishing: the project
 * ready, its branches refused as not ready, and no poll left to correct the
 * card. The branches are asked again then (review of the D-133 fixes).
 */
async function readPage(
  id: string,
  onProject: (detail: Sent<Detail>) => void,
): Promise<[Sent<Detail>, Sent<Branches>]> {
  const readBranches = () =>
    send<Branches>(`/api/projects/${id}/branches`, {}, "The branches could not be listed");
  const [detail, branches] = await Promise.all([
    send<Detail>(`/api/projects/${id}`, {}, "This project could not be read").then((read) => {
      onProject(read);
      return read;
    }),
    readBranches(),
  ]);
  const straddled =
    detail.ok &&
    detail.body.project.cloneStatus === "ready" &&
    !branches.ok &&
    branches.body.code === "CloneNotReadyError";
  return [detail, straddled ? await readBranches() : branches];
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState("");
  // The project does not exist: the way back, not a Try again that could
  // never work (D-138).
  const [loadMissing, setLoadMissing] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The answer itself, so a refusal (a clone not ready) shows in place of the
  // list instead of a "Fetching" that never ends.
  const [branches, setBranches] = useState<Sent<Branches> | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  // A read of the project that failed while a clone was being followed.
  const [followProblem, setFollowProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Set when the delete was refused over review history: the count from the
  // refusal, driving the offer to remove those reviews first.
  const [blockingReviews, setBlockingReviews] = useState<number | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);

  const [dependencyId, setDependencyId] = useState("");
  const [packageName, setPackageName] = useState("");

  const load = useCallback(async () => {
    const [, branchSent] = await readPage(id, (detailSent) => {
      if (detailSent.ok) setDetail(detailSent.body);
    });
    setBranches(branchSent);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [detailSent, branchSent] = await readPage(id, (read) => {
        if (cancelled) return;
        // The project itself is the screen; without it there is nothing to
        // draw, and saying so beats a "Loading..." that never resolves.
        if (read.ok) setDetail(read.body);
        else {
          setLoadError(read.error);
          setLoadMissing(read.status === 404);
        }
      });
      if (cancelled || !detailSent.ok) return;
      // Branches are a separate concern: the remote may be unreachable while
      // the project is perfectly readable, and the branch card says so.
      setBranches(branchSent);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadAttempt]);

  async function call(path: string, init: RequestInit, onDone?: () => void) {
    setError("");
    setBusy(true);
    try {
      const sent = await send(path, init, "That did not work");
      if (!sent.ok) {
        setError(sent.error);
        // Gone already, from another tab say: the page shows what is there
        // now rather than a row that no longer exists (D-136).
        if (sent.status === 404) await load();
        return false;
      }
      onDone?.();
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  // Followed while a clone is queued or under way, as the list does, so a
  // clone tried again shows how it ended without a reload (5.7). Only the
  // project row, one request at a time: the whole page every second fetched
  // the remote into the clone still being written (review of 5.5 to 5.7).
  // Once it settles the page is read whole, so a finished clone lists its
  // branches.
  const cloneUnderWay = underWay(detail?.project.cloneStatus);
  useEffect(() => {
    if (!cloneUnderWay) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const sent = await send<Detail>(`/api/projects/${id}`, {}, "This project could not be read");
      if (stopped) return;
      // Deleted while its clone ran, from another tab, say: said, and no
      // longer asked after. It used to be asked after once a second for as
      // long as the page stayed open (review of the D-133 fixes).
      if (!sent.ok && sent.status === 404) {
        setDetail(null);
        setLoadError(sent.error);
        setLoadMissing(true);
        return;
      }
      // Any other failure is said too, and the following goes on: a server
      // that went away may come back.
      setFollowProblem(sent.ok ? "" : sent.error);
      if (sent.ok && underWay(sent.body.project.cloneStatus)) setDetail(sent.body);
      else if (sent.ok) await load();
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [cloneUnderWay, id, load]);

  if (!detail) {
    return (
      <PageLoading
        title="Project"
        {...(loadError === "" ? {} : { error: loadError })}
        {...(loadMissing
          ? { back: { href: "/projects", label: "All projects" } }
          : {
              onRetry: () => {
                setLoadError("");
                setLoadAttempt((attempt) => attempt + 1);
              },
            })}
      />
    );
  }

  const { project } = detail;
  const listed = branches?.ok ? branches.body : null;
  const shown = (listed?.branches ?? []).filter((branch) => branch.name.includes(filter));

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
          project.cloneStatus === "ready" ? (
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
          ) : project.cloneStatus === "failed" ? (
            // A failed clone used to be a dead end; the address may answer
            // now, after a fix to it or to the network (5.7, audit U6).
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void call(`/api/projects/${id}/clone`, { method: "POST" })}
            >
              Retry clone
            </Button>
          ) : (
            <Badge tone="accent">cloning</Badge>
          )
        }
      />
      <PageBody>
        {error ? (
          <div className="mb-4">
            <Problem>{error}</Problem>
          </div>
        ) : null}
        {followProblem ? (
          <div className="mb-4">
            <Problem>{followProblem}</Problem>
          </div>
        ) : null}
        {project.cloneError ? (
          <pre className="mb-4 overflow-x-auto rounded border border-[var(--color-critical)] bg-[var(--color-critical-soft)] p-3 text-xs text-[var(--color-critical)]">
            {project.cloneError}
          </pre>
        ) : null}
        {listed?.stale ? (
          <div className="mb-4">
            <p className="text-sm text-[var(--color-ink-muted)]">
              These branches are from the last successful fetch: {listed.stale}
            </p>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-heading font-semibold">Branches</h2>
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter"
                className="max-w-56"
              />
            </div>

            {branches === null ? (
              <p className="text-sm text-[var(--color-ink-muted)]">Fetching the latest refs...</p>
            ) : !branches.ok ? (
              <p className="text-sm text-[var(--color-ink-muted)]">{branches.error}</p>
            ) : shown.length === 0 ? (
              (branches.body.branches ?? []).length === 0 ? (
                <Empty title="This repository has no branches">
                  Nothing has been pushed to it yet, or the clone could not read its refs.
                </Empty>
              ) : (
                <Empty title="No branch matches that filter">
                  {(branches.body.branches ?? []).length} branch(es) are here; the filter is hiding
                  them.
                </Empty>
              )
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
                          {branch.name === branches.body.defaultBranch ? (
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
                          {branch.name === branches.body.defaultBranch ? null : (
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

            <h2 className="mt-8 mb-3 text-heading font-semibold">Reviews</h2>
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
                        <Badge tone={statusTone(review.status)}>{statusLabel(review.status)}</Badge>
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
              <h2 className="mb-1 text-heading font-semibold">Name and default branch</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                A new review compares against the default branch unless told otherwise. It was
                guessed from the remote when the project was added.
              </p>
              <ProjectEditForm
                key={`${project.name}\u0000${project.defaultBranch}`}
                name={project.name}
                defaultBranch={project.defaultBranch}
                branches={listed ? listed.branches.map((branch) => branch.name) : null}
                busy={busy}
                onSave={(changed) =>
                  void call(`/api/projects/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify(changed),
                  })
                }
              />
            </Card>

            <Card className="p-4">
              <h2 className="mb-1 text-heading font-semibold">Dependencies</h2>
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
              <h2 className="mb-1 text-heading font-semibold">Tests and design</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                {detail.checks.enabled
                  ? "On: each review also runs these on a throwaway copy of the branch, and grades the screenshots its e2e saves."
                  : "Off: a review reads the code and runs none of it."}
              </p>
              <ProjectChecksForm
                key={JSON.stringify(detail.checks)}
                stored={detail.checks}
                busy={busy}
                onSave={(checks) =>
                  void call(`/api/projects/${id}/checks`, {
                    method: "PUT",
                    body: JSON.stringify(checks),
                  })
                }
              />
            </Card>

            <Card className="p-4">
              <h2 className="mb-1 text-heading font-semibold">Delete project</h2>
              <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
                Removes the clone from disk. Refused while any review still refers to it.
              </p>
              {confirmingDelete ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={async () => {
                      setBlockingReviews(null);
                      const sent = await send(
                        `/api/projects/${id}`,
                        { method: "DELETE" },
                        "The project could not be deleted",
                      );
                      if (sent.ok) {
                        router.push("/projects");
                        return;
                      }
                      const body = sent.body as { code?: string; reviewCount?: number };
                      if (body.code === "ProjectHasReviewsError" && body.reviewCount) {
                        // The remedy 02 promises: offer to remove the history
                        // first, by its real count, behind its own second step.
                        setBlockingReviews(body.reviewCount);
                      } else {
                        setError(sent.error);
                      }
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

              {blockingReviews !== null ? (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
                    {blockingReviews} review(s) refer to this project, including any that included
                    it as a dependency. Deleting them removes their findings, reports and evidence;
                    exported reports stay.
                  </p>
                  {confirmingBulk ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={async () => {
                          const cleared = await call(`/api/projects/${id}/reviews`, {
                            method: "DELETE",
                          });
                          if (!cleared) return;
                          const gone = await call(`/api/projects/${id}`, { method: "DELETE" });
                          if (gone) router.push("/projects");
                        }}
                      >
                        Delete {blockingReviews} review(s), then the project
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirmingBulk(false)}>
                        Keep them
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={() => setConfirmingBulk(true)}>
                      Delete its {blockingReviews} review(s) first
                    </Button>
                  )}
                </div>
              ) : null}
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

/**
 * A project's name and default branch, as stored, each held as typed or
 * chosen. Keyed by the page on what is stored, so a save or a reload draws
 * it afresh, and only what changed is sent (D-51).
 *
 * The branch is held, not left to the select: left to it, the select took
 * the first branch listed, the newest, when the list arrived after the
 * page was drawn, and a save meant as a rename moved the default to it
 * (review of the 7.1 changes). The stored one stays an option even when
 * the clone lacks it.
 */
function ProjectEditForm({
  name: storedName,
  defaultBranch: storedBranch,
  branches,
  busy,
  onSave,
}: {
  name: string;
  defaultBranch: string;
  branches: string[] | null;
  busy: boolean;
  onSave: (changed: { name?: string; defaultBranch?: string }) => void;
}) {
  const [name, setName] = useState(storedName);
  const [branch, setBranch] = useState(storedBranch);
  const options =
    branches === null
      ? [storedBranch]
      : branches.includes(storedBranch)
        ? branches
        : [storedBranch, ...branches];
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const changed = {
          ...(name.trim() === storedName ? {} : { name }),
          ...(branch === storedBranch ? {} : { defaultBranch: branch }),
        };
        if (Object.keys(changed).length > 0) onSave(changed);
      }}
    >
      <Field label="Name">
        <Input name="name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field
        label="Default branch"
        {...(branches === null ? { hint: "Chosen once the branches are read." } : {})}
      >
        <Select
          name="defaultBranch"
          value={branch}
          disabled={branches === null}
          onChange={(event) => setBranch(event.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * The project's own tests and e2e (WP-I, D-191, D-192), held as typed and
 * sent whole. Turning them on says what it means before it is saved: the
 * branch's own code runs on this machine.
 */
function ProjectChecksForm({
  stored,
  busy,
  onSave,
}: {
  stored: ProjectChecks;
  busy: boolean;
  onSave: (checks: ProjectChecks) => void;
}) {
  const [checks, setChecks] = useState(stored);
  const text = (field: Exclude<keyof ProjectChecks, "enabled">) => ({
    value: checks[field] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setChecks((current) => ({ ...current, [field]: event.target.value })),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(checks);
      }}
    >
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={checks.enabled}
          onChange={(event) => setChecks({ ...checks, enabled: event.target.checked })}
        />
        <span>Run this project&apos;s tests and e2e on each review</span>
      </label>
      {checks.enabled ? (
        <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs">
          This runs the branch&apos;s own code on this machine, as you. Turn it on only for a
          project whose branches you trust.
        </p>
      ) : null}
      <Field label="Install" hint="Run first, such as npm ci. Optional.">
        <Input name="installCommand" placeholder="npm ci" {...text("installCommand")} />
      </Field>
      <Field label="Tests" hint="A failing run is a finding.">
        <Input name="testCommand" placeholder="npm test" {...text("testCommand")} />
      </Field>
      <Field label="E2E" hint="Only an e2e run's screenshots are graded.">
        <Input name="e2eCommand" placeholder="npm run e2e" {...text("e2eCommand")} />
      </Field>
      <Field label="Screenshots folder" hint="Where the e2e saves them, inside the repository.">
        <Input name="screenshotDir" placeholder="e2e/screenshots" {...text("screenshotDir")} />
      </Field>
      <Field
        label="Design standard"
        hint="A file in the repository the screenshots are graded against, A to D. Optional."
      >
        <Input
          name="designStandardPath"
          placeholder="docs/design.md"
          {...text("designStandardPath")}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          Save checks
        </Button>
      </div>
    </form>
  );
}

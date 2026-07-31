/**
 * Project and dependency-link persistence.
 */

import { and, asc, eq, or } from "drizzle-orm";
import { newId, nowIso } from "@/lib/ids";
import type { CloneStatus } from "@/lib/domain/enums";
import type { Db } from "../client";
import { projectLinks, projects, reviews } from "../schema";

export type Project = typeof projects.$inferSelect;
export type ProjectLink = typeof projectLinks.$inferSelect;

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`No project with id "${projectId}".`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectHasReviewsError extends Error {
  constructor(
    readonly projectId: string,
    readonly reviewCount: number,
  ) {
    super(
      `Project "${projectId}" still has ${reviewCount} review(s). ` +
        `Delete them first: removing a project must not silently discard its review history.`,
    );
    this.name = "ProjectHasReviewsError";
  }
}

export interface CreateProjectInput {
  name: string;
  gitUrl: string;
  defaultBranch: string;
  clonePath: string;
}

export function createProject(db: Db, input: CreateProjectInput): Project {
  const row = {
    id: newId(),
    name: input.name,
    gitUrl: input.gitUrl,
    defaultBranch: input.defaultBranch,
    clonePath: input.clonePath,
    cloneStatus: "pending" satisfies CloneStatus,
    cloneError: null,
    lastFetchedAt: null,
    createdAt: nowIso(),
  };
  db.insert(projects).values(row).run();
  return row;
}

export function getProject(db: Db, projectId: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

export function requireProject(db: Db, projectId: string): Project {
  const project = getProject(db, projectId);
  if (!project) throw new ProjectNotFoundError(projectId);
  return project;
}

export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(asc(projects.name)).all();
}

/** A failed clone keeps its error; a successful one clears the previous error. */
export function setCloneStatus(
  db: Db,
  projectId: string,
  status: CloneStatus,
  error?: string | null,
): void {
  db.update(projects)
    .set({ cloneStatus: status, cloneError: status === "failed" ? (error ?? null) : null })
    .where(eq(projects.id, projectId))
    .run();
}

/**
 * Where the bare clone lives.
 *
 * Set after the row exists, because the path is derived from the project id
 * and the id is minted by the insert.
 */
export function setClonePath(db: Db, projectId: string, clonePath: string): void {
  db.update(projects).set({ clonePath }).where(eq(projects.id, projectId)).run();
}

export function recordFetch(db: Db, projectId: string, at = nowIso()): void {
  db.update(projects).set({ lastFetchedAt: at }).where(eq(projects.id, projectId)).run();
}

export function setDefaultBranch(db: Db, projectId: string, branch: string): void {
  db.update(projects).set({ defaultBranch: branch }).where(eq(projects.id, projectId)).run();
}

export function renameProject(db: Db, projectId: string, name: string): void {
  db.update(projects).set({ name }).where(eq(projects.id, projectId)).run();
}

/**
 * Every review that would be broken by removing this project: the ones it
 * owns, plus the ones that included it as a linked dependency. Both count,
 * because a dependency that was never reviewed on its own can still be part
 * of somebody else's linked review.
 */
export function countReviewsReferencing(db: Db, projectId: string): number {
  return db
    .select()
    .from(reviews)
    .where(or(eq(reviews.projectId, projectId), eq(reviews.linkedProjectId, projectId)))
    .all().length;
}

/**
 * Deleting a project is refused while reviews reference it. The UI offers to
 * remove those first, so history is never discarded by a single click.
 */
export function deleteProject(db: Db, projectId: string): void {
  const reviewCount = countReviewsReferencing(db, projectId);
  if (reviewCount > 0) throw new ProjectHasReviewsError(projectId, reviewCount);
  db.delete(projects).where(eq(projects.id, projectId)).run();
}

export class InvalidProjectLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectLinkError";
  }
}

/**
 * Links a consumer project to a dependency whose changes may need reviewing
 * alongside it, keyed by the package specifier so imports can be resolved to
 * the dependency's worktree instead of node_modules.
 */
export function linkDependency(
  db: Db,
  input: { projectId: string; dependencyProjectId: string; packageName: string; note?: string },
): ProjectLink {
  if (input.projectId === input.dependencyProjectId) {
    throw new InvalidProjectLinkError("A project cannot be its own dependency.");
  }
  requireProject(db, input.projectId);
  requireProject(db, input.dependencyProjectId);

  const existing = db
    .select()
    .from(projectLinks)
    .where(
      and(
        eq(projectLinks.projectId, input.projectId),
        eq(projectLinks.dependencyProjectId, input.dependencyProjectId),
      ),
    )
    .get();
  if (existing) {
    throw new InvalidProjectLinkError("That dependency is already linked to this project.");
  }

  const row = {
    id: newId(),
    projectId: input.projectId,
    dependencyProjectId: input.dependencyProjectId,
    packageName: input.packageName,
    note: input.note ?? null,
    createdAt: nowIso(),
  };
  db.insert(projectLinks).values(row).run();
  return row;
}

export function listDependencyLinks(db: Db, projectId: string): ProjectLink[] {
  return db.select().from(projectLinks).where(eq(projectLinks.projectId, projectId)).all();
}

export function unlinkDependency(db: Db, linkId: string): void {
  db.delete(projectLinks).where(eq(projectLinks.id, linkId)).run();
}

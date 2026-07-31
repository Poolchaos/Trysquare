/**
 * A project's dependency links.
 *
 * The link is what makes a review of two repositories possible: it names the
 * package the primary consumes, so a change to an exported type in the
 * dependency can be traced to the consumer that never migrated.
 */

import { z } from "zod";
import { linkDependency, listDependencyLinks } from "@/server/db/repositories/projects";
import { created, failed, handler, ok, readJson } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const body = z.object({
  dependencyProjectId: z.string().min(1),
  packageName: z.string().trim().min(1),
  note: z.string().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    return ok({ links: listDependencyLinks(runtime().db, id) });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const input = await readJson(request, body);

    try {
      // The repository already refuses a self-link and a duplicate, with
      // messages worth showing, so they are passed through rather than
      // re-checked here in different words.
      return created({
        link: linkDependency(db, {
          projectId: id,
          dependencyProjectId: input.dependencyProjectId,
          packageName: input.packageName,
          ...(input.note === undefined ? {} : { note: input.note }),
        }),
      });
    } catch (error) {
      return failed(error, 400);
    }
  });
}

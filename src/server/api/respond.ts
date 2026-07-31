/**
 * How every route answers, so no handler invents its own shape.
 *
 * The rule that matters: an error reaches the user as the message the thing
 * that failed actually produced. Git's stderr, the CLI's refusal, the state
 * machine's complaint. A route that replaced those with "something went wrong"
 * would be throwing away the only part a person can act on, and this app's
 * whole posture is that a failure is a result worth reading.
 */

import { z } from "zod";

export interface ApiError {
  error: string;
  /** A stable code the UI can branch on without matching English. */
  code: string;
}

export function ok<T>(body: T, init: ResponseInit = {}): Response {
  return Response.json(body, { status: 200, ...init });
}

export function created<T>(body: T): Response {
  return Response.json(body, { status: 201 });
}

export function failed(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? error.name : "Error";
  return Response.json({ error: message, code } satisfies ApiError, { status });
}

export function notFound(what: string): Response {
  return Response.json({ error: `${what} was not found.`, code: "NotFound" } satisfies ApiError, {
    status: 404,
  });
}

/**
 * Reads and validates a JSON body.
 *
 * Throws a `Response` rather than returning a union, so a handler reads as the
 * happy path and the failure still reaches the client intact. zod's message
 * names the field, which is what makes the error worth showing.
 */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw Response.json(
      { error: "The request body was not JSON.", code: "BadBody" },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw Response.json({ error: detail, code: "Invalid" }, { status: 400 });
  }
  return parsed.data;
}

/** Wraps a handler so a thrown Response is returned and anything else is a 500. */
export function handler(run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) => {
    if (error instanceof Response) return error;
    return failed(error, 500);
  });
}

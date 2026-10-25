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
import { isNamed } from "@/lib/errors";

// Routes take it from here, beside the helpers that answer with it.
export { isNamed };

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
  const text = await readBody(request);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw notJson();
  }
  return validated(raw, schema);
}

/**
 * The largest body a request may carry. A pasted protocol document is the
 * largest the app takes, and the sample one is 10,846 bytes; this is nearly
 * four hundred of it. Every body was buffered whole, however large (audit
 * finding 5).
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The body as text, refused past the limit, declared or found while read. */
async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function tooLarge(): Response {
  return Response.json(
    {
      error: `The request body is over ${MAX_BODY_BYTES} bytes, the most a request may carry.`,
      code: "BodyTooLarge",
    },
    { status: 413 },
  );
}

/**
 * Reads a body that may be left out: an empty one is `{}`, so a bare POST
 * still means "nothing to add". A body that is there is held to the schema
 * as readJson holds it. Read leniently, a confirm's malformed comment was
 * taken as no comment and a start's malformed ruleset as none (5.8, A8).
 */
export async function readOptionalJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await readBody(request);
  if (text.trim() === "") return validated({}, schema);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw notJson();
  }
  return validated(raw, schema);
}

function notJson(): Response {
  return Response.json(
    { error: "The request body was not JSON.", code: "BadBody" },
    { status: 400 },
  );
}

function validated<T>(raw: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw Response.json({ error: detail, code: "Invalid" }, { status: 400 });
  }
  return parsed.data;
}

/**
 * The errors that are the request's fault, by the name each class sets: a
 * 404 for an id that names nothing, a 409 for a step refused by the state the
 * thing is in. The names are strings, as everywhere outside a class's module.
 */
export const ERROR_STATUSES: readonly (readonly [name: string, status: 404 | 409])[] = [
  ["ReviewNotFoundError", 404],
  ["ProjectNotFoundError", 404],
  ["LinkNotFoundError", 404],
  ["RulesetNotFoundError", 404],
  ["RuleNotFoundError", 404],
  ["FindingNotFoundError", 404],
  ["CheckFindingNotFoundError", 404],
  ["ModelNotFoundError", 404],
  ["IllegalTransitionError", 409],
  ["OpenQuestionNotConfirmableError", 409],
  ["InvalidCloneTransitionError", 409],
  ["CloneNotReadyError", 409],
  // The job manager's: a review that cannot run, a ruleset for one that is
  // already running or in line, and one being deleted.
  ["ReviewNotStartableError", 409],
  ["ReviewAlreadyStartedError", 409],
  ["ReviewBeingDeletedError", 409],
  // Verifying an open question again (WP-D2).
  ["NotAnOpenQuestionError", 409],
  ["VerifyAgainUnavailableError", 409],
];
const STATUS_BY_NAME = new Map(ERROR_STATUSES);

/**
 * Wraps a handler so a thrown Response is returned, an id that names nothing
 * is a 404, a step refused by the state the thing is in is a 409, and
 * anything else is a 500. Every error used to be a 500, so a wrong request
 * read as the server failing (5.6, audit A1). By exact name, never a pattern:
 * CliNotFoundError is a missing program, not a missing resource.
 */
export function handler(run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) => {
    if (error instanceof Response) return error;
    const status = error instanceof Error ? STATUS_BY_NAME.get(error.name) : undefined;
    return failed(error, status ?? 500);
  });
}

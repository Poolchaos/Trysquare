/**
 * JSON columns are text in SQLite and are never read raw.
 *
 * Everything goes through zod here so a malformed or hand-edited value fails
 * loudly at the boundary instead of becoming `undefined` three layers later.
 */

import type { z } from "zod";

export class MalformedStoredJsonError extends Error {
  constructor(
    readonly column: string,
    readonly detail: string,
  ) {
    super(`Stored JSON in "${column}" is not valid: ${detail}`);
    this.name = "MalformedStoredJsonError";
  }
}

export function parseJsonColumn<T>(column: string, raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MalformedStoredJsonError(
      column,
      error instanceof Error ? error.message : "unparsable",
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new MalformedStoredJsonError(
      column,
      result.error.issues.map((i) => i.message).join("; "),
    );
  }
  return result.data;
}

/**
 * Writes a JSON column, checked against the same schema the reader uses.
 *
 * 02 requires these columns to be validated on read and on write. Validating
 * only on read stores a wrong shape happily and fails later at a read, in a
 * stack trace pointing at whoever opened the row rather than at whoever wrote
 * it. The schema is optional so callers storing something with no reader (a
 * free-form setting value) are not forced to invent one.
 */
export function serialiseJsonColumn<T>(value: T, schema?: z.ZodType<T>): string {
  if (schema) {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new MalformedJsonWriteError(result.error.issues.map((i) => i.message).join("; "));
    }
  }
  return JSON.stringify(value);
}

export class MalformedJsonWriteError extends Error {
  constructor(readonly detail: string) {
    super(`Refusing to store JSON that does not match its column schema: ${detail}`);
    this.name = "MalformedJsonWriteError";
  }
}

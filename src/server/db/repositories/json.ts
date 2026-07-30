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

export function serialiseJsonColumn(value: unknown): string {
  return JSON.stringify(value);
}

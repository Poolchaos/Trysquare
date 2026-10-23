/**
 * The proof a verifier gives, step by step, checked against the code (the
 * proof-and-steps plan, WP-C). One quotation proved the cited code was there,
 * not the path from a trigger to the failure; each step of that path is now
 * quoted and each is found in the file, or the finding is discarded.
 */

import { describe, expect, it } from "vitest";
import { describeStep, firstFailingStep } from "@/lib/review/evidence";

const FILE = ["export function total(items) {", "  const user = payload as User;", "}"].join("\n");
const contents = new Map<string, string | null>([
  ["app/orders.ts", FILE],
  ["app/gone.ts", null],
]);

describe("a proof's steps", () => {
  it("pass when every step is found at its lines", () => {
    expect(
      firstFailingStep(
        [
          {
            path: "app/orders.ts",
            lineStart: 1,
            lineEnd: 1,
            quote: "export function total(items) {",
          },
          {
            path: "app/orders.ts",
            lineStart: 2,
            lineEnd: 2,
            quote: "  const user = payload as User;",
          },
        ],
        contents,
      ),
    ).toBeNull();
  });

  it("name the first step that is not in the code, though a later one is", () => {
    const failing = firstFailingStep(
      [
        { path: "app/orders.ts", lineStart: 1, lineEnd: 1, quote: "export function sum(items) {" },
        {
          path: "app/orders.ts",
          lineStart: 2,
          lineEnd: 2,
          quote: "  const user = payload as User;",
        },
      ],
      contents,
    );
    expect(failing?.index).toBe(0);
    expect(failing?.reason).toMatch(/did not match the file/);
  });

  it("fail at a step whose file could not be read", () => {
    const failing = firstFailingStep(
      [
        {
          path: "app/orders.ts",
          lineStart: 2,
          lineEnd: 2,
          quote: "  const user = payload as User;",
        },
        { path: "app/gone.ts", lineStart: 1, lineEnd: 1, quote: "x" },
      ],
      contents,
    );
    expect(failing).toEqual({ index: 1, reason: "names a file that could not be read" });
  });

  it("are named by position, file and lines", () => {
    expect(
      describeStep(
        [
          { path: "app/a.ts", lineStart: 3, lineEnd: 3, quote: "a" },
          { path: "app/b.ts", lineStart: 10, lineEnd: 12, quote: "b" },
        ],
        1,
      ),
    ).toBe("Evidence step 2 of 2 (app/b.ts lines 10 to 12)");
  });
});

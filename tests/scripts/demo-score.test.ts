/**
 * The demo's key: a finding is a planted defect where its harm shows, or,
 * for a defect whose change is in another file, where the change was made
 * (D-195).
 */

import { describe, expect, it } from "vitest";
import { findsDefect } from "../../scripts/lib/demo-score";

const at = (filePath: string, lineStart: number) => ({ filePath, lineStart });

describe("scoring a finding against the key", () => {
  const consumer = { path: "app/src/settings/prefs.ts", line: 8 };

  it("finds a defect where its harm shows, within two lines", () => {
    expect(findsDefect(at("app/src/settings/prefs.ts", 8), consumer)).toBe(true);
    expect(findsDefect(at("app/src/settings/prefs.ts", 6), consumer)).toBe(true);
    expect(findsDefect(at("app/src/settings/prefs.ts", 5), consumer)).toBe(false);
    expect(findsDefect(at("app/src/settings/other.ts", 8), consumer)).toBe(false);
  });

  it("finds one cited where the change was made, when the key names it", () => {
    // WP-H: the shortened default proven at the constant, its proof running
    // to the consumer the key names.
    const shortened = { ...consumer, changeSite: { path: "shared-core/types.ts", line: 7 } };
    expect(findsDefect(at("shared-core/types.ts", 7), shortened)).toBe(true);
    expect(findsDefect(at("shared-core/types.ts", 2), shortened)).toBe(false);
    // Without a change site, the change is not the defect's place.
    expect(findsDefect(at("shared-core/types.ts", 7), consumer)).toBe(false);
  });

  it("finds one anywhere in a deleted file named as its change", () => {
    const deleted = {
      path: "app/src/orders/dispatch.ts",
      line: 4,
      changeSite: { path: "app/src/orders/retry.ts", line: null },
    };
    expect(findsDefect(at("app/src/orders/retry.ts", 1), deleted)).toBe(true);
    expect(findsDefect(at("app/src/orders/dispatch.ts", 4), deleted)).toBe(true);
    expect(findsDefect(at("app/src/orders/save.ts", 1), deleted)).toBe(false);
  });
});

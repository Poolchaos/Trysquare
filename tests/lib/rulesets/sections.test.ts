/**
 * What a process directive's section is called on a screen. The stored key
 * ("prime_directive") was shown as it is; a person reads its words.
 */

import { describe, expect, it } from "vitest";
import { DIRECTIVE_SECTIONS } from "@/lib/domain/enums";
import { directiveSectionLabel } from "@/lib/rulesets/sections";

describe("a directive section's name on a screen", () => {
  it("is words for every section, never the stored key", () => {
    for (const section of DIRECTIVE_SECTIONS) {
      const label = directiveSectionLabel(section);
      expect(label, section).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(label, section).not.toBe(section);
    }
  });

  it("keeps the protocol's own terms", () => {
    expect(directiveSectionLabel("prime_directive")).toBe("Prime directive");
    expect(directiveSectionLabel("severity_model")).toBe("Severity model");
    expect(directiveSectionLabel("output_format")).toBe("Output format");
    expect(directiveSectionLabel("domain_knowledge")).toBe("Domain knowledge");
    expect(directiveSectionLabel("philosophy")).toBe("Philosophy");
  });
});

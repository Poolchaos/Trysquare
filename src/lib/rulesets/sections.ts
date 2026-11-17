/**
 * What a process directive's section is called on a screen. The words are
 * the protocol's own, so a person who knows their document finds its terms;
 * only the stored key's spelling goes.
 */

import type { DirectiveSection } from "@/lib/domain/enums";

const LABELS: Record<DirectiveSection, string> = {
  prime_directive: "Prime directive",
  procedure: "Procedure",
  scope: "Scope",
  philosophy: "Philosophy",
  severity_model: "Severity model",
  output_format: "Output format",
  domain_knowledge: "Domain knowledge",
};

export function directiveSectionLabel(section: DirectiveSection): string {
  return LABELS[section];
}

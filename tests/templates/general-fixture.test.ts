/** The General template's fixture (RT-2b), held as every template's is. */

import { holdsTemplateFixture } from "./fixture-checks";

holdsTemplateFixture({
  slug: "general",
  swept: ["1", "5", "6", "9", "10", "11"],
  // Rule 12's plant is a guard taken out: the key points at the call it guarded.
  removal: { rule: "12", line: '  if (!user.roles.includes("admin")) throw new Forbidden();' },
});

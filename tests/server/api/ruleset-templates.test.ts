/** The shelf as the app lists it (RT-1): read from the repository's own `templates/` folder. */

import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ruleset-templates/route";

describe("GET /api/ruleset-templates", () => {
  it("lists the shelf this repository ships: the General template, not yet run against a model", async () => {
    const listed = await GET();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      templates: [
        {
          slug: "general",
          name: "General",
          purpose:
            "What any change is held to, whatever it is written in: a failure hidden, input " +
            "trusted, a credential or personal data exposed, a resource left open, behaviour " +
            "changed with nothing to prove it, work left unfinished.",
          version: 1,
          modelRun: null,
          ruleCount: 12,
        },
      ],
    });
  });
});

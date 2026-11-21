/** The shelf as the app lists it (RT-1): read from the repository's own `templates/` folder. */

import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ruleset-templates/route";

describe("GET /api/ruleset-templates", () => {
  it("lists the shelf this repository ships, which holds no template yet", async () => {
    const listed = await GET();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ templates: [] });
  });
});

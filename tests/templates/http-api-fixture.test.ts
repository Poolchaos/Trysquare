/** The HTTP API and database template's fixture (RT-5b), held as every template's is. */

import { holdsTemplateFixture } from "./fixture-checks";

holdsTemplateFixture({
  slug: "http-api",
  swept: ["4", "5", "6"],
});

/** The models this account can actually use, and what each one is good for. */

import { availabilityOf, listModels } from "@/server/db/repositories/models";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const now = Date.now();
    const models = listModels(runtime().db).map((model) => ({
      ...model,
      availability: availabilityOf(model, now),
    }));
    return ok({ models });
  });
}

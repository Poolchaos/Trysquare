/** The models this account can actually use, and what each one is good for. */

import { availabilityOf } from "@/lib/models/availability";
import { listModels } from "@/server/db/repositories/models";
import { lastUsedModel } from "@/server/db/repositories/reviews";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => {
    const now = Date.now();
    const { db } = runtime();
    const models = listModels(db).map((model) => ({
      ...model,
      availability: availabilityOf(model, now),
    }));
    // A new review starts on the one used last (MVP 7.1).
    return ok({ models, lastUsed: lastUsedModel(db) });
  });
}

/**
 * The templates a ruleset can be started from: the shelf this app ships
 * (RT-1), each with what it is for, how many rules it holds and whether it
 * has been run against a model.
 */

import { readShelf } from "@/server/rulesets/shelf";
import { handler, ok } from "@/server/api/respond";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handler(async () => ok({ templates: readShelf() }));
}

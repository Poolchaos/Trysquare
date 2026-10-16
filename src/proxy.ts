/**
 * The one door every request passes, so the rule in `lib/http/request-guard`
 * cannot be forgotten by a route added later. Static build output is left out
 * of the matcher: it is the same bytes for anyone, and the Host check on the
 * page that loads it already decides who gets a page at all.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/http/request-guard";

export function proxy(request: NextRequest): NextResponse {
  const verdict = checkRequest({
    method: request.method,
    path: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  if (verdict.ok) return NextResponse.next();
  return NextResponse.json({ error: verdict.error, code: "ForeignRequest" }, { status: 403 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

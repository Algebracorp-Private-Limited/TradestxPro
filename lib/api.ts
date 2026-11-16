import "server-only";
import { NextResponse } from "next/server";
import { NotConfiguredError } from "./db";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(error: string, status = 400) {
  return json({ ok: false, error }, status);
}

/** Rejects cross-site POSTs (CSRF) and non-JSON bodies. */
function checkRequest(req: Request): string | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return "Cross-site request blocked.";
  if (!req.headers.get("content-type")?.includes("application/json")) return "Expected JSON body.";
  return null;
}

export function postHandler(fn: (body: unknown, req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const problem = checkRequest(req);
    if (problem) return fail(problem, 403);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Invalid JSON body.");
    }
    try {
      return await fn(body, req);
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        return fail(`${e.message} Sign-up will open shortly.`, 503);
      }
      console.error(e);
      return fail("Something went wrong. Please try again.", 500);
    }
  };
}

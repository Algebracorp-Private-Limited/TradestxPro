import "server-only";
import { NextResponse } from "next/server";
import { NotConfiguredError } from "./db";
import { getSessionUser, type SessionUser } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(error: string, status = 400) {
  return json({ ok: false, error }, status);
}

/** Rejects cross-site state-changing requests (CSRF) and non-JSON bodies. */
function checkMutation(req: Request): string | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return "Cross-site request blocked.";
  const hasBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
  if (hasBody && !req.headers.get("content-type")?.includes("application/json")) return "Expected JSON body.";
  return null;
}

function handleError(e: unknown) {
  if (e instanceof NotConfiguredError) return fail(`${e.message} Please try again later.`, 503);
  console.error(e);
  return fail("Something went wrong. Please try again.", 500);
}

type Ctx<P> = { params: Promise<P> };

/** Public POST endpoint with JSON body (auth flows). */
export function postHandler(fn: (body: unknown, req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const problem = checkMutation(req);
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
      return handleError(e);
    }
  };
}

/** Signed-in endpoint for any method. Body is parsed for POST/PATCH/PUT. */
export function userHandler<P = Record<string, string>>(
  fn: (args: { user: SessionUser; body: unknown; req: Request; params: P }) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      if (req.method !== "GET") {
        const problem = checkMutation(req);
        if (problem) return fail(problem, 403);
      }
      const user = await getSessionUser();
      if (!user) return fail("Please log in.", 401);
      let body: unknown = null;
      if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
        try {
          body = await req.json();
        } catch {
          return fail("Invalid JSON body.");
        }
      }
      return await fn({ user, body, req, params: (await ctx?.params) ?? ({} as P) });
    } catch (e) {
      return handleError(e);
    }
  };
}

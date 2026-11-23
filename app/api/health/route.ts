import { db, isDbConfigured } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { eodStatus } from "@/lib/eod";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

async function timeFetch(url: string): Promise<number | null> {
  const t = performance.now();
  try {
    await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
    return Math.round(performance.now() - t);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const diag = new URL(req.url).searchParams.get("diag") === "1";
  let database: "ok" | "not_configured" | "error" = "not_configured";
  let eod: Awaited<ReturnType<typeof eodStatus>> | null = null;
  let dbMs: number[] = [];
  if (isDbConfigured()) {
    try {
      const sql = await db();
      for (let i = 0; i < (diag ? 3 : 1); i++) {
        const t = performance.now();
        await sql`SELECT 1`;
        dbMs.push(Math.round(performance.now() - t));
      }
      database = "ok";
      eod = await eodStatus().catch(() => null);
    } catch {
      database = "error";
      dbMs = [];
    }
  }
  const out: Record<string, unknown> = {
    ok: true,
    service: "tradestxpro",
    time: new Date().toISOString(),
    database,
    email: isMailConfigured() ? "ok" : "not_configured",
    marketData: "not_connected",
    brokerConnect: isVaultConfigured() ? "ok" : "not_configured",
    adminConfigured: Boolean(process.env.ADMIN_EMAILS?.trim()),
    endOfDay: eod,
  };
  if (diag) {
    // Non-secret placement info: which region runs functions, and where the database host is.
    const host = (() => {
      try {
        return new URL(process.env.DATABASE_URL ?? "").hostname;
      } catch {
        return "";
      }
    })();
    out.diag = {
      functionRegion: process.env.VERCEL_REGION ?? null,
      dbRegion: host.match(/\.([a-z]{2}-[a-z]+-\d)\.aws\./)?.[1] ?? host.split(".").slice(1, 3).join(".") ?? null,
      dbRoundTripMs: dbMs,
      iciciMs: await timeFetch("https://api.icicidirect.com/breezeapi/api/v1/"),
      dhanMs: await timeFetch("https://api.dhan.co/v2/"),
      nseMs: await timeFetch("https://nsearchives.nseindia.com/"),
    };
  }
  return json(out);
}

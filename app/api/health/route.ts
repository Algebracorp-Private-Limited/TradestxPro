import { db, isDbConfigured } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { eodStatus } from "@/lib/eod";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  let eod: Awaited<ReturnType<typeof eodStatus>> | null = null;
  if (isDbConfigured()) {
    try {
      const sql = await db();
      await sql`SELECT 1`;
      database = "ok";
      eod = await eodStatus().catch(() => null);
    } catch {
      database = "error";
    }
  }
  return json({
    ok: true,
    service: "tradestxpro",
    time: new Date().toISOString(),
    database,
    email: isMailConfigured() ? "ok" : "not_configured",
    marketData: "not_connected",
    brokerConnect: isVaultConfigured() ? "ok" : "not_configured",
    adminConfigured: Boolean(process.env.ADMIN_EMAILS?.trim()),
    endOfDay: eod,
  });
}

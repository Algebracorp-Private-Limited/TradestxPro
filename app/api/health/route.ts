import { db, isDbConfigured } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  if (isDbConfigured()) {
    try {
      const sql = await db();
      await sql`SELECT 1`;
      database = "ok";
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
  });
}

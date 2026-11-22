import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { fail, userHandler } from "@/lib/api";

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("; ") : v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** CSV export of the algo waitlist (admins only). */
export const GET = userHandler(async ({ user }) => {
  if (!isAdmin(user)) return fail("Not found.", 404);
  const sql = await db();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT created_at, name, email, phone, broker, experience, interests, capital, notes FROM algo_waitlist ORDER BY created_at`;
  const header = ["created_at", "name", "email", "phone", "broker", "experience", "interests", "capital", "notes"];
  const body = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h] instanceof Date ? (r[h] as Date).toISOString() : r[h])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="algo-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

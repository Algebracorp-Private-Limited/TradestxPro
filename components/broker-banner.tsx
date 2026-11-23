import Link from "next/link";
import { db } from "@/lib/db";
import { BROKER_BY_ID, type BrokerId } from "@/lib/brokers/catalog";

/** Tells the user, on every terminal page, when a broker session has expired so live data stopped. */
export async function BrokerBanner({ userId }: { userId: number }) {
  let rows: { broker: BrokerId; live: boolean; expired: boolean }[] = [];
  try {
    const sql = await db();
    rows = await sql<{ broker: BrokerId; live: boolean; expired: boolean }[]>`
      SELECT broker,
             (status = 'connected' AND session_enc IS NOT NULL AND (expires_at IS NULL OR expires_at > now())) AS live,
             (status = 'expired' OR (status = 'connected' AND expires_at IS NOT NULL AND expires_at <= now())) AS expired
        FROM broker_connections WHERE user_id = ${userId}`;
  } catch {
    return null;
  }
  const expired = rows.filter((r) => r.expired);
  if (rows.some((r) => r.live) || !expired.length) return null;
  const names = expired.map((r) => BROKER_BY_ID[r.broker]?.name ?? r.broker).join(", ");
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/40 bg-gold/10 px-4 py-2 text-sm">
      <span>
        <strong className="text-gold">{names} session expired.</strong>{" "}
        <span className="text-soft">Broker logins end each morning, so prices below are end-of-day. Log in again to get live data.</span>
      </span>
      <Link href="/brokers" className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-slate-200">Reconnect</Link>
    </div>
  );
}

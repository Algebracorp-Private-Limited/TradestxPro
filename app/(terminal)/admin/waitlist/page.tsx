import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { WAITLIST_GOAL } from "@/lib/waitlist";

export const metadata: Metadata = { title: "Algo waitlist (admin)" };

type Row = { created_at: Date; name: string; email: string; phone: string | null; broker: string | null; experience: string | null; interests: string[]; capital: string | null };

function tally(values: (string | null)[]) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v ?? "Not given", (m.get(v ?? "Not given") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function AdminWaitlist() {
  const user = await getSessionUser();
  if (!isAdmin(user)) notFound();
  const sql = await db();
  const rows = await sql<Row[]>`SELECT created_at, name, email, phone, broker, experience, interests, capital FROM algo_waitlist ORDER BY created_at DESC`;
  const [{ week }] = await sql<{ week: number }[]>`SELECT count(*)::int AS week FROM algo_waitlist WHERE created_at > now() - interval '7 days'`;
  const total = rows.length;
  const pct = Math.min(100, (total / WAITLIST_GOAL) * 100);

  const groups: [string, [string, number][]][] = [
    ["Broker", tally(rows.map((r) => r.broker))],
    ["Experience", tally(rows.map((r) => r.experience))],
    ["Capital", tally(rows.map((r) => r.capital))],
    ["Interests", tally(rows.flatMap((r) => (r.interests.length ? r.interests : [null])))],
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Algo trading waitlist</h1>
          <p className="mt-1 text-sm text-muted">Admin only. Goal: {WAITLIST_GOAL.toLocaleString("en-IN")} sign-ups before launch.</p>
        </div>
        <a href="/api/admin/waitlist" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Download CSV</a>
      </div>

      <section className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="font-mono text-4xl font-semibold">{total.toLocaleString("en-IN")}</p>
          <p className="text-sm text-muted">of {WAITLIST_GOAL.toLocaleString("en-IN")} · {week} in the last 7 days</p>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={total} aria-valuemin={0} aria-valuemax={WAITLIST_GOAL} aria-label="Progress to goal">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map(([title, items]) => (
          <div key={title} className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="mb-2 text-sm font-medium text-soft">{title}</h2>
            {items.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
              <ul className="space-y-1 text-sm">
                {items.map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-3"><span className="truncate text-muted">{k}</span><span className="font-mono">{n}</span></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium text-soft">Latest sign-ups</h2>
        {total === 0 ? <p className="p-6 text-sm text-muted">No sign-ups yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>{["Date", "Name", "Email", "Mobile", "Broker", "Experience", "Capital"].map((h) => <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.email}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{r.created_at.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2">{r.email}</td>
                    <td className="px-4 py-2 text-muted">{r.phone ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{r.broker ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{r.experience ?? "—"}</td>
                    <td className="px-4 py-2 text-muted">{r.capital ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

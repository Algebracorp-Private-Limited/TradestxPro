import type { ReactNode } from "react";

export function Code({ children, lang = "ts" }: { children: string; lang?: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-3 font-mono text-[12px] leading-relaxed text-soft" data-lang={lang}>
      <code>{children.trim()}</code>
    </pre>
  );
}

export function PageHead({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {lead && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{lead}</p>}
    </header>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-5 ${tone === "warn" ? "border-gold/40 bg-gold/10 text-gold" : "border-accent/30 bg-accent/5 text-soft"}`}>{children}</p>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-panel-2 text-xs text-muted">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="px-3 py-2 text-soft">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

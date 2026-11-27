import Link from "next/link";
import { PageHead, Note } from "./_components/ui";
import api from "./api-reference/api.json";

export const metadata = { title: "Overview" };

const CARDS = [
  { href: "/developers/getting-started", title: "Getting started", text: "Install the package, render a chart, load your data, use it from React, Next.js, Vue or Angular." },
  { href: "/developers/xchart", title: "XChart guide", text: "Series, chart types, 122 incremental indicators, drawings, scales, panes, sync, calendars, layouts, plugins, workers." },
  { href: "/developers/api-reference", title: "API reference", text: `${api.count} public exports, generated from the SDK's type declarations.` },
  { href: "/developers/examples", title: "Examples", text: "Interactive examples with their code: custom indicators, custom series, drawings, plugins, data adapters." },
  { href: "/developers/playground", title: "Playground", text: "Try chart types, indicators and scales on synthetic data; edit and load layouts safely." },
  { href: "/developers/market-data", title: "Market data", text: "Adapter contract, validation, time handling, and why SDK and data licences are separate." },
];

export default function DevelopersHome() {
  return (
    <>
      <PageHead
        title="XChart developer portal"
        lead="XChart is TradestXPro's financial charting SDK, rendered by our own canvas engine. It is packaged as @tradestxpro/xchart (ES modules, CommonJS, TypeScript declarations) and runs in any browser framework or none."
      />
      <Note tone="warn">
        Version {api.version}. The package is not on a public registry: it is distributed as a tarball to evaluators. Commercial licence terms are not yet
        published (see Licensing). No market data is included.
      </Note>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-2xl border border-line p-4 hover:border-accent/50 hover:bg-white/[0.02]">
            <h2 className="font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{c.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

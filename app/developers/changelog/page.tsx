import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PageHead } from "../_components/ui";

export const metadata = { title: "Changelog" };

function sections() {
  const text = readFileSync(join(process.cwd(), "packages/xchart/CHANGELOG.md"), "utf8");
  return text.split(/^## /m).slice(1).map((s) => {
    const [head, ...rest] = s.split("\n");
    return { version: head.trim(), body: rest.join("\n").trim() };
  });
}

export default function Changelog() {
  return (
    <>
      <PageHead title="Changelog" lead="Release notes of @tradestxpro/xchart." />
      <div className="space-y-6">
        {sections().map((s) => (
          <section key={s.version} className="rounded-2xl border border-line p-4">
            <h2 className="font-mono text-lg font-semibold">{s.version}</h2>
            <div className="mt-2 space-y-1 text-sm leading-6 text-soft">
              {s.body.split(/\n(?=- )|\n\n/).map((p, i) => <p key={i}>{p.replace(/^- /, "• ").replace(/\n/g, " ")}</p>)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

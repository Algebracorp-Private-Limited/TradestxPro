import { Code, Note, PageHead, Section, Table } from "../_components/ui";

export const metadata = { title: "Getting started" };

export default function GettingStarted() {
  return (
    <>
      <PageHead title="Getting started" lead="Install the package, render a chart in a container, feed it bars, and update it live." />
      <Section title="1. Install">
        <Code lang="bash">{`npm install ./tradestxpro-xchart-0.4.0.tgz`}</Code>
        <p className="text-sm text-muted">The tarball is provided with your evaluation agreement. It has no runtime dependencies; React is an optional peer dependency for the React bindings.</p>
      </Section>
      <Section title="2. Render a chart">
        <Code>{`
import { createChart } from "@tradestxpro/xchart";

const chart = createChart(document.getElementById("chart")!, { theme: "dark", timeZone: "Asia/Kolkata" });
const candles = chart.addCandlestickSeries();
candles.setData(bars);               // [{ time, open, high, low, close, volume }], time in UTC seconds, ascending
chart.addIndicator("ema", { length: 20 });
chart.addIndicator("rsi");`}</Code>
        <p className="text-sm text-muted">The chart fills its container and follows its size. Call <code>chart.remove()</code> when you are done: it releases the canvas, listeners and observers.</p>
      </Section>
      <Section title="3. Live updates">
        <Code>{`
candles.update({ time: lastBar.time, open, high, low, close: lastPrice, volume });   // same time: replaces the live bar
candles.update({ time: lastBar.time + 60, open: p, high: p, low: p, close: p });       // later time: appends a bar`}</Code>
        <p className="text-sm text-muted">All 122 built-in indicators update incrementally (O(1)–O(window) per tick), with results identical to a full recalculation.</p>
      </Section>
      <Section title="4. Frameworks">
        <Table
          head={["Environment", "How"]}
          rows={[
            ["Plain JavaScript", <code key="v">{`import { createChart } from "./node_modules/@tradestxpro/xchart/dist/esm/index.js"`}</code>],
            ["React", <code key="r">{`import { XChart, useXChart } from "@tradestxpro/xchart/react"`}</code>],
            ["Next.js", "Use the React bindings in a \"use client\" component. Importing the package on the server is safe (no DOM access at import)."],
            ["Vue 3", "Create the chart in onMounted and call chart.remove() in onBeforeUnmount."],
            ["Angular", "Create the chart in ngAfterViewInit (guard with isPlatformBrowser under SSR) and remove it in ngOnDestroy."],
            ["Node (server)", "Import to compute indicators or price-based charts without a DOM; createChart needs a browser."],
          ]}
        />
        <Code lang="tsx">{`
"use client";
import { XChart } from "@tradestxpro/xchart/react";

export function PriceChart({ bars }: { bars: CandlestickData[] }) {
  return <XChart style={{ height: 420 }} options={{ theme: "dark" }} onReady={(chart) => { chart.addCandlestickSeries().setData(bars); }} />;
}`}</Code>
        <Note>
          These integrations are verified by the package integration test (tarball installed into separate projects): Node ESM and CommonJS, TypeScript
          (NodeNext and Bundler resolution), plain ES modules with a module Web Worker, Vue 3, and a Next.js App Router build with server rendering. The
          Angular component is a reference example and is not built in CI.
        </Note>
      </Section>
      <Section title="5. Module formats">
        <Table
          head={["Entry", "ESM", "CommonJS", "Types"]}
          rows={[
            ["@tradestxpro/xchart", "dist/esm/index.js", "dist/cjs/index.js", "dist/types/index.d.ts"],
            ["@tradestxpro/xchart/react", "dist/esm/react.js", "dist/cjs/react.js", "dist/types/react.d.ts"],
            ["@tradestxpro/xchart/worker", "dist/esm/workers/indicator-worker.js", "—", "✓"],
          ]}
        />
        <p className="text-sm text-muted">
          <code>sideEffects: false</code> lets bundlers drop unused modules. The indicator worker starts as a module worker from the ES build; from CommonJS (or
          bundlers without <code>new URL(…, import.meta.url)</code> support) pass <code>createWorker</code>, otherwise work runs on the main thread.
        </p>
      </Section>
    </>
  );
}

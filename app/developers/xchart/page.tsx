import Link from "next/link";
import { Code, Note, PageHead, Section, Table } from "../_components/ui";

export const metadata = { title: "XChart guide" };

export default function XChartGuide() {
  return (
    <>
      <PageHead title="XChart guide" lead="What the SDK does and how its parts fit together. Every capability listed here is in the v0.4.0 package." />
      <Section title="Architecture">
        <Code lang="text">{`
Your app → XChart SDK (createChart, series, indicators, drawings, layouts, plugins)
         → SeriesStore (one shared time axis; your OHLCV is never modified)
         → Canvas adapter (layers, interaction)
         → TradestXPro canvas engine (rendering, pan/zoom, panes, crosshair)`}</Code>
      </Section>
      <Section title="Series and chart types">
        <Table head={["Kind", "API"]} rows={[
          ["Candles, line, area, histogram, cloud", "addCandlestickSeries, addLineSeries, addAreaSeries, addHistogramSeries, addCloudSeries"],
          ["Time-based types", "setChartType: candles, hollow-candles, bars, heikin-ashi, line, step-line, line-markers, area, baseline, high-low, columns"],
          ["Price-based types", "setChartType: renko, kagi, point-and-figure, line-break, range-bars — on a logical axis; getDerivedInfo() explains the method"],
          ["Markers and price lines", "series.setMarkers, series.createPriceLine"],
        ]} />
      </Section>
      <Section title="Indicators">
        <p className="text-sm text-muted">122 built-ins in six categories (trend, momentum, volatility, volume, statistics, structure), each with formula metadata, evaluated incrementally and exactly. Search with <code>chart.searchIndicators()</code>; check data requirements with <code>chart.indicatorCompatibility(id)</code>.</p>
        <Code>{`
chart.addIndicator("supertrend", { length: 10, mult: 3 });
chart.searchIndicators({ category: "Volatility" });
chart.registerIndicator(myDefinition);   // custom: params schema, outputs, calculate(), optional stream()`}</Code>
      </Section>
      <Section title="Drawings">
        <p className="text-sm text-muted">27 tools (lines, channels, Fibonacci, Gann, patterns, shapes, text, measurement) on any pane; pointer and touch creation, snapping, undo/redo, serialisation. Custom tools through plugins.</p>
      </Section>
      <Section title="Scales, panes and synchronisation">
        <p className="text-sm text-muted">Every price scale (right, left, overlay, pane) has its own mode (normal, logarithmic, percentage, indexed), inversion, manual range and margins. Panes can be added, resized, collapsed and reordered. <code>syncCharts()</code> aligns time ranges and crosshairs by time.</p>
      </Section>
      <Section title="Calendars and time zones">
        <p className="text-sm text-muted">Built-in session definitions (NSE, BSE, MCX, NYSE, NASDAQ, FOREX, CRYPTO) and IANA time zones. Holidays come from calendar datasets you load (none are bundled); dates no dataset covers are reported as unknown.</p>
      </Section>
      <Section title="Layouts, plugins and workers">
        <Table head={["Feature", "Notes"]} rows={[
          ["Layouts", "saveLayout() / loadLayout(): plain JSON, size- and depth-limited, validated, atomic. Never contains code or credentials."],
          ["Plugins", "chart.use(plugin): canvas layers, custom indicators and drawing tools. Plugins are trusted code (not sandboxed); errors are isolated and reported."],
          ["Worker", "IndicatorWorkerClient: full-history calculations off the main thread with coalescing, staleness checks and cancellation."],
        ]} />
      </Section>
      <Section title="Performance and compatibility">
        <p className="text-sm text-muted">Live update at 100,000 candles with 20 indicators: 3.6 ms median, 5.3 ms p95 (Chromium 153, 4 vCPU). Tested in Chromium 153, Firefox 155 and WebKit 26.6. Details in the release notes and the <Link className="text-accent" href="/developers/changelog">changelog</Link>.</p>
        <Note>Known limitations: price-based types are built from candles (intrabar order assumed and flagged); the worker computes the 22 original built-ins only; volume profile is not implemented.</Note>
      </Section>
    </>
  );
}

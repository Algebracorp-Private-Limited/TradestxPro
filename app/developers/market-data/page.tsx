import { Code, Note, PageHead, Section, Table } from "../_components/ui";

export const metadata = { title: "Market data" };

export default function MarketData() {
  return (
    <>
      <PageHead title="Market data" lead="XChart draws the data you give it. It does not fetch, store or redistribute market data." />
      <Section title="Licences are separate">
        <Note tone="warn">
          An XChart licence covers the software only. It grants no rights to exchange or vendor market data. Real-time, delayed and end-of-day data each
          have their own licensing and redistribution terms with the exchange or your data vendor; you are responsible for complying with them.
        </Note>
      </Section>
      <Section title="Adapter contract">
        <Table head={["Field", "Type", "Rule"]} rows={[
          ["time", "number", "UTC seconds; strictly ascending; one bar per time. Daily bars: 00:00 UTC of the trading date."],
          ["open, high, low, close", "number", "Finite; low ≤ open, close ≤ high."],
          ["volume", "number (optional)", "Finite, ≥ 0. Missing volume disables volume-based indicators (reported, not guessed)."],
        ]} />
        <Code>{`
// Convert your feed once, at the edge:
const toBars = (rows) => rows.map((r) => ({ time: Date.parse(r.timestamp) / 1000, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
candles.setData(toBars(history));          // throws XChartError (code, message) on the first invalid bar
validateBars("candlestick", toBars(rows));  // validate without drawing`}</Code>
      </Section>
      <Section title="Integrity rules">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Nothing is repaired or invented: missing bars stay gaps, chart types and indicators are views over your data.</li>
          <li>Invalid input throws before any state changes (atomic): a bad update never leaves a half-applied chart.</li>
          <li>Show your users the data&apos;s source, timestamp and whether it is real-time, delayed or end-of-day; XChart does not know which it is.</li>
        </ul>
      </Section>
      <Section title="Live feeds">
        <Code>{`
socket.onmessage = (m) => {
  const t = JSON.parse(m.data);                                       // your tick format
  const bucket = Math.floor(t.ts / 60) * 60;                           // 1-minute bars
  candles.update(bucket === last.time ? merge(last, t.price) : open(bucket, t.price));
};`}</Code>
        <p className="text-sm text-muted">Updates are coalesced into one frame; any number of ticks per second costs one redraw.</p>
      </Section>
    </>
  );
}

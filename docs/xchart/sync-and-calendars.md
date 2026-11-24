# Synchronisation, calendars, sessions and time zones

## Synchronised charts

```ts
import { syncCharts } from "@/lib/xchart-sdk";
const group = syncCharts([chartA, chartB], { timeRange: true, crosshair: true, crosshairPrice: false });
group.add(chartC); group.remove(chartB); group.charts(); group.destroy();
```

* Alignment is by **time**: charts may have different histories or bar sets; each maps the shared
  time range/crosshair time onto its own bars.
* Echo suppression prevents feedback loops; a removed chart leaves its group automatically.
* `crosshairPrice` mirrors the price line too (off by default: prices differ between symbols).
* Lower level: `chart.setCrosshairPosition(time, price?)` / `chart.clearCrosshairPosition()` show
  a crosshair while the pointer is elsewhere.

## Trading calendars

```ts
import { TradingCalendar, holidayList } from "@/lib/xchart-sdk";
const nse = new TradingCalendar("NSE", holidayList({ NSE: ["2026-01-26"] }, { NSE: { "2026-11-08": "18:15" } }));
nse.sessionAt(t);          // "pre" | "regular" | "post" | "closed"
nse.isOpen(t, /*extended*/ false);
nse.isTradingDay("2026-03-02");
nse.regularBounds("2026-03-02"); // { open, close } UTC seconds
nse.nextOpen(t);  nse.tradingDaysBetween("2026-03-01", "2026-03-31");  nse.localDate(t);
```

| Id | Zone | Sessions (local) |
|---|---|---|
| NSE, BSE | Asia/Kolkata | pre-open 09:00–09:15, regular 09:15–15:30, closing 15:40–16:00, Mon–Fri |
| MCX | Asia/Kolkata | 09:00–23:30, **23:55 while US daylight saving is in effect** (non-agri) |
| NYSE, NASDAQ | America/New_York | pre 04:00–09:30, regular 09:30–16:00, post 16:00–20:00 |
| FOREX | America/New_York | Sun 17:00 → Fri 17:00 continuous |
| CRYPTO | UTC | 24/7 |

* Time-zone conversion uses `Intl` with IANA zones, so daylight saving is exact (tested across the
  2026 US change).
* **No holiday lists are bundled** — they change yearly and a stale list is wrong data. Pass a
  `HolidayProvider` (or `holidayList(...)`) built from the exchange's published calendar.
* Custom calendars: `new TradingCalendar({ id, name, timeZone, week: { 1: [{ kind: "regular", start: "10:00", end: "17:00" }], … }, adjust? })`.

## Session shading

```ts
chart.setSessionHighlight({ calendar: "NSE", preColor, postColor, closedColor, dayBreaks: true });
chart.setSessionHighlight(null);
```

Intraday charts only: pre/post/closed bars get a background tint and day breaks a dotted line.
View-only.

## Time zones

```ts
createChart(el, { timeZone: "America/New_York", locale: "en-US" });
chart.applyOptions({ timeZone: "Asia/Kolkata" });
```

Intraday labels follow the IANA zone (DST-aware). Daily bars are calendar dates (00:00 UTC) and
are always labelled as dates. Without `timeZone`, `utcOffsetMinutes` (default 330 = IST) applies.
Times in the API remain UTC seconds.

# Calendar providers

Exchange holidays, special sessions and early closes change every year and are published by the
exchanges. XChart **does not bundle or hard-code any of them**: they are supplied as versioned,
attributed **datasets** through providers. A date that no provider covers is reported as
`"unknown"`, never assumed to be a trading day.

## Dataset format (`xchart-calendar`, version 1)

```json
{
  "format": "xchart-calendar",
  "version": 1,
  "revision": "2026.1",
  "provider": {
    "id": "my-nse-calendar",
    "name": "NSE trading holidays",
    "source": { "name": "NSE circular …", "url": "https://…" },
    "retrievedAt": "2026-01-05",
    "validUntil": "2026-12-31",
    "license": "…",
    "notes": "…"
  },
  "calendars": {
    "NSE": {
      "coverage": { "from": "2026-01-01", "to": "2026-12-31" },
      "holidays": [{ "date": "2026-01-26", "name": "Republic Day" }],
      "earlyCloses": [{ "date": "…", "close": "13:00", "name": "…" }],
      "specialSessions": [{ "date": "…", "name": "Muhurat trading", "sessions": [{ "kind": "regular", "start": "18:00", "end": "19:00" }] }]
    }
  }
}
```

The values above are placeholders: take real dates from the exchange's own publication and record
where they came from in `provider.source`.

`importCalendarDataset(jsonOrObject)` validates everything before returning a provider and throws
`XChartError("INVALID_CALENDAR")` otherwise: format/version, a revision, provider id/name/source and
`retrievedAt`, `YYYY-MM-DD` dates (holidays inside the coverage), `HH:MM` times, session kinds,
duplicate holidays, a date that is both a holiday and an early close or special session, coverage
`from ≤ to`, safe calendar ids (no `__proto__` / `constructor` / `prototype`), and size (≤ 2 MB of
JSON).

## Registry

```ts
import { CalendarRegistry, TradingCalendar } from "@/lib/xchart-sdk";
const reg = new CalendarRegistry();
reg.register(datasetJson);                                  // or a CalendarProvider object
await reg.load("my-nse-calendar", () => fetch(url).then((r) => r.json()));
reg.status("my-nse-calendar");  // { state: "ok" | "stale" | "failed", revision, retrievedAt, validUntil, source, error? }
const nse = new TradingCalendar("NSE", reg);
nse.dayStatus("2026-01-26");    // { status: "non-trading", reason: "Republic Day", source: "my-nse-calendar@2026.1" }
nse.dayStatus("2030-03-04");    // { status: "unknown", reason: "No calendar provider covers this date: holidays are unverified" }
```

* `load` keeps the previous dataset when the loader fails (`state: "stale"` with the error), so a
  network failure never removes known holidays. A dataset past `validUntil` is also `stale`.
* Providers are consulted in registration order; the first that `covers(calendar, date)` answers.
* Plain `HolidayProvider`s / `holidayList(...)` (v0.3) still work and are treated as covering every
  date they are asked about (the caller vouches for them).
* `sessions(date)`, `isTradingDay`, `nextOpen`, `regularBounds`, `tradingDaysBetween` and session
  shading all apply holidays, special sessions (which replace the weekly sessions on that date) and
  early closes from the provider.

## dayStatus

| status | When |
|---|---|
| `trading` | A provider covers the date and it is a weekday with sessions, or a listed special session |
| `non-trading` | A provider lists a holiday; or the weekly schedule has no session (weekend) |
| `unknown` | A weekday that no provider covers: the holiday status is unverified |

`source` names the provider and revision that confirmed the answer; `special: true` marks special
sessions.

## Overnight sessions

A session whose `end` is earlier than its `start` (e.g. `{ start: "17:00", end: "02:00" }`) runs
past midnight and belongs to the local date on which it **starts**. `sessionAt`, `isOpen` and
session shading handle the part after midnight.

## Why nothing is bundled

* A stale holiday list is wrong market data: it would silently mark trading days as closed (or the
  reverse) and corrupt session shading, `tradingDaysBetween` and any analytics built on them.
* No paid calendar-data source is used. Applications load the exchange's published calendar (or a
  licensed feed) into a dataset and keep the attribution in `provider`.

## Limitations

* No bundled datasets: `dayStatus` is `unknown` for weekdays until a provider is registered.
* One dataset per provider id; updates replace the whole dataset (by `revision`).
* MCX agricultural contract hours need a custom calendar definition.

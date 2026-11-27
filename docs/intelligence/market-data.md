# Market data and instrument master

## Capability register

`lib/intelligence/market-data/capabilities.ts` lists every data kind the engines may request with its
availability (`yes | with-broker | partial | no`), source, freshness and entitlement. Summary:

| Available | Kinds |
|---|---|
| Yes (EOD, public files) | historical daily OHLCV, volume, OI and OI change (latest F&O session), market breadth, index constituents (current) |
| With the user's broker | real-time equity/index quotes, live option chain with bid/ask, broker IV and Greeks |
| Partial | futures prices (latest session / broker), IV and Greeks (broker or computed and labelled), per-underlying OI history, calendars (no holiday data bundled) |
| **No** | intraday bar history, option premium history, IV history, corporate actions, financial statements, announcements, earnings events, margin (SPAN/exposure) |

Consequences: intraday setups are not generated without a live broker session; IV rank/percentile is
not shown; Investment AI returns INSUFFICIENT DATA; margin-dependent plans are "not
execution-validated"; option premium charts (the option workspace) need a connected broker to show observed history.

## Freshness

| Class | Rule |
|---|---|
| real-time | broker/stream quote ≤ 120 s old while NSE is open |
| delayed | older quote from the current session, or a delayed feed |
| eod | end-of-day record of the most recent completed NSE session |
| stale | anything older |
| unknown | no or invalid exchange timestamp, synthetic data |

The NSE calendar knows weekends and session hours; holidays need a loaded calendar dataset, and EOD
classifications note that holidays are unverified otherwise.

## Instrument master

`instruments/master.ts` normalises the synced reference data (ICICI security master and NSE index
files) into one `Instrument` type with canonical ids:

`NSE:RELIANCE` · `NSEIDX:NIFTY 50` · `NFO:FUT:RELIANCE:2026-12-29` · `NFO:OPT:NIFTY:2026-12-29:24000:CE`

Lot size, tick size, expiry and strike come only from that data (nothing hard-coded). Settlement:
index derivatives cash, stock derivatives physical (SEBI, since October 2019). Expiry time 15:30 IST.
Reported as unavailable: corporate actions, F&O ban list, historical instrument definitions.
`resolveInstrument` returns null for contracts that do not exist (the AI-output validator uses it).
`resolveUniverse` unions index constituents with deduplication, reports overlap counts and lists
indices without constituent data instead of skipping them silently.

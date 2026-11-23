# TradestXPro XChart SDK — foundation (v0.1)

This is the first **non-rendering** SDK milestone, implemented separately from the existing chart engine.

## Included
- Framework-independent chart, series, candle and crosshair TypeScript interfaces.
- Explicit Unix-second timestamps and strict OHLCV / chronological validation.
- Unit tests for invalid market-data inputs.

## Not implemented yet
- `createChart()` runtime or Canvas adapter.
- Indicator/cloud series, streaming subscriptions, drawing API, layout persistence.
- Publishing an npm package or making an external API available.

## Integration sequence
1. Finish and review Claude's XChart visual work.
2. Implement a Canvas adapter using the existing `components/chart/engine.ts` without duplicating rendering code.
3. Add lifecycle, series data updates and crosshair subscriptions.
4. Implement cloud/indicator adapters, drawings, and layout persistence.
5. Benchmark and test before public package release.

Do not use this module for production chart rendering until the adapter exists.

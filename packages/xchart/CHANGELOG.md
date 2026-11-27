# Changelog

## 0.4.0

- Standalone package `@tradestxpro/xchart`: ES modules, CommonJS, type declarations, `sideEffects: false`.
- React bindings: `XChart` component and `useXChart` hook (`@tradestxpro/xchart/react`), SSR-safe.
- Examples: plain JavaScript, Node SSR (ESM and CJS), TypeScript, Next.js, Vue 3, Angular.
- Worker entry `@tradestxpro/xchart/worker`; CommonJS falls back to main-thread computation.

## 0.3.1

Price-based chart types rendered on a logical axis; incremental indicator engine (122 indicators);
indicator Web Worker; independent price scales; drawings on any pane; calendar providers;
Chromium/Firefox/WebKit CI.

## 0.3.0

Indicators and registries, cloud series, 27 drawing tools, markers, price lines, overlay/left scales,
panes, synchronisation, trading calendars, time-based chart types, layouts, plugins, typed events.

## 0.2.1

Market-data integrity (strict/tolerant validation with reports), lifecycle and crosshair fixes.

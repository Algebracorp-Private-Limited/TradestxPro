/* eslint-disable @typescript-eslint/no-require-imports -- this example demonstrates CommonJS consumers */
// CommonJS consumers (require). Same API; module workers are not available from the CJS build.
const { ALL_BUILTIN_INDICATORS, IndicatorWorkerClient, XCHART_VERSION } = require("@tradestxpro/xchart");
const client = new IndicatorWorkerClient();
console.log(JSON.stringify({ version: XCHART_VERSION, indicators: ALL_BUILTIN_INDICATORS.length, usesWorker: client.usesWorker, fallback: client.fallbackReason }));

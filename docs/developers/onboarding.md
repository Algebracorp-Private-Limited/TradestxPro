# Developer onboarding and portal

Public portal (no login required except the account console): `/developers`.

| Route | Content | Source of truth |
|---|---|---|
| `/developers` | Overview | — |
| `/developers/getting-started` | Install, first chart, live updates, frameworks, module formats | package README |
| `/developers/xchart` | Feature guide | `docs/xchart/` |
| `/developers/api-reference` | All public exports with exact signatures | generated: `scripts/xchart-api-reference.mjs` → `app/developers/api-reference/api.json` (TypeScript compiler API over `lib/xchart-sdk/index.ts`; a unit test fails when it is stale) |
| `/developers/examples` | 8 interactive examples with code: live updates, custom indicator, custom series (cloud, markers, price lines), drawings, plugin, data adapter with validation, price-based types, multi-chart sync | runs the SDK in the page |
| `/developers/playground` | Controlled playground: data set, chart type, theme, scale mode, indicator picker (122), layout JSON save/edit/load | no code execution: only validated SDK calls; layouts go through `loadLayout` (size/depth limits, key allow-list, prototype-pollution checks, atomic) |
| `/developers/market-data` | Adapter contract, validation, live feeds, data vs software licensing | — |
| `/developers/changelog` | Release notes | `packages/xchart/CHANGELOG.md` (read at build) |
| `/developers/licensing` | Draft licence model (not binding, nothing for sale) | — |
| `/developers/account` | Developer account console (when activated) and the prepared architecture | `lib/developers/accounts.ts` |

All demo prices are synthetic and labelled as such.

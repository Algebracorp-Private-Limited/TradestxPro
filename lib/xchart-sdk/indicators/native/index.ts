/** All native indicators (catalog expansion, v0.3.1). */
import { TREND, MOMENTUM } from "./trend-momentum.ts";
import { VOLATILITY, VOLUME } from "./volatility-volume.ts";
import { STATISTICS, STRUCTURE } from "./statistics-structure.ts";
export type { CatalogMeta, Category, NativeDefinition } from "./define.ts";
export const NATIVE_INDICATORS = [...TREND, ...MOMENTUM, ...VOLATILITY, ...VOLUME, ...STATISTICS, ...STRUCTURE];

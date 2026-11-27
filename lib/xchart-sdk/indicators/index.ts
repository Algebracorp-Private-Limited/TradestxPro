/** XChart indicator subsystem: definitions, registry, runtime. */
import { IndicatorRegistry } from "./registry.ts";
import { BUILTIN_INDICATORS } from "./builtins.ts";
import { NATIVE_INDICATORS } from "./native/index.ts";
import type { IndicatorDefinition } from "./types.ts";

export * from "./types.ts";
export { IndicatorRegistry } from "./registry.ts";
export { BUILTIN_INDICATORS } from "./builtins.ts";
export { NATIVE_INDICATORS } from "./native/index.ts";
/** Every built-in definition: the 22 catalogue wrappers and the native v0.3.1 indicators. */
export const ALL_BUILTIN_INDICATORS: IndicatorDefinition[] = [...BUILTIN_INDICATORS, ...NATIVE_INDICATORS];
export { resolveParams, validateDefinition } from "./validation.ts";

/** Built-in definitions (read-only). */
export const builtinRegistry = new IndicatorRegistry(null, [...BUILTIN_INDICATORS, ...NATIVE_INDICATORS]);
/** Shared registry for application-wide custom indicators (charts also have their own). */
export const defaultRegistry = new IndicatorRegistry(builtinRegistry);

export function registerIndicator(def: IndicatorDefinition): void {
  defaultRegistry.register(def);
}
export function unregisterIndicator(id: string): boolean {
  return defaultRegistry.unregister(id);
}
export function listIndicators(): IndicatorDefinition[] {
  return defaultRegistry.list();
}
export function getIndicatorDefinition(id: string): IndicatorDefinition | undefined {
  return defaultRegistry.get(id);
}

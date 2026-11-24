import { XChartError } from "../validation.ts";
import type { IndicatorDefinition } from "./types.ts";
import { validateDefinition } from "./validation.ts";

/**
 * A set of indicator definitions. Charts look up ids in their own registry first, then the
 * shared default registry, then the built-ins. Built-ins cannot be replaced or removed.
 */
export class IndicatorRegistry {
  private defs = new Map<string, IndicatorDefinition>();
  private parent: IndicatorRegistry | null;
  private locked: Set<string>;

  constructor(parent: IndicatorRegistry | null = null, builtins: IndicatorDefinition[] = []) {
    this.parent = parent;
    for (const d of builtins) this.defs.set(d.id, d);
    this.locked = new Set(builtins.map((d) => d.id));
  }

  register(def: IndicatorDefinition): void {
    validateDefinition(def);
    if (this.has(def.id)) throw new XChartError("DUPLICATE_INDICATOR", `An indicator with id "${def.id}" is already registered`);
    this.defs.set(def.id, Object.freeze({ ...def }) as IndicatorDefinition);
  }

  /** True when the id is a built-in here or in a parent registry. */
  isBuiltin(id: string): boolean {
    return this.locked.has(id) || Boolean(this.parent?.isBuiltin(id));
  }

  unregister(id: string): boolean {
    if (this.isBuiltin(id)) throw new XChartError("BUILTIN_INDICATOR", `Built-in indicator "${id}" cannot be unregistered`);
    return this.defs.delete(id);
  }

  get(id: string): IndicatorDefinition | undefined {
    return this.defs.get(id) ?? this.parent?.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id) || Boolean(this.parent?.has(id));
  }

  list(): IndicatorDefinition[] {
    const seen = new Map<string, IndicatorDefinition>();
    for (const d of this.parent?.list() ?? []) seen.set(d.id, d);
    for (const d of this.defs.values()) seen.set(d.id, d);
    return [...seen.values()];
  }
}

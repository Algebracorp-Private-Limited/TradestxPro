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

  /**
   * Discovery: filters by text (id, name, description), category, required data, incremental
   * support and parameter names. All criteria are optional and combined with AND.
   */
  search(q: { text?: string; category?: string; requires?: string; incremental?: boolean; param?: string } = {}): IndicatorDefinition[] {
    const t = q.text?.trim().toLowerCase();
    return this.list().filter((d) => {
      if (t && !`${d.id} ${d.name} ${d.description}`.toLowerCase().includes(t)) return false;
      if (q.category && (d.category ?? "").toLowerCase() !== q.category.toLowerCase()) return false;
      if (q.requires && !(d.requires ?? []).includes(q.requires)) return false;
      if (q.incremental !== undefined && Boolean(d.stream) !== q.incremental) return false;
      if (q.param && !d.params.some((p) => p.key === q.param)) return false;
      return true;
    });
  }

  /** Categories present, with counts. */
  categories(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of this.list()) out[d.category ?? "Other"] = (out[d.category ?? "Other"] ?? 0) + 1;
    return out;
  }

  /**
   * Whether an indicator can run on given data. Reports every missing requirement (volume,
   * benchmark, session time on price-based charts) instead of silently producing wrong values.
   */
  compatibility(id: string, ctx: { hasVolume?: boolean; hasBenchmark?: boolean; derived?: boolean } = {}): { ok: boolean; reasons: string[] } {
    const d = this.get(id);
    if (!d) return { ok: false, reasons: [`Unknown indicator "${id}"`] };
    const req = d.requires ?? [];
    const reasons: string[] = [];
    if (req.includes("volume") && ctx.hasVolume === false) reasons.push("needs volume, and this data has none");
    if (req.includes("benchmark") && !ctx.hasBenchmark) reasons.push("needs a benchmark series (chart.setBenchmarkSeries)");
    if (ctx.derived && (req.includes("volume") || req.includes("time"))) reasons.push("needs volume or session time, which price-based (Renko, Kagi, …) charts do not have");
    return { ok: reasons.length === 0, reasons };
  }

  list(): IndicatorDefinition[] {
    const seen = new Map<string, IndicatorDefinition>();
    for (const d of this.parent?.list() ?? []) seen.set(d.id, d);
    for (const d of this.defs.values()) seen.set(d.id, d);
    return [...seen.values()];
  }
}

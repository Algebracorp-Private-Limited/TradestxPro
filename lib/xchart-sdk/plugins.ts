/**
 * Plugins: trusted extensions that add layers, indicators, drawing tools and event handlers to
 * ONE chart through a controlled context.
 *
 * Security model: plugins are ordinary JavaScript running with the page's privileges — they are
 * NOT sandboxed. Only install plugins you trust (your own code or reviewed packages). The SDK
 * never loads or evaluates plugin code from strings, URLs or layouts; a layout can only name
 * plugins, and the application decides whether to install them.
 *
 * What the context guarantees: every registration is tracked and undone by removePlugin() or
 * chart.remove(); a failing install is rolled back; a throwing layer only skips that layer.
 */
import type { EngineLayer, LayerApi } from "../../components/chart/engine.ts";
import type { ToolSpec } from "./drawings/tools.ts";
import type { ChartEvents } from "./events/types.ts";
import type { IndicatorDefinition } from "./indicators/types.ts";
import type { ChartApi, Unsubscribe } from "./types.ts";

export type PluginLayer = { pane?: string; z?: "below" | "above"; draw(api: LayerApi): void };

export interface PluginContext {
  readonly chart: ChartApi;
  addLayer(layer: PluginLayer): Unsubscribe;
  registerIndicator(definition: IndicatorDefinition): void;
  registerDrawingTool(type: string, tool: ToolSpec): void;
  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): Unsubscribe;
  requestRedraw(): void;
}

export interface XChartPlugin {
  /** Unique per chart: 1–64 letters, digits, . _ - or /. */
  id: string;
  version?: string;
  install(ctx: PluginContext): void | { destroy?(): void };
}

export type PluginInfo = { id: string; version?: string; layers: number; indicators: string[]; tools: string[] };

/** What the chart exposes to the plugin host (kept narrow on purpose). */
export type PluginHost = {
  chart: ChartApi;
  setLayers(layers: EngineLayer[]): void;
  registerIndicator(def: IndicatorDefinition): void;
  unregisterIndicator(id: string): void;
  removeIndicatorsOfType(id: string): void;
  registerTool(type: string, spec: ToolSpec): void;
  unregisterTool(type: string): void;
  removeDrawingsOfType(type: string): void;
  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): Unsubscribe;
  emitError(pluginId: string, error: string): void;
  redraw(): void;
};

type Record_ = { plugin: XChartPlugin; layers: EngineLayer[]; indicators: string[]; tools: string[]; offs: Unsubscribe[]; destroy?: () => void; failedOnce: boolean };

export const PLUGIN_ID = /^[A-Za-z0-9._/-]{1,64}$/;

export class PluginManager {
  private host: PluginHost;
  private installed = new Map<string, Record_>();
  constructor(host: PluginHost) {
    this.host = host;
  }

  private pushLayers() {
    const all: EngineLayer[] = [];
    for (const r of this.installed.values()) all.push(...r.layers);
    this.host.setLayers(all);
  }

  install(plugin: XChartPlugin): void {
    if (!plugin || typeof plugin !== "object" || typeof plugin.install !== "function" || typeof plugin.id !== "string" || !PLUGIN_ID.test(plugin.id)) {
      throw new Error("A plugin needs an id (1–64 letters, digits, . _ - /) and an install(ctx) function");
    }
    if (this.installed.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" is already installed on this chart`);
    const rec: Record_ = { plugin, layers: [], indicators: [], tools: [], offs: [], failedOnce: false };
    let active = true;
    const guard = () => {
      if (!active) throw new Error(`Plugin "${plugin.id}" was removed`);
    };
    const ctx: PluginContext = {
      chart: this.host.chart,
      addLayer: (layer) => {
        guard();
        if (!layer || typeof layer.draw !== "function") throw new Error("addLayer needs { draw(api) }");
        if (layer.z !== undefined && layer.z !== "below" && layer.z !== "above") throw new Error('layer z must be "below" or "above"');
        const wrapped: EngineLayer = {
          pane: layer.pane ?? "main",
          z: layer.z ?? "above",
          draw: (api) => {
            try {
              layer.draw(api);
            } catch (e) {
              // Report the first failure per plugin; later frames stay quiet but still skip the layer.
              if (!rec.failedOnce) {
                rec.failedOnce = true;
                this.host.emitError(plugin.id, (e as Error)?.message ?? String(e));
              }
            }
          },
        };
        rec.layers.push(wrapped);
        if (this.installed.has(plugin.id)) this.pushLayers();
        let on = true;
        return () => {
          if (!on) return;
          on = false;
          rec.layers = rec.layers.filter((l) => l !== wrapped);
          this.pushLayers();
        };
      },
      registerIndicator: (def) => {
        guard();
        this.host.registerIndicator(def);
        rec.indicators.push(def.id);
      },
      registerDrawingTool: (type, tool) => {
        guard();
        this.host.registerTool(type, tool);
        rec.tools.push(type);
      },
      on: (type, handler) => {
        guard();
        const off = this.host.on(type, (p) => {
          try {
            handler(p);
          } catch (e) {
            this.host.emitError(plugin.id, (e as Error)?.message ?? String(e));
          }
        });
        rec.offs.push(off);
        return off;
      },
      requestRedraw: () => {
        if (active) this.host.redraw();
      },
    };
    try {
      const result = plugin.install(ctx);
      if (result && typeof result === "object" && typeof result.destroy === "function") rec.destroy = () => result.destroy!();
    } catch (e) {
      active = false;
      this.cleanup(rec);
      throw new Error(`Plugin "${plugin.id}" failed to install: ${(e as Error)?.message ?? String(e)}`);
    }
    this.installed.set(plugin.id, rec);
    (rec as Record_ & { deactivate?: () => void }).deactivate = () => (active = false);
    this.pushLayers();
  }

  private cleanup(rec: Record_) {
    for (const off of rec.offs) off();
    for (const t of rec.tools) {
      try {
        this.host.removeDrawingsOfType(t);
        this.host.unregisterTool(t);
      } catch {
        /* already gone */
      }
    }
    for (const id of rec.indicators) {
      try {
        this.host.removeIndicatorsOfType(id);
        this.host.unregisterIndicator(id);
      } catch {
        /* already gone */
      }
    }
    rec.layers = [];
    rec.offs = [];
  }

  remove(id: string): boolean {
    const rec = this.installed.get(id);
    if (!rec) return false;
    this.installed.delete(id);
    (rec as Record_ & { deactivate?: () => void }).deactivate?.();
    try {
      rec.destroy?.();
    } catch (e) {
      this.host.emitError(id, (e as Error)?.message ?? String(e));
    }
    this.cleanup(rec);
    this.pushLayers();
    return true;
  }

  list(): PluginInfo[] {
    return [...this.installed.values()].map((r) => ({ id: r.plugin.id, version: r.plugin.version, layers: r.layers.length, indicators: [...r.indicators], tools: [...r.tools] }));
  }

  ids(): string[] {
    return [...this.installed.keys()];
  }

  destroyAll() {
    for (const id of [...this.installed.keys()]) this.remove(id);
  }
}

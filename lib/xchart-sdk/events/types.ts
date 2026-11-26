/** Typed chart events (v0.3). Subscribe with chart.on(type, handler); every subscription returns an unsubscribe function. */
import type { CrosshairEvent, VisibleTimeRange } from "../types.ts";
import type { IndicatorApi } from "../indicators/types.ts";
import type { DrawingData, DrawingType } from "../drawings/types.ts";

export type PointerPayload = { time: number | null; price: number | null; paneId: string | null; point: { x: number; y: number }; logical: number };

export type ChartEvents = {
  crosshairMove: CrosshairEvent;
  visibleRangeChange: { range: VisibleTimeRange; logical: { from: number; to: number } };
  click: PointerPayload;
  dblClick: PointerPayload;
  seriesUpdate: { seriesId: number; kind: "full" | "tick" };
  indicatorChange: { indicator: IndicatorApi; action?: string };
  indicatorError: { indicator: IndicatorApi; error?: string };
  drawingCreate: { drawing: DrawingData };
  drawingUpdate: { drawing: DrawingData };
  drawingRemove: { id: string };
  drawingSelect: { id: string | null };
  drawingTool: { tool: DrawingType | null };
  paneResize: { paneId: string; height: number };
  scaleChange: { scaleId: string; paneId: string };
  scaleWarning: { scaleId: string; paneId: string; message: string };
  layoutChange: { reason: string };
  pluginError: { pluginId: string; error: string };
  destroy: Record<string, never>;
};
export type ChartEventType = keyof ChartEvents;

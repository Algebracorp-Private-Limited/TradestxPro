/** Public drawing types. Points are time/price (never pixels or bar indexes), so drawings stay aligned. */
export type DrawingPoint = { time: number; price: number };

export const DRAWING_TYPES = [
  // lines & channels
  "trendline", "horizontal-line", "vertical-line", "horizontal-ray", "ray", "extended-line", "parallel-channel", "regression-channel", "pitchfork",
  // fibonacci
  "fib-retracement", "fib-extension", "fib-timezones", "fib-fan", "fib-channel",
  // shapes & annotations
  "rectangle", "ellipse", "triangle", "polygon", "arrow", "text", "price-label", "callout",
  // measurement & trading illustrations
  "price-range", "date-range", "date-price-range", "long-position", "short-position",
] as const;
export type DrawingType = (typeof DRAWING_TYPES)[number];

export type DrawingStyle = {
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  /** 0–1 */
  fillOpacity?: number;
  textColor?: string;
  fontSize?: number;
  /** Fibonacci levels override (fractions, e.g. 0.618). */
  levels?: number[];
  extendLeft?: boolean;
  extendRight?: boolean;
  showLabels?: boolean;
};

export type DrawingSpec = {
  id?: string;
  type: DrawingType;
  points: DrawingPoint[];
  style?: DrawingStyle;
  text?: string;
  locked?: boolean;
  visible?: boolean;
};

/** Serialised drawing (JSON-safe). */
export type DrawingData = Required<Pick<DrawingSpec, "id" | "type" | "points" | "locked" | "visible">> & { style: DrawingStyle; text?: string };

export interface DrawingApi {
  readonly id: string;
  readonly type: DrawingType;
  data(): DrawingData;
  /** Moves anchors and/or changes the text. */
  update(patch: { points?: DrawingPoint[]; text?: string }): void;
  applyOptions(style: Partial<DrawingStyle>): void;
  setVisible(v: boolean): void;
  setLocked(v: boolean): void;
  remove(): void;
}

export type DrawingEvent =
  | { type: "create"; drawing: DrawingData }
  | { type: "update"; drawing: DrawingData }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null }
  | { type: "tool"; tool: DrawingType | null };

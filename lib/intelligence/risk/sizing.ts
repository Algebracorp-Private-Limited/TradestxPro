/**
 * Position sizing under explicit risk constraints. Planned stop-loss risk (entry − stop) is not the
 * maximum possible loss: gaps can jump a stop, and stops are not guaranteed fills.
 */
export type RiskConstraints = {
  capital: number;
  /** Maximum planned loss per trade (₹). */
  maxRiskPerTrade: number;
  /** Maximum capital committed per trade (₹). */
  maxCapitalPerTrade?: number;
  minRewardRisk?: number;
  /** Minimum median daily traded value (₹) of the instrument. */
  minLiquidity?: number;
  maxPositions?: number;
};

export type Sizing = { quantity: number; lots: number | null; capitalUsed: number; plannedRisk: number; limitedBy: "risk" | "capital" | "lot" | "none"; reasons: string[] };

/** Quantity such that (|entry − stop| × qty) ≤ maxRisk and entry × qty ≤ capital limits; whole lots when lotSize is given. */
export function sizePosition(entry: number, stop: number, c: RiskConstraints, lotSize: number | null = null, marginPerUnit: number | null = null): Sizing {
  const reasons: string[] = [];
  const riskPerUnit = Math.abs(entry - stop);
  if (!(entry > 0) || !(riskPerUnit > 0)) return { quantity: 0, lots: lotSize ? 0 : null, capitalUsed: 0, plannedRisk: 0, limitedBy: "none", reasons: ["entry and stop must be positive and different"] };
  const capitalCap = Math.min(c.capital, c.maxCapitalPerTrade ?? c.capital);
  const perUnitCapital = marginPerUnit ?? entry;
  const byRisk = Math.floor(c.maxRiskPerTrade / riskPerUnit);
  const byCapital = Math.floor(capitalCap / perUnitCapital);
  let qty = Math.min(byRisk, byCapital);
  let limitedBy: Sizing["limitedBy"] = byRisk <= byCapital ? "risk" : "capital";
  let lots: number | null = null;
  if (lotSize && lotSize > 0) {
    lots = Math.floor(qty / lotSize);
    qty = lots * lotSize;
    if (lots === 0) {
      limitedBy = "lot";
      reasons.push(`one lot (${lotSize} units) needs ₹${Math.round(riskPerUnit * lotSize).toLocaleString("en-IN")} of planned risk and ₹${Math.round(perUnitCapital * lotSize).toLocaleString("en-IN")} of capital/margin: above your limits`);
    }
  }
  if (qty === 0 && !reasons.length) reasons.push(limitedBy === "risk" ? "the stop distance exceeds the risk allowed per trade" : "price exceeds the capital allowed per trade");
  return { quantity: qty, lots, capitalUsed: Math.round(qty * perUnitCapital * 100) / 100, plannedRisk: Math.round(qty * riskPerUnit * 100) / 100, limitedBy, reasons };
}

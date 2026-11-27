/**
 * Transparent setup scoring. A score is a weighted sum of named components, each 0–1 with its
 * reason. It ranks candidates; it is NOT a probability of profit (no calibration exists yet).
 */
export type ScoreComponent = { id: ScoreId; label: string; value: number; weight: number; reason: string };
export type ScoreId = "trend" | "structure" | "momentum" | "volatility" | "liquidity" | "positioning" | "rewardRisk" | "costs" | "dataQuality" | "validation";

export const WEIGHTS: Record<ScoreId, number> = {
  trend: 15, structure: 15, momentum: 10, volatility: 10, liquidity: 10, positioning: 10, rewardRisk: 15, costs: 5, dataQuality: 10, validation: 0,
};
export const LABELS: Record<ScoreId, string> = {
  trend: "Trend alignment", structure: "Market structure", momentum: "Momentum", volatility: "Volatility suitability", liquidity: "Liquidity",
  positioning: "Derivatives positioning", rewardRisk: "Reward-to-risk", costs: "Transaction costs", dataQuality: "Data quality", validation: "Historical validation",
};
export const SCORE_DISCLAIMER = "Setup score ranks candidates by the listed evidence. It is not a probability of profit: no calibrated probability model exists yet.";

export type Score = { total: number; components: ScoreComponent[]; disclaimer: string; notApplicable: ScoreId[] };

/** Components not supplied (e.g. positioning for cash equities) are excluded and the rest re-normalised. */
export function score(parts: Partial<Record<ScoreId, { value: number; reason: string }>>): Score {
  const components: ScoreComponent[] = [];
  const notApplicable: ScoreId[] = [];
  let wsum = 0, acc = 0;
  for (const id of Object.keys(WEIGHTS) as ScoreId[]) {
    const p = parts[id];
    if (!p || WEIGHTS[id] === 0) {
      notApplicable.push(id);
      continue;
    }
    const v = Math.max(0, Math.min(1, Number.isFinite(p.value) ? p.value : 0));
    components.push({ id, label: LABELS[id], value: Math.round(v * 100) / 100, weight: WEIGHTS[id], reason: p.reason });
    wsum += WEIGHTS[id];
    acc += v * WEIGHTS[id];
  }
  return { total: wsum ? Math.round((acc / wsum) * 100) : 0, components, disclaimer: SCORE_DISCLAIMER, notApplicable };
}

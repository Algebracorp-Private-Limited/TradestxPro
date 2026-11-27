/**
 * Feature flags. Every flag is OFF unless explicitly enabled by the deployment environment
 * (`TXP_FLAG_<NAME>=1`, e.g. `TXP_FLAG_DEVELOPER_ACCOUNTS=1`). Flags are read on the server only.
 *
 * Regulatory gating (Phase 4): actionable and personalised recommendations, paper trading and live
 * execution each have their own flag. They must stay off in production until the legal/compliance
 * review described in docs/intelligence/regulatory.md is complete. `LIVE_EXECUTION` cannot be
 * enabled at all in this release (see `isEnabled`).
 */
export const FLAGS = {
  /** Developer registration, organisations, projects and API credentials (portal /developers/account). */
  DEVELOPER_ACCOUNTS: "Developer accounts and API credentials",
  /** Educational demonstrations (synthetic data, explained methods). */
  EDUCATIONAL_DEMOS: "Educational demonstrations",
  /** General market analytics (regimes, breadth, chain statistics) without trade plans. */
  MARKET_ANALYTICS: "General market analytics",
  /** Research functionality (scanners, conditional setups shown as research output). */
  RESEARCH: "Research functionality",
  /** Actionable recommendations (entry/stop/target trade plans presented for action). */
  ACTIONABLE_RECOMMENDATIONS: "Actionable recommendations",
  /** Recommendations personalised to a user's capital or positions. */
  PERSONALIZED_RECOMMENDATIONS: "Personalised recommendations",
  /** Simulated (paper) trade tracking. */
  PAPER_TRADING: "Paper trading",
  /** Order placement. Not implemented; cannot be enabled. */
  LIVE_EXECUTION: "Live execution",
} as const;
export type Flag = keyof typeof FLAGS;

/** Flags that are on unless explicitly disabled (`TXP_FLAG_<NAME>=0`): low-risk, non-actionable features. */
const DEFAULT_ON: Flag[] = ["EDUCATIONAL_DEMOS", "MARKET_ANALYTICS"];

export function isEnabled(flag: Flag, env: Record<string, string | undefined> = process.env): boolean {
  if (flag === "LIVE_EXECUTION") return false;
  const v = env[`TXP_FLAG_${flag}`];
  if (v === undefined || v === "") return DEFAULT_ON.includes(flag);
  return v === "1" || v.toLowerCase() === "true";
}

export function flagStates(env: Record<string, string | undefined> = process.env): { flag: Flag; label: string; enabled: boolean }[] {
  return (Object.keys(FLAGS) as Flag[]).map((flag) => ({ flag, label: FLAGS[flag], enabled: isEnabled(flag, env) }));
}

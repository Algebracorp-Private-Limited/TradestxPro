/**
 * Regulatory presentation gate (server side). Analysis outputs are always computed in full, but what
 * a user may see depends on feature flags (lib/flags.ts):
 *   ACTIONABLE_RECOMMENDATIONS off → entry, stop, targets, trailing and time exits are withheld
 *   PERSONALIZED_RECOMMENDATIONS off → position size computed from the user's capital is withheld
 * Withheld fields are removed from the payload (not merely hidden in the UI).
 */
import { isEnabled } from "../flags.ts";

export type Gate = { actionable: boolean; personalized: boolean; research: boolean };
export const gate = (env: Record<string, string | undefined> = process.env): Gate => ({
  actionable: isEnabled("ACTIONABLE_RECOMMENDATIONS", env),
  personalized: isEnabled("PERSONALIZED_RECOMMENDATIONS", env),
  research: isEnabled("RESEARCH", env),
});

export const RESTRICTED_NOTICE = "Trade-plan levels (entry, stop-loss, targets) are restricted until regulatory and licensing review is complete. Analysis and evidence are shown for research and education.";
export const PERSONAL_NOTICE = "Position sizes based on your capital are restricted until personalised recommendations are approved.";

const PLAN_KEYS = ["entry", "confirmation", "stop", "targets", "trailing", "timeExit", "riskPerShare", "rewardPerShare", "rewardRisk", "entryPremium", "stopPremium", "targetPremium", "entryRange", "legs"] as const;

export function present<T extends Record<string, unknown>>(x: T, g: Gate): T & { restricted?: string[]; notices?: string[] } {
  const out: Record<string, unknown> = { ...x };
  const restricted: string[] = [];
  const notices: string[] = [];
  if (!g.actionable) {
    for (const k of PLAN_KEYS) if (k in out && out[k] !== null && out[k] !== undefined) {
      delete out[k];
      restricted.push(k);
    }
    if (restricted.length) notices.push(RESTRICTED_NOTICE);
    // Narrative text that restates levels is withheld too (it was generated from them).
    if (out.explanation) {
      delete out.explanation;
      restricted.push("explanation");
    }
  }
  if (!g.personalized && "sizing" in out && out.sizing) {
    delete out.sizing;
    if ("costs" in out) delete out.costs;
    restricted.push("sizing");
    notices.push(PERSONAL_NOTICE);
  }
  return { ...(out as T), ...(restricted.length ? { restricted, notices } : {}) };
}

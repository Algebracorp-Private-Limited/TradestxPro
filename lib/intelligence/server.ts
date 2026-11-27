import "server-only";
import { db, isDbConfigured } from "../db";
import { aiClient } from "./ai-providers/config.ts";
import { recordUsage } from "./audit/store.ts";

/**
 * Server entry for the intelligence engines: the shared AI client with usage persisted to
 * `ai_usage` (when migration 002 is applied; otherwise usage is not stored and nothing fails).
 */
export function intelligenceAI() {
  return aiClient((u) => {
    if (!isDbConfigured()) return;
    db()
      .then((sql) => recordUsage(sql, u))
      .catch((e) => console.error("ai usage record failed", e instanceof Error ? e.message : e));
  });
}

export const SCRIPT_LIMITS = { count: 50, code: 20_000, name: 60 };

export function validateScript(body: unknown): { name: string; code: string } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const code = String(b.code ?? "");
  if (!name || name.length > SCRIPT_LIMITS.name) return `Name must be 1–${SCRIPT_LIMITS.name} characters.`;
  if (!code.trim() || code.length > SCRIPT_LIMITS.code) return `Script must be 1–${SCRIPT_LIMITS.code.toLocaleString()} characters.`;
  return { name, code };
}

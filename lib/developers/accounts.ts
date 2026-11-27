/**
 * Developer accounts: organisations, members, projects, API credentials, usage and SDK
 * entitlements (tables from migration 001-developer-accounts).
 *
 * All functions take the SQL client explicitly and enforce membership/role checks themselves, so a
 * caller can never act on another organisation's data by passing its id. API keys are random
 * 32-byte secrets; only their SHA-256 hash is stored and the plaintext is returned once.
 * Billing is not implemented: entitlements are granted manually by an administrator.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

type Sql = postgres.Sql;
export type Role = "owner" | "admin" | "developer" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export class DevAccessError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export const KEY_PREFIX = "xck_";
const KEY_RE = /^xck_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
export const ROTATION_GRACE_HOURS = 24;
export const LIMITS = { orgsPerUser: 5, projectsPerOrg: 20, activeKeysPerProject: 5 };

export const hashKey = (plaintext: string) => createHash("sha256").update(plaintext).digest("hex");

/** New API key: `xck_<12-char public prefix>_<43-char base64url secret>`. */
export function generateKey(): { plaintext: string; prefix: string; hash: string } {
  const prefix = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12).padEnd(12, "0");
  const plaintext = `${KEY_PREFIX}${prefix}_${randomBytes(32).toString("base64url")}`;
  return { plaintext, prefix, hash: hashKey(plaintext) };
}

export function parseKey(plaintext: unknown): { prefix: string } | null {
  if (typeof plaintext !== "string") return null;
  const m = KEY_RE.exec(plaintext);
  return m ? { prefix: m[1] } : null;
}

const cleanName = (s: unknown, what: string) => {
  if (typeof s !== "string") throw new DevAccessError(`${what} is required`, 400);
  const v = s.trim().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > 80 || /[<>]/.test(v)) throw new DevAccessError(`${what} must be 2–80 characters`, 400);
  return v;
};

async function roleIn(sql: Sql, orgId: number, userId: number): Promise<Role | null> {
  const [r] = await sql<{ role: Role }[]>`SELECT role FROM dev_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  return r?.role ?? null;
}
async function requireRole(sql: Sql, orgId: number, userId: number, min: Role): Promise<Role> {
  const r = await roleIn(sql, orgId, userId);
  // Same message whether the organisation does not exist or the user is not a member (no probing).
  if (!r) throw new DevAccessError("Organisation not found", 404);
  if (RANK[r] < RANK[min]) throw new DevAccessError(`Requires the ${min} role`);
  return r;
}
async function projectOrg(sql: Sql, projectId: number): Promise<number> {
  const [p] = await sql<{ org_id: number }[]>`SELECT org_id FROM dev_projects WHERE id = ${projectId} AND archived_at IS NULL`;
  if (!p) throw new DevAccessError("Project not found", 404);
  return Number(p.org_id);
}

export async function createOrganization(sql: Sql, userId: number, name: unknown) {
  const n = cleanName(name, "Organisation name");
  return sql.begin(async (tx) => {
    const [{ c }] = await tx<{ c: number }[]>`SELECT count(*)::int AS c FROM dev_members WHERE user_id = ${userId} AND role = 'owner'`;
    if (c >= LIMITS.orgsPerUser) throw new DevAccessError(`At most ${LIMITS.orgsPerUser} organisations per user`, 409);
    const [o] = await tx<{ id: number }[]>`INSERT INTO dev_organizations (name, created_by) VALUES (${n}, ${userId}) RETURNING id`;
    await tx`INSERT INTO dev_members (org_id, user_id, role) VALUES (${o.id}, ${userId}, 'owner')`;
    return { id: Number(o.id), name: n, role: "owner" as Role };
  });
}

export async function listOrganizations(sql: Sql, userId: number) {
  const rows = await sql<{ id: number; name: string; role: Role }[]>`
    SELECT o.id, o.name, m.role FROM dev_organizations o JOIN dev_members m ON m.org_id = o.id WHERE m.user_id = ${userId} ORDER BY o.id`;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function addMember(sql: Sql, actorId: number, orgId: number, userId: number, role: Role) {
  if (!(role in RANK) || role === "owner") throw new DevAccessError("Invalid role", 400);
  await requireRole(sql, orgId, actorId, "admin");
  await sql`INSERT INTO dev_members (org_id, user_id, role) VALUES (${orgId}, ${userId}, ${role}) ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role WHERE dev_members.role <> 'owner'`;
}

export async function createProject(sql: Sql, userId: number, orgId: number, name: unknown, allowedOrigins: unknown = []) {
  await requireRole(sql, orgId, userId, "developer");
  const n = cleanName(name, "Project name");
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [];
  if (origins.length > 10 || origins.some((o) => typeof o !== "string" || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o))) {
    throw new DevAccessError("Allowed origins must be up to 10 https:// origins", 400);
  }
  const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM dev_projects WHERE org_id = ${orgId} AND archived_at IS NULL`;
  if (c >= LIMITS.projectsPerOrg) throw new DevAccessError(`At most ${LIMITS.projectsPerOrg} projects per organisation`, 409);
  const [p] = await sql<{ id: number }[]>`INSERT INTO dev_projects (org_id, name, allowed_origins) VALUES (${orgId}, ${n}, ${origins as string[]}) RETURNING id`;
  return { id: Number(p.id), orgId, name: n, allowedOrigins: origins as string[] };
}

export async function listProjects(sql: Sql, userId: number, orgId: number) {
  await requireRole(sql, orgId, userId, "viewer");
  const rows = await sql<{ id: number; name: string; allowed_origins: string[]; created_at: Date }[]>`
    SELECT id, name, allowed_origins, created_at FROM dev_projects WHERE org_id = ${orgId} AND archived_at IS NULL ORDER BY id`;
  return rows.map((r) => ({ id: Number(r.id), name: r.name, allowedOrigins: r.allowed_origins, createdAt: r.created_at.toISOString() }));
}

/** Issues a key; the plaintext is returned once and never stored. */
export async function issueKey(sql: Sql, userId: number, projectId: number, label: unknown, rateLimitPerMin = 60) {
  const orgId = await projectOrg(sql, projectId);
  await requireRole(sql, orgId, userId, "developer");
  const l = typeof label === "string" ? label.trim() : "";
  if (l.length < 1 || l.length > 60) throw new DevAccessError("Key label must be 1–60 characters", 400);
  if (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin < 1 || rateLimitPerMin > 100_000) throw new DevAccessError("Invalid rate limit", 400);
  const [{ c }] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM dev_api_keys WHERE project_id = ${projectId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
  if (c >= LIMITS.activeKeysPerProject) throw new DevAccessError(`At most ${LIMITS.activeKeysPerProject} active keys per project`, 409);
  const k = generateKey();
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO dev_api_keys (project_id, label, prefix, key_hash, created_by, rate_limit_per_min)
    VALUES (${projectId}, ${l}, ${k.prefix}, ${k.hash}, ${userId}, ${rateLimitPerMin}) RETURNING id`;
  return { id: Number(row.id), prefix: k.prefix, plaintext: k.plaintext };
}

export async function listKeys(sql: Sql, userId: number, projectId: number) {
  const orgId = await projectOrg(sql, projectId);
  await requireRole(sql, orgId, userId, "viewer");
  const rows = await sql<{ id: number; label: string; prefix: string; created_at: Date; last_used_at: Date | null; expires_at: Date | null; revoked_at: Date | null; rate_limit_per_min: number }[]>`
    SELECT id, label, prefix, created_at, last_used_at, expires_at, revoked_at, rate_limit_per_min FROM dev_api_keys WHERE project_id = ${projectId} ORDER BY id`;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return rows.map((r) => ({ id: Number(r.id), label: r.label, prefix: r.prefix, createdAt: r.created_at.toISOString(), lastUsedAt: iso(r.last_used_at), expiresAt: iso(r.expires_at), revokedAt: iso(r.revoked_at), rateLimitPerMin: r.rate_limit_per_min }));
}

/** Rotation: issues a replacement; the old key keeps working for ROTATION_GRACE_HOURS, then expires. */
export async function rotateKey(sql: Sql, userId: number, keyId: number) {
  const [k] = await sql<{ project_id: number; label: string; rate_limit_per_min: number; revoked_at: Date | null }[]>`SELECT project_id, label, rate_limit_per_min, revoked_at FROM dev_api_keys WHERE id = ${keyId}`;
  if (!k || k.revoked_at) throw new DevAccessError("Key not found", 404);
  const orgId = await projectOrg(sql, Number(k.project_id));
  await requireRole(sql, orgId, userId, "developer");
  return sql.begin(async (tx) => {
    const n = generateKey();
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO dev_api_keys (project_id, label, prefix, key_hash, created_by, rate_limit_per_min)
      VALUES (${k.project_id}, ${k.label}, ${n.prefix}, ${n.hash}, ${userId}, ${k.rate_limit_per_min}) RETURNING id`;
    await tx`UPDATE dev_api_keys SET replaced_by = ${row.id}, expires_at = LEAST(COALESCE(expires_at, 'infinity'), now() + make_interval(hours => ${ROTATION_GRACE_HOURS})) WHERE id = ${keyId}`;
    return { id: Number(row.id), prefix: n.prefix, plaintext: n.plaintext, previousKeyExpiresInHours: ROTATION_GRACE_HOURS };
  });
}

export async function revokeKey(sql: Sql, userId: number, keyId: number) {
  const [k] = await sql<{ project_id: number }[]>`SELECT project_id FROM dev_api_keys WHERE id = ${keyId}`;
  if (!k) throw new DevAccessError("Key not found", 404);
  const orgId = await projectOrg(sql, Number(k.project_id));
  await requireRole(sql, orgId, userId, "admin");
  await sql`UPDATE dev_api_keys SET revoked_at = now() WHERE id = ${keyId} AND revoked_at IS NULL`;
}

export type KeyCheck =
  | { ok: true; keyId: number; projectId: number; orgId: number; plan: string | null; remaining: number }
  | { ok: false; status: 401 | 403 | 429; reason: string };

/**
 * Authenticates an API key, checks the organisation's SDK entitlement and the per-minute rate limit,
 * and records usage. Constant-time hash comparison; unknown and revoked keys get the same answer.
 */
export async function authenticateKey(sql: Sql, plaintext: unknown, origin: string | null = null, now = new Date()): Promise<KeyCheck> {
  const parsed = parseKey(plaintext);
  if (!parsed) return { ok: false, status: 401, reason: "Invalid API key" };
  const [k] = await sql<{ id: number; project_id: number; org_id: number; key_hash: string; expires_at: Date | null; revoked_at: Date | null; rate_limit_per_min: number; allowed_origins: string[] }[]>`
    SELECT k.id, k.project_id, p.org_id, k.key_hash, k.expires_at, k.revoked_at, k.rate_limit_per_min, p.allowed_origins
      FROM dev_api_keys k JOIN dev_projects p ON p.id = k.project_id
     WHERE k.prefix = ${parsed.prefix} AND p.archived_at IS NULL`;
  const expected = Buffer.from(k?.key_hash ?? "0".repeat(64), "hex");
  const given = Buffer.from(hashKey(plaintext as string), "hex");
  if (!k || !timingSafeEqual(expected, given) || k.revoked_at || (k.expires_at && k.expires_at <= now)) return { ok: false, status: 401, reason: "Invalid API key" };
  if (origin && k.allowed_origins.length && !k.allowed_origins.includes(origin)) return { ok: false, status: 403, reason: "Origin not allowed for this project" };
  const [ent] = await sql<{ plan: string }[]>`
    SELECT plan FROM dev_sdk_entitlements WHERE org_id = ${k.org_id} AND status = 'active' AND valid_from <= ${now.toISOString().slice(0, 10)}::date
       AND (valid_until IS NULL OR valid_until >= ${now.toISOString().slice(0, 10)}::date) ORDER BY id DESC LIMIT 1`;
  if (!ent) return { ok: false, status: 403, reason: "No active SDK entitlement for this organisation" };
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const [u] = await sql<{ requests: number }[]>`
    INSERT INTO dev_api_usage (key_id, minute, requests) VALUES (${k.id}, ${minute}, 1)
    ON CONFLICT (key_id, minute) DO UPDATE SET requests = dev_api_usage.requests + 1 RETURNING requests`;
  if (u.requests > k.rate_limit_per_min) {
    await sql`UPDATE dev_api_usage SET rejected = rejected + 1, requests = requests - 1 WHERE key_id = ${k.id} AND minute = ${minute}`;
    return { ok: false, status: 429, reason: "Rate limit exceeded" };
  }
  await sql`UPDATE dev_api_keys SET last_used_at = ${now} WHERE id = ${k.id}`;
  return { ok: true, keyId: Number(k.id), projectId: Number(k.project_id), orgId: Number(k.org_id), plan: ent.plan, remaining: k.rate_limit_per_min - u.requests };
}

/** Usage per day for a project (requests and rejections), for the monitoring view. */
export async function usage(sql: Sql, userId: number, projectId: number, days = 30) {
  const orgId = await projectOrg(sql, projectId);
  await requireRole(sql, orgId, userId, "viewer");
  const rows = await sql<{ day: Date; requests: number; rejected: number }[]>`
    SELECT date_trunc('day', u.minute) AS day, sum(u.requests)::int AS requests, sum(u.rejected)::int AS rejected
      FROM dev_api_usage u JOIN dev_api_keys k ON k.id = u.key_id
     WHERE k.project_id = ${projectId} AND u.minute >= now() - make_interval(days => ${Math.min(Math.max(1, days), 35)})
     GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), requests: r.requests, rejected: r.rejected }));
}

/** Entitlements are granted by platform administrators only (no self-service billing). */
export async function grantEntitlement(sql: Sql, adminUserId: number, orgId: number, plan: "evaluation" | "commercial" | "enterprise", validUntil: string | null, notes = "") {
  if (!["evaluation", "commercial", "enterprise"].includes(plan)) throw new DevAccessError("Invalid plan", 400);
  if (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new DevAccessError("validUntil must be YYYY-MM-DD", 400);
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO dev_sdk_entitlements (org_id, product, plan, status, valid_until, notes, granted_by)
    VALUES (${orgId}, 'xchart', ${plan}, 'active', ${validUntil}, ${notes.slice(0, 500)}, ${adminUserId}) RETURNING id`;
  return { id: Number(r.id) };
}

/** Deletes usage rows older than the retention period (35 days). */
export async function pruneUsage(sql: Sql) {
  const r = await sql`DELETE FROM dev_api_usage WHERE minute < now() - interval '35 days'`;
  return r.count;
}

/** True when migration 001 has been applied to this database. */
export async function accountsAvailable(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`SELECT to_regclass('public.dev_api_keys')::text AS t`;
  return Boolean(r?.t);
}

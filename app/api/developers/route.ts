import { db } from "@/lib/db";
import { fail, json, userHandler } from "@/lib/api";
import { isEnabled } from "@/lib/flags";
import { audit } from "@/lib/auth";
import {
  DevAccessError, accountsAvailable, createOrganization, createProject, issueKey, listKeys, listOrganizations, listProjects, revokeKey, rotateKey, usage,
} from "@/lib/developers/accounts";

/**
 * Developer accounts API (signed-in users). Disabled unless TXP_FLAG_DEVELOPER_ACCOUNTS=1 and
 * migration 001-developer-accounts has been applied. No billing.
 *   GET  ?resource=orgs | projects&orgId= | keys&projectId= | usage&projectId=
 *   POST { action: "createOrg", name } | { action: "createProject", orgId, name, allowedOrigins? }
 *        | { action: "issueKey", projectId, label } | { action: "rotateKey", keyId } | { action: "revokeKey", keyId }
 */
async function ready() {
  if (!isEnabled("DEVELOPER_ACCOUNTS")) return { error: fail("Developer accounts are not activated.", 404) };
  const sql = await db();
  if (!(await accountsAvailable(sql))) return { error: fail("Developer accounts are not configured yet.", 503) };
  return { sql };
}
const id = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : null);
function handle(e: unknown) {
  if (e instanceof DevAccessError) return fail(e.message, e.status);
  throw e;
}

export const GET = userHandler(async ({ user, req }) => {
  const r = await ready();
  if (r.error) return r.error;
  const p = new URL(req.url).searchParams;
  try {
    switch (p.get("resource")) {
      case "orgs":
        return json({ ok: true, orgs: await listOrganizations(r.sql, user.id) });
      case "projects": {
        const orgId = id(p.get("orgId"));
        return orgId ? json({ ok: true, projects: await listProjects(r.sql, user.id, orgId) }) : fail("orgId is required");
      }
      case "keys": {
        const projectId = id(p.get("projectId"));
        return projectId ? json({ ok: true, keys: await listKeys(r.sql, user.id, projectId) }) : fail("projectId is required");
      }
      case "usage": {
        const projectId = id(p.get("projectId"));
        return projectId ? json({ ok: true, usage: await usage(r.sql, user.id, projectId) }) : fail("projectId is required");
      }
      default:
        return fail("Unknown resource.");
    }
  } catch (e) {
    return handle(e);
  }
});

export const POST = userHandler(async ({ user, body }) => {
  const r = await ready();
  if (r.error) return r.error;
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    switch (b.action) {
      case "createOrg": {
        const org = await createOrganization(r.sql, user.id, b.name);
        await audit(user.id, "dev.org.create", { orgId: org.id });
        return json({ ok: true, org }, 201);
      }
      case "createProject": {
        const orgId = id(b.orgId);
        if (!orgId) return fail("orgId is required");
        const project = await createProject(r.sql, user.id, orgId, b.name, b.allowedOrigins ?? []);
        await audit(user.id, "dev.project.create", { orgId, projectId: project.id });
        return json({ ok: true, project }, 201);
      }
      case "issueKey": {
        const projectId = id(b.projectId);
        if (!projectId) return fail("projectId is required");
        const key = await issueKey(r.sql, user.id, projectId, b.label);
        await audit(user.id, "dev.key.issue", { projectId, keyId: key.id, prefix: key.prefix });
        return json({ ok: true, key, notice: "Copy this key now: it is shown only once." }, 201);
      }
      case "rotateKey": {
        const keyId = id(b.keyId);
        if (!keyId) return fail("keyId is required");
        const key = await rotateKey(r.sql, user.id, keyId);
        await audit(user.id, "dev.key.rotate", { keyId, newKeyId: key.id });
        return json({ ok: true, key, notice: "Copy this key now: it is shown only once. The previous key expires in 24 hours." });
      }
      case "revokeKey": {
        const keyId = id(b.keyId);
        if (!keyId) return fail("keyId is required");
        await revokeKey(r.sql, user.id, keyId);
        await audit(user.id, "dev.key.revoke", { keyId });
        return json({ ok: true });
      }
      default:
        return fail("Unknown action.");
    }
  } catch (e) {
    return handle(e);
  }
});

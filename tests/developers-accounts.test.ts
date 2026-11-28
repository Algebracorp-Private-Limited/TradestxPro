import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { freshDb, makeUser, noDbReason, scratchDb } from "./helpers/test-db.ts";
import {
  DevAccessError, authenticateKey, createOrganization, createProject, generateKey, grantEntitlement, issueKey, listKeys,
  listOrganizations, listProjects, parseKey, revokeKey, rotateKey, usage, accountsAvailable, addMember,
} from "../lib/developers/accounts.ts";
import { FLAGS, flagStates, isEnabled } from "../lib/flags.ts";

const status = (code: number) => (e: unknown) => e instanceof DevAccessError && e.status === code;

test("API key format: random, parseable, only the hash leaves the generator", () => {
  const a = generateKey(), b = generateKey();
  assert.notEqual(a.plaintext, b.plaintext);
  assert.match(a.plaintext, /^xck_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
  assert.equal(parseKey(a.plaintext)!.prefix, a.prefix);
  assert.equal(a.hash.length, 64);
  assert.ok(!a.hash.includes(a.plaintext.slice(17)));
  for (const bad of [null, 42, "", "xck_short", a.plaintext + "x", a.plaintext.replace("xck_", "sk_")]) assert.equal(parseKey(bad), null);
});

test("feature flags default off (except low-risk analytics) and live execution cannot be enabled", () => {
  assert.equal(isEnabled("DEVELOPER_ACCOUNTS", {}), false);
  assert.equal(isEnabled("DEVELOPER_ACCOUNTS", { TXP_FLAG_DEVELOPER_ACCOUNTS: "1" }), true);
  assert.equal(isEnabled("ACTIONABLE_RECOMMENDATIONS", {}), false);
  assert.equal(isEnabled("MARKET_ANALYTICS", {}), true);
  assert.equal(isEnabled("MARKET_ANALYTICS", { TXP_FLAG_MARKET_ANALYTICS: "0" }), false);
  assert.equal(isEnabled("LIVE_EXECUTION", { TXP_FLAG_LIVE_EXECUTION: "1" }), false);
  assert.equal(flagStates({}).length, Object.keys(FLAGS).length);
});

test("developer accounts on Postgres: isolation, keys, entitlements, rate limits, rotation", { skip: noDbReason }, async () => {
  const sql = await freshDb("devaccounts");
  try {
    assert.equal(await accountsAvailable(sql), true);
    const alice = await makeUser(sql, "alice@example.test"), bob = await makeUser(sql, "bob@example.test"), admin = await makeUser(sql, "admin@example.test");
    const org = await createOrganization(sql, alice, "  Alice   Analytics ");
    assert.equal(org.name, "Alice Analytics");
    await assert.rejects(createOrganization(sql, alice, "<b>x</b>"), status(400));
    const proj = await createProject(sql, alice, org.id, "Web terminal", ["https://alice.example"]);
    await assert.rejects(createProject(sql, alice, org.id, "Bad", ["http://insecure.example"]), status(400));

    // Isolation: Bob sees nothing and cannot act on Alice's organisation (404, not 403: no probing).
    assert.deepEqual(await listOrganizations(sql, bob), []);
    await assert.rejects(listProjects(sql, bob, org.id), status(404));
    await assert.rejects(issueKey(sql, bob, proj.id, "stolen"), status(404));
    await addMember(sql, alice, org.id, bob, "viewer");
    assert.equal((await listProjects(sql, bob, org.id)).length, 1, "viewer can read");
    await assert.rejects(issueKey(sql, bob, proj.id, "viewer key"), status(403), "viewer cannot create keys");

    const key = await issueKey(sql, alice, proj.id, "prod", 3);
    const listed = await listKeys(sql, alice, proj.id);
    assert.equal(listed.length, 1);
    // The secret is everything after "xck_<12-char prefix>_" (base64url, so it may itself contain "_").
    const secret = key.plaintext.slice("xck_".length + 13);
    assert.equal(secret.length, 43);
    assert.ok(!JSON.stringify(listed).includes(secret), "secret never listed");
    const [stored] = await sql<{ key_hash: string }[]>`SELECT key_hash FROM dev_api_keys WHERE id = ${key.id}`;
    assert.notEqual(stored.key_hash, key.plaintext, "only the hash is stored");

    // No entitlement yet → 403; wrong secret with a valid prefix → 401.
    assert.deepEqual(await authenticateKey(sql, key.plaintext), { ok: false, status: 403, reason: "No active SDK entitlement for this organisation" });
    await grantEntitlement(sql, admin, org.id, "evaluation", null, "pilot");
    assert.equal((await authenticateKey(sql, key.plaintext.slice(0, -1) + (key.plaintext.endsWith("A") ? "B" : "A"))).ok, false);
    assert.equal((await authenticateKey(sql, key.plaintext, "https://evil.example") as { status: number }).status, 403, "origin allow-list");

    // Rate limit 3/min: the 4th request in the same minute is rejected and counted.
    // A minute boundary one hour ahead, so the entitlement just granted is active (no fixed calendar dates).
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 3_600_000);
    const t = new Date(minute.getTime() + 10_000);
    for (let i = 0; i < 3; i++) assert.equal((await authenticateKey(sql, key.plaintext, "https://alice.example", t)).ok, true);
    assert.equal((await authenticateKey(sql, key.plaintext, null, t) as { status: number }).status, 429);
    assert.equal((await authenticateKey(sql, key.plaintext, null, new Date(minute.getTime() + 61_000))).ok, true, "next minute");
    const [u] = await sql<{ requests: number; rejected: number }[]>`SELECT requests, rejected FROM dev_api_usage WHERE key_id = ${key.id} AND minute = ${minute}`;
    assert.deepEqual([u.requests, u.rejected], [3, 1]);
    assert.ok(Array.isArray(await usage(sql, alice, proj.id)));

    // Rotation: new key works, old key works during the grace period, then expires.
    const rotated = await rotateKey(sql, alice, key.id);
    const soon = new Date(), later = new Date(Date.now() + 25 * 3600_000);
    assert.equal((await authenticateKey(sql, rotated.plaintext, null, soon)).ok, true);
    assert.equal((await authenticateKey(sql, key.plaintext, null, soon)).ok, true, "grace period");
    assert.equal((await authenticateKey(sql, key.plaintext, null, later) as { status: number }).status, 401, "expired after grace");

    // Revocation needs admin; revoked keys are rejected immediately.
    await assert.rejects(revokeKey(sql, bob, rotated.id), status(403));
    await revokeKey(sql, alice, rotated.id);
    assert.equal((await authenticateKey(sql, rotated.plaintext) as { status: number }).status, 401);
  } finally {
    await sql.end();
  }
});

test("migration runner: dry run by default, applies once, refuses edited migrations", { skip: noDbReason }, async () => {
  const { sql, url } = await scratchDb("migrations", { migrate: false });
  const run = (...a: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "../scripts/migrate.ts"), "--database-url", url, ...a], { encoding: "utf8" });
  try {
    assert.match(run(), /\+ 001-developer-accounts .*pending/);
    assert.match(run(), /\+ 002-intelligence-core .*pending/);
    assert.equal(await accountsAvailable(sql), false, "dry run changes nothing");
    assert.match(run("--apply"), /✔ 001-developer-accounts applied/);
    assert.match(run("--apply"), /= 001-developer-accounts \(applied\)/);
    await sql`UPDATE schema_migrations SET checksum = 'tampered'`;
    assert.throws(() => run("--apply"), /checksum mismatch/);
    assert.throws(() => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "../scripts/migrate.ts")], { encoding: "utf8", stdio: "pipe" }), "a URL must be given explicitly");
  } finally {
    await sql.end();
  }
});

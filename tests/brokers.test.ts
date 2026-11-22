import { test } from "node:test";
import assert from "node:assert/strict";
import { open, seal } from "../lib/brokers/vault.ts";
import { bucketMinutes, istDate, istDateTime, normaliseDaily, parseIstTime } from "../lib/brokers/time.ts";
import { validateWaitlist } from "../lib/waitlist.ts";

const KEY = "test-key-that-is-long-enough-123456";

test("vault round-trips and detects tampering / wrong key", () => {
  const sealed = seal({ token: "abc", n: 1 }, KEY);
  assert.notEqual(sealed, seal({ token: "abc", n: 1 }, KEY)); // random IV
  assert.ok(!sealed.includes("abc"));
  assert.deepEqual(open(sealed, KEY), { token: "abc", n: 1 });
  const parts = sealed.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
  assert.throws(() => open(parts.join("."), KEY));
  assert.throws(() => open(sealed, KEY + "x"));
  assert.throws(() => seal({}, "short"));
});

test("IST time helpers", () => {
  assert.equal(parseIstTime("2026-11-18 09:15:00"), Date.parse("2026-11-18T03:45:00Z") / 1000);
  assert.equal(parseIstTime("2026-11-18T09:15:00+05:30"), Date.parse("2026-11-18T03:45:00Z") / 1000);
  assert.equal(parseIstTime("2026-11-18 09:15"), Date.parse("2026-11-18T03:45:00Z") / 1000);
  assert.equal(istDate(new Date("2026-11-17T19:00:00Z")), "2026-11-18");
  assert.equal(istDateTime(new Date("2026-11-18T03:45:00Z")), "2026-11-18 09:15:00");
});

test("daily bars keyed to the IST trading date", () => {
  const t = Date.parse("2026-11-17T18:30:00Z") / 1000; // 00:00 IST on 18 Nov
  const [b] = normaliseDaily([{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }]);
  assert.equal(b.t, Date.parse("2026-11-18T00:00:00Z") / 1000);
});

test("bucketMinutes aligns to the 09:15 open", () => {
  const start = Date.parse("2026-11-18T03:45:00Z") / 1000; // 09:15 IST
  const bars = Array.from({ length: 6 }, (_, i) => ({ t: start + i * 300, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 10 }));
  const out = bucketMinutes(bars, 15);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { t: start, o: 0, h: 3, l: -1, c: 2.5, v: 30 });
  assert.equal(out[1].t, start + 900);
});

test("waitlist validation", () => {
  const ok = validateWaitlist({ name: "Asha", email: "A@B.co", consent: true, broker: "Dhan", interests: ["Futures", "hack"], capital: "nope" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.email, "a@b.co");
    assert.deepEqual(ok.value.interests, ["Futures"]);
    assert.equal(ok.value.capital, null);
  }
  assert.equal(validateWaitlist({ name: "Asha", email: "a@b.co" }).ok, false); // no consent
  assert.equal(validateWaitlist({ name: "A", email: "a@b.co", consent: true }).ok, false);
});

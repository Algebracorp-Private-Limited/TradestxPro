import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOtp,
  hashPassword,
  passwordProblem,
  safeEqualHex,
  sha256,
  validateSignup,
  verifyPassword,
} from "../lib/crypto.ts";

test("password hashes verify and reject wrong passwords", async () => {
  const h = await hashPassword("correct horse 42");
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse 42", h), true);
  assert.equal(await verifyPassword("wrong horse 42", h), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("hashes are salted", async () => {
  assert.notEqual(await hashPassword("same-pass-123"), await hashPassword("same-pass-123"));
});

test("OTP is always six digits", () => {
  for (let i = 0; i < 500; i++) assert.match(generateOtp(), /^\d{6}$/);
});

test("safeEqualHex compares digests", () => {
  assert.equal(safeEqualHex(sha256("123456"), sha256("123456")), true);
  assert.equal(safeEqualHex(sha256("123456"), sha256("654321")), false);
  assert.equal(safeEqualHex("", ""), false);
});

test("password rules", () => {
  assert.ok(passwordProblem("short1"));
  assert.ok(passwordProblem("onlyletterslong"));
  assert.ok(passwordProblem("1234567890123"));
  assert.equal(passwordProblem("letters-and-123"), null);
});

test("signup validation normalises input", () => {
  const r = validateSignup({ name: "  Asha Rao ", email: " Asha@Example.COM ", phone: "+91 98765 43210", password: "secure-pass-1" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.name, "Asha Rao");
    assert.equal(r.value.email, "asha@example.com");
    assert.equal(r.value.phone, "919876543210");
  }
  assert.equal(validateSignup({ name: "A", email: "a@b.co", password: "secure-pass-1" }).ok, false);
  assert.equal(validateSignup({ name: "Asha", email: "not-an-email", password: "secure-pass-1" }).ok, false);
  assert.equal(validateSignup({ name: "Asha", email: "a@b.co", phone: "123", password: "secure-pass-1" }).ok, false);
  assert.equal(validateSignup({ name: "Asha", email: "a@b.co", password: "secure-pass-1" }).ok, true);
});

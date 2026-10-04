const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./database");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function createSignupUser({
  name,
  email,
  gender,
  phone,
  city,
  state,
  country,
  password,
}) {
  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);

  if (!cleanName || !cleanEmail || !cleanPhone) {
    throw new Error("Name, email and phone are required.");
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ? OR phone = ?")
    .get(cleanEmail, cleanPhone);

  if (existing) {
    throw new Error("An account already exists with this email or phone.");
  }

  const passwordHash = password
    ? bcrypt.hashSync(password, 12)
    : null;

  const result = db
    .prepare(`
      INSERT INTO users
      (name, email, gender, phone, city, state, country, password_hash, plan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Free')
    `)
    .run(
      cleanName,
      cleanEmail,
      gender || null,
      cleanPhone,
      city || null,
      state || null,
      country || null,
      passwordHash
    );

  const userId = result.lastInsertRowid;

  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO otp_codes
    (user_id, contact, otp_hash, purpose, expires_at)
    VALUES (?, ?, ?, 'signup', ?)
  `).run(userId, cleanPhone, otpHash, expiresAt);

  return {
    userId,
    otp,
  };
}

module.exports = {
  createSignupUser,
  normalizeEmail,
  normalizePhone,
  generateOtp,
  hashOtp,
};

function verifySignupOtp(userId, otp) {
  const cleanOtp = String(otp || "").trim();

  if (!userId || !cleanOtp) {
    throw new Error("User ID and OTP are required.");
  }

  const record = db
    .prepare(`
      SELECT *
      FROM otp_codes
      WHERE user_id = ?
        AND purpose = 'signup'
        AND verified = 0
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(userId);

  if (!record) {
    throw new Error("No active OTP found.");
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    throw new Error("OTP has expired.");
  }

  if (record.attempts >= 5) {
    throw new Error("Too many incorrect OTP attempts.");
  }

  const suppliedHash = hashOtp(cleanOtp);

  if (suppliedHash !== record.otp_hash) {
    db.prepare(`
      UPDATE otp_codes
      SET attempts = attempts + 1
      WHERE id = ?
    `).run(record.id);

    throw new Error("Invalid OTP.");
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE otp_codes
      SET verified = 1
      WHERE id = ?
    `).run(record.id);

    db.prepare(`
      UPDATE users
      SET phone_verified = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userId);
  });

  transaction();

  return {
    userId,
    verified: true,
  };
}

module.exports.verifySignupOtp = verifySignupOtp;

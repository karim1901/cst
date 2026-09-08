import crypto from "node:crypto";

/**
 * Small, generic helper for encrypting any secret (a third-party API key, a
 * shipping-provider credential, ...) before it is stored, so a database read
 * or backup leak does not hand out live credentials. Used by both the User
 * model (an employee's Quick Livraison key) and the ShippingCompany model
 * (the platform's own provider keys) — one key-management story, not one
 * per feature. AES-256-GCM: authenticated, so a tampered blob fails to
 * decrypt rather than silently returning garbage.
 *
 * Output layout (single base64 string): iv(12) || authTag(16) || ciphertext.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const secret = process.env.SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "Missing SECRET_ENCRYPTION_KEY environment variable (see .env.example)."
    );
  }
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes."
    );
  }
  return key;
}

export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptSecret(blob) {
  const key = getKey();
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

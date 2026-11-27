import crypto from "crypto";

/**
 * Generates a cryptographically secure 6-digit numeric OTP using Node's CSPRNG.
 */
export function generateSecureOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Derives a 32-byte server-only secret key via HKDF-SHA256 from private server
 * credentials. Never uses public NEXT_PUBLIC_* variables as key material.
 */
function deriveServerKey(purpose: string): Buffer {
  const rawMaterial =
    process.env.OTP_ENCRYPTION_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.STEADFAST_SECRET_KEY ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "afra-dev-local-fallback-key-material-do-not-use-in-prod");

  if (!rawMaterial) {
    throw new Error("Server secret key material is not configured.");
  }

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(rawMaterial, "utf8"),
      Buffer.from("afra-tech-point-security-v1", "utf8"),
      Buffer.from(purpose, "utf8"),
      32
    )
  );
}

/**
 * Hashes an OTP with a per-record random salt using HMAC-SHA256 so raw OTPs are
 * never persisted in Firestore.
 */
export function hashOtp(otp: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  const key = deriveServerKey(`otp-hmac:${actualSalt}`);
  const hash = crypto.createHmac("sha256", key).update(otp.trim(), "utf8").digest("hex");
  return { hash, salt: actualSalt };
}

/**
 * Constant-time verification of a candidate OTP against stored HMAC hash + salt.
 */
export function verifyOtpHash(candidateOtp: string, expectedHash: string, salt: string): boolean {
  if (!candidateOtp || !expectedHash || !salt) return false;
  const { hash } = hashOtp(candidateOtp, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Encrypts short-lived sensitive values (such as pending registration password
 * awaiting OTP confirmation) using standard AES-256-GCM with a random 96-bit IV
 * and canonical unpadded `base64url` encoding (prevents base64 `=` trailing-byte malleability).
 */
export function encryptTransientSecret(plaintext: string): string {
  const key = deriveServerKey("transient-aes-256-gcm");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decrypts a canonical `base64url` AES-256-GCM value produced by `encryptTransientSecret`.
 */
export function decryptTransientSecret(payload: string): string {
  const parts = String(payload || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted payload format.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  if (
    !BASE64URL_RE.test(ivB64) ||
    !BASE64URL_RE.test(tagB64) ||
    (dataB64.length > 0 && !BASE64URL_RE.test(dataB64))
  ) {
    throw new Error("Non-canonical base64url characters detected.");
  }

  const key = deriveServerKey("transient-aes-256-gcm");
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(dataB64, "base64url");

  if (
    iv.length !== 12 ||
    authTag.length !== 16 ||
    ciphertext.toString("base64url") !== dataB64
  ) {
    throw new Error("Invalid cipher parameters.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Constant-time comparison of two secret strings (hashes both with SHA-256 first
 * so string length differences are not leaked via early return).
 */
export function timingSafeSecretEquals(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const hashA = crypto.createHash("sha256").update(provided, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

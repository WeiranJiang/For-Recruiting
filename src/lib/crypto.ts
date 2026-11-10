import "server-only";
import crypto from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (Google refresh tokens, provider API keys).
 *
 * Key versions:
 *  - "v2." ciphertexts use ENCRYPTION_KEY (32+ chars) — independent of the session secret, so
 *    rotating SESSION_SECRET never destroys stored Google sign-ins.
 *  - Legacy (no prefix) ciphertexts use a key derived from SESSION_SECRET; still readable.
 * New values use v2 when ENCRYPTION_KEY is set, otherwise legacy.
 * Rotation of ENCRYPTION_KEY: set ENCRYPTION_KEY_PREVIOUS to the old value while re-encrypting.
 */
function derive(label: string, secret: string) {
  return crypto.createHash("sha256").update(`${label}:${secret}`).digest();
}

function legacyKey(): Buffer | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? derive("enc", s) : null;
}

function v2Keys(): Buffer[] {
  return [process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_KEY_PREVIOUS]
    .filter((k): k is string => !!k && k.length >= 32)
    .map((k) => derive("enc-v2", k));
}

function seal(key: Buffer, plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

function open(key: Buffer, payload: string) {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function encrypt(plain: string): string {
  const [current] = v2Keys();
  if (current) return `v2.${seal(current, plain)}`;
  const legacy = legacyKey();
  if (!legacy) throw new Error("Set ENCRYPTION_KEY (or SESSION_SECRET) to 32+ characters");
  return seal(legacy, plain);
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const candidates = payload.startsWith("v2.") ? v2Keys() : [legacyKey()].filter((k): k is Buffer => !!k);
  const body = payload.startsWith("v2.") ? payload.slice(3) : payload;
  for (const key of candidates) {
    try {
      return open(key, body);
    } catch {
      /* try next key */
    }
  }
  return null;
}

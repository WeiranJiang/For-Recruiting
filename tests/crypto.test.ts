/** Encryption-at-rest tests. `server-only` is stubbed because this runs outside Next. */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// Allow importing a server-only module in plain Node tests.
const origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename = function (req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return require.resolve("./stub-empty.cjs");
  return origResolve.call(this, req, ...rest);
};

test("legacy ciphertexts still decrypt after ENCRYPTION_KEY is introduced", async () => {
  process.env.SESSION_SECRET = "s".repeat(40);
  delete process.env.ENCRYPTION_KEY;
  const { encrypt, decrypt } = await import("../src/lib/crypto");
  const legacy = encrypt("refresh-token-1");
  assert.ok(!legacy.startsWith("v2."));
  process.env.ENCRYPTION_KEY = "k".repeat(40);
  const v2 = encrypt("refresh-token-2");
  assert.ok(v2.startsWith("v2."));
  assert.equal(decrypt(legacy), "refresh-token-1");
  assert.equal(decrypt(v2), "refresh-token-2");
  // Rotating SESSION_SECRET must not break v2 values.
  process.env.SESSION_SECRET = "t".repeat(40);
  assert.equal(decrypt(v2), "refresh-token-2");
  // Key rotation: old key moves to ENCRYPTION_KEY_PREVIOUS.
  process.env.ENCRYPTION_KEY_PREVIOUS = "k".repeat(40);
  process.env.ENCRYPTION_KEY = "n".repeat(40);
  assert.equal(decrypt(v2), "refresh-token-2");
  // Tampering is detected (GCM auth tag).
  const tampered = v2.slice(0, -2) + (v2.endsWith("A") ? "BB" : "AA");
  assert.equal(decrypt(tampered), null);
  assert.equal(decrypt("garbage"), null);
});

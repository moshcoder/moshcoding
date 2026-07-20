import assert from "node:assert/strict";
import test from "node:test";

// In-memory libSQL so the token-expiry query runs against a real database.
process.env.TURSO_DATABASE_URL = ":memory:";
const { ensureSchema, createAccount, setResetToken, accountForResetToken } =
  await import("../lib/db.ts");

test("reset tokens are rejected once expired", async () => {
  await ensureSchema();
  const acct = await createAccount({
    email: "reset@example.com",
    passwordHash: "h",
    passwordSalt: "s",
    domain: "example.com",
  });

  // Valid (future) token is accepted.
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await setResetToken("reset@example.com", "valid-token", future);
  assert.equal(await accountForResetToken("valid-token"), acct.id);

  // Token that expired 30 minutes ago (same UTC day) must be rejected. A string
  // comparison against SQLite datetime('now') would wrongly accept it, because
  // the ISO "T" separator always sorts after datetime('now')'s space.
  const expired = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await setResetToken("reset@example.com", "expired-token", expired);
  assert.equal(await accountForResetToken("expired-token"), null);
});

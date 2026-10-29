import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";
delete process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret";
process.env.COINPAY_CLIENT_ID = "cp_test_client";
process.env.COINPAY_CLIENT_SECRET = "test-client-secret";
process.env.APP_BASE_URL = "https://moshcoding.com";

const dbm = await import("../lib/db.ts");
const oauth = await import("../lib/oauth.ts");
const { signSession, SESSION_COOKIE } = await import("../lib/session.ts");
const { NextRequest } = await import("next/server");
const loginRoute = await import("../app/auth/login/route.ts");
const callbackRoute = await import("../app/auth/coinpay/callback/route.ts");
await dbm.ensureSchema();

let n = 0;
const uniq = (p) => `${p}${++n}@example.com`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`;

function fakeCoinpay({ sub, email, nonce }) {
  return async (url) => {
    const u = String(url);
    if (u.endsWith("/api/oauth/token")) {
      return new Response(JSON.stringify({
        access_token: "at", token_type: "Bearer", expires_in: 3600,
        id_token: idToken({ iss: "https://coinpayportal.com", aud: "cp_test_client", sub, nonce, exp: Math.floor(Date.now() / 1000) + 600 }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.endsWith("/api/oauth/userinfo")) {
      return new Response(JSON.stringify({ sub, email, email_verified: false }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
}

test("a CoinPay login carrying a victim's email does not get the victim's account", async () => {
  const victim = await dbm.createAccount({ email: uniq("victim"), passwordHash: "h", passwordSalt: "s" });
  const id = await dbm.accountIdForCoinpay("attacker-sub", victim.email);
  assert.ok(id);
  assert.notEqual(id, victim.id);
  const made = await dbm.getAccountById(id);
  assert.equal(made.email, dbm.coinpayPlaceholderEmail("attacker-sub"), "the CoinPay email is never the account email");
  assert.equal(made.is_admin, false);
  assert.equal((await dbm.getAccountById(victim.id)).coinpay_sub, null);
});

test("the placeholder domain cannot be used to sign up", async () => {
  await assert.rejects(dbm.createAccount({ email: "x@coinpay.moshcoding.invalid", passwordHash: "h", passwordSalt: "s" }));
  await assert.rejects(dbm.findOrCreateAccountByEmail("x@coinpay.moshcoding.invalid"));
});

test("link / unlink rules", async () => {
  const a = await dbm.createAccount({ email: uniq("link"), passwordHash: "h", passwordSalt: "s" });
  assert.deepEqual(await dbm.linkCoinpay(a.id, "link-sub"), { ok: true });
  assert.equal(await dbm.accountIdForCoinpay("link-sub"), a.id);
  const b = await dbm.createAccount({ email: uniq("link"), passwordHash: "h", passwordSalt: "s" });
  assert.deepEqual(await dbm.linkCoinpay(b.id, "link-sub"), { ok: false, reason: "taken" });
  assert.deepEqual(await dbm.linkCoinpay(a.id, "other-sub"), { ok: false, reason: "already_linked" });
  assert.deepEqual(await dbm.coinpayLinkStatus(a.id), { linked: true, canDisconnect: true });
  assert.deepEqual(await dbm.unlinkCoinpay(a.id), { ok: true });
  // a CoinPay-only account cannot drop its only sign-in
  const only = await dbm.accountIdForCoinpay("only-sub");
  assert.deepEqual(await dbm.coinpayLinkStatus(only), { linked: true, canDisconnect: false });
  assert.deepEqual(await dbm.unlinkCoinpay(only), { ok: false, reason: "only_login" });
});

test("start sends PKCE S256, state and nonce; connect needs a password session", async () => {
  const res = await loginRoute.GET(new NextRequest("https://moshcoding.com/auth/login", { headers: { host: "moshcoding.com", "x-forwarded-proto": "https" } }));
  assert.equal(res.status, 307);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://coinpayportal.com/api/oauth/authorize");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.ok(loc.searchParams.get("state") && loc.searchParams.get("nonce") && loc.searchParams.get("code_challenge"));
  assert.equal(loc.searchParams.get("redirect_uri"), "https://moshcoding.com/auth/coinpay/callback");

  const noSession = await loginRoute.GET(new NextRequest("https://moshcoding.com/auth/login?mode=connect", { headers: { host: "moshcoding.com" } }));
  assert.equal(new URL(noSession.headers.get("location")).pathname, "/login");
});

function callbackReq({ state = "s1", cookieState = "s1", mode, session } = {}) {
  const cookies = [`cp_state=${cookieState}`, "cp_pkce=verifier", "cp_nonce=n1"];
  if (mode) cookies.push(`cp_mode=${mode}`);
  if (session) cookies.push(`${SESSION_COOKIE}=${session}`);
  return new NextRequest(`https://moshcoding.com/auth/coinpay/callback?code=c1&state=${state}`, {
    headers: { host: "moshcoding.com", "x-forwarded-proto": "https", cookie: cookies.join("; ") },
  });
}

test("callback rejects a forged state", async () => {
  const res = await callbackRoute.GET(callbackReq({ state: "forged" }));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /state mismatch/);
});

test("callback rejects an id_token whose nonce does not match", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeCoinpay({ sub: "nonce-sub", email: uniq("n"), nonce: "WRONG" });
  try {
    const res = await callbackRoute.GET(callbackReq());
    assert.equal(res.status, 400);
  } finally { globalThis.fetch = real; }
  await assert.rejects(oauth.finishCoinpaySignIn({ code: "c", verifier: "v", nonce: "n1", redirectUri: "https://moshcoding.com/auth/coinpay/callback" }, fakeCoinpay({ sub: "x", nonce: "other" })), /nonce/);
});

test("connect links CoinPay to the signed-in account; login by email collision does not", async () => {
  const owner = await dbm.createAccount({ email: uniq("owner"), passwordHash: "h", passwordSalt: "s" });
  const real = globalThis.fetch;
  try {
    // A CoinPay login with the owner's email: lands on a new account, owner untouched.
    globalThis.fetch = fakeCoinpay({ sub: "collide-sub", email: owner.email, nonce: "n1" });
    const login = await callbackRoute.GET(callbackReq());
    assert.equal(login.status, 307);
    assert.equal((await dbm.getAccountById(owner.id)).coinpay_sub, null);
    assert.notEqual(await dbm.accountIdForCoinpay("collide-sub"), owner.id);

    // connect without a session is refused
    globalThis.fetch = fakeCoinpay({ sub: "connect-sub", email: "x@example.com", nonce: "n1" });
    const anon = await callbackRoute.GET(callbackReq({ mode: "connect" }));
    assert.equal(anon.status, 400);
    assert.equal((await dbm.getAccountById(owner.id)).coinpay_sub, null);

    // connect with the owner's password session links it
    const session = signSession({ sub: `acct:${owner.id}`, email: owner.email, name: null });
    const ok = await callbackRoute.GET(callbackReq({ mode: "connect", session }));
    assert.equal(ok.status, 307);
    assert.match(ok.headers.get("location"), /coinpay=linked/);
    assert.equal((await dbm.getAccountById(owner.id)).coinpay_sub, "connect-sub");
  } finally { globalThis.fetch = real; }
});

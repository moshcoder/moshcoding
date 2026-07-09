import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

// load ./.env for local dev; a no-op in prod where env is injected
try { process.loadEnvFile(); } catch { /* no .env file — fine */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const CONFIG_DIR = path.join(__dirname, "configs");

/* ------------------------------------------------------------------ *
 * waitlist store — libSQL / Turso (our regular stack)                 *
 * ------------------------------------------------------------------ */
if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is not set (see .env.example)");
}
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS signups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      dn         TEXT NOT NULL DEFAULT 'moshcoding.com',
      ua         TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS signups_email_dn ON signups (email, dn)`
  );
  // users authenticated via "Login with CoinPayPortal" (sub = coinpay merchant id)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      sub        TEXT PRIMARY KEY,
      email      TEXT,
      name       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

async function upsertUser({ sub, email, name }) {
  await db.execute({
    sql: `INSERT INTO users (sub, email, name) VALUES (?, ?, ?)
          ON CONFLICT (sub) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            last_login = datetime('now')`,
    args: [sub, email || null, name || null],
  });
}

async function addSignup({ email, dn, ua }) {
  const domain = dn || "moshcoding.com";
  const res = await db.execute({
    sql: `INSERT INTO signups (email, dn, ua) VALUES (?, ?, ?)
          ON CONFLICT (email, dn) DO NOTHING`,
    args: [email.toLowerCase(), domain, (ua || "").slice(0, 300)],
  });
  return { ok: true, already: res.rowsAffected === 0 };
}

async function signupCount() {
  const res = await db.execute(`SELECT count(*) AS n FROM signups`);
  return Number(res.rows[0]?.n ?? 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ------------------------------------------------------------------ *
 * per-domain config: safe default derived from the domain, plus an    *
 * optional configs/<domain>.json override                             *
 * ------------------------------------------------------------------ */
function safeDomain(dn) {
  if (typeof dn !== "string") return null;
  const d = dn.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // only a hostname: letters, digits, dots, dashes; must contain a dot
  if (!/^[a-z0-9.-]{3,253}$/.test(d) || !d.includes(".") || d.includes("..")) return null;
  return d;
}

function titleize(dn) {
  const base = dn.split(".")[0].replace(/[-_]+/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

// linktree-style social list: verbatim `links` win, else expand a `socials`
// shorthand, else derive sensible defaults from the domain name.
function socialLinks(dn, override = {}) {
  if (Array.isArray(override.links)) {
    return override.links.filter((l) => l && l.url && l.label);
  }
  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  const s = { website: `https://${dn}`, x: slug, instagram: slug, tiktok: slug, ...(override.socials || {}) };
  const links = [];
  if (s.website)   links.push({ label: dn,             url: s.website,                              kind: "web" });
  if (s.x)         links.push({ label: `@${s.x}`,        url: `https://x.com/${s.x}`,                 kind: "x" });
  if (s.instagram) links.push({ label: `@${s.instagram}`, url: `https://instagram.com/${s.instagram}`, kind: "instagram" });
  if (s.tiktok)    links.push({ label: `@${s.tiktok}`,   url: `https://tiktok.com/@${s.tiktok}`,      kind: "tiktok" });
  if (s.github)    links.push({ label: s.github,         url: `https://github.com/${s.github}`,       kind: "github" });
  if (s.youtube)   links.push({ label: s.youtube,        url: `https://youtube.com/@${s.youtube}`,    kind: "youtube" });
  if (s.spotify)   links.push({ label: "Spotify",        url: s.spotify,                              kind: "spotify" });
  if (s.discord)   links.push({ label: "Discord",        url: s.discord,                              kind: "discord" });
  return links;
}

function configFor(dn) {
  const base = {
    dn,
    brand: titleize(dn),
    headline: "IS COMING",
    tagline: "Something heavy is compiling.",
    sub: "Join the pit. Be first in the door when it drops.",
    accent: "#9EF01A",
    cta: "Join the waitlist",
    spotify: "",
  };
  let override = {};
  const file = path.join(CONFIG_DIR, `${dn}.json`);
  if (fs.existsSync(file)) {
    try { override = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { override = {}; }
  }
  const slug = dn.split(".")[0].replace(/[^a-z0-9]/g, "");
  return {
    ...base,
    ...override,
    dn,
    hashtag: override.hashtag || `#${slug}`,
    links: socialLinks(dn, override),
  };
}

/* ------------------------------------------------------------------ *
 * Auth — "Login with CoinPayPortal" (OAuth 2.0 Authorization Code+PKCE) *
 * CoinPayPortal is an OIDC provider; we fetch identity (incl. email)   *
 * from /userinfo. The id_token is HS256/opaque to us, so we don't      *
 * verify it locally — the access token is validated server-side there. *
 * ------------------------------------------------------------------ */
const COINPAY_ISSUER = (process.env.COINPAY_ISSUER || "https://coinpayportal.com").replace(/\/$/, "");
const COINPAY_CLIENT_ID = process.env.COINPAY_CLIENT_ID || "";
const COINPAY_CLIENT_SECRET = process.env.COINPAY_CLIENT_SECRET || "";
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `${APP_BASE_URL}/auth/coinpay/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const authEnabled = Boolean(COINPAY_CLIENT_ID && COINPAY_CLIENT_SECRET && SESSION_SECRET);
if (!authEnabled) {
  console.warn("[auth] CoinPayPortal login disabled — set COINPAY_CLIENT_ID, COINPAY_CLIENT_SECRET, SESSION_SECRET");
}
const IS_PROD = APP_BASE_URL.startsWith("https://");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/* ---- tiny cookie helpers (no dep) ---- */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const p = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (httpOnly) p.push("HttpOnly");
  if (IS_PROD) p.push("Secure");
  if (maxAge != null) p.push(`Max-Age=${maxAge}`);
  res.append("Set-Cookie", p.join("; "));
}
function clearCookie(res, name) {
  res.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax${IS_PROD ? "; Secure" : ""}`);
}

/* ---- signed, stateless session cookie ---- */
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
function signSession(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}
function readSession(req) {
  if (!authEnabled) return null;
  const token = parseCookies(req).mc_session;
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data.iat || Date.now() / 1000 - data.iat > SESSION_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/healthz", async (_req, res) => {
  try {
    res.json({ ok: true, count: await signupCount() });
  } catch (err) {
    res.status(503).json({ ok: false, error: "db unreachable" });
  }
});

app.get("/api/config", (req, res) => {
  const dn = safeDomain(req.query.dn);
  if (!dn) return res.status(400).json({ error: "invalid domain" });
  res.json(configFor(dn));
});

/* ---- who am I ---- */
app.get("/api/me", (req, res) => {
  const s = readSession(req);
  res.json({
    authEnabled,
    user: s ? { sub: s.sub, email: s.email, name: s.name || null } : null,
  });
});

/* ---- start login: PKCE + state, redirect to CoinPayPortal ---- */
app.get("/auth/login", (req, res) => {
  if (!authEnabled) return res.status(503).send("Login is not configured yet.");
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  setCookie(res, "cp_pkce", verifier, { maxAge: 600 });
  setCookie(res, "cp_state", state, { maxAge: 600 });
  const u = new URL(`${COINPAY_ISSUER}/api/oauth/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: COINPAY_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  res.redirect(u.toString());
});

/* ---- OAuth callback: exchange code, fetch email, create session ---- */
app.get("/auth/coinpay/callback", async (req, res) => {
  if (!authEnabled) return res.status(503).send("Login is not configured yet.");
  const fail = (msg) => res.status(400).send(`Login failed: ${msg}`);
  const cookies = parseCookies(req);
  if (req.query.error) return fail(String(req.query.error_description || req.query.error));
  if (!req.query.code) return fail("no authorization code");
  if (!req.query.state || req.query.state !== cookies.cp_state) return fail("state mismatch");
  const verifier = cookies.cp_pkce;
  if (!verifier) return fail("missing PKCE verifier (session expired)");
  clearCookie(res, "cp_pkce");
  clearCookie(res, "cp_state");
  try {
    const tokenRes = await fetch(`${COINPAY_ISSUER}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(req.query.code),
        redirect_uri: REDIRECT_URI,
        client_id: COINPAY_CLIENT_ID,
        client_secret: COINPAY_CLIENT_SECRET,
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) return fail(`token exchange (${tokenRes.status})`);
    const tokens = await tokenRes.json();
    const infoRes = await fetch(`${COINPAY_ISSUER}/api/oauth/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return fail(`userinfo (${infoRes.status})`);
    const info = await infoRes.json();
    if (!info.sub) return fail("no subject in userinfo");
    await upsertUser({ sub: info.sub, email: info.email, name: info.name });
    setCookie(res, "mc_session", signSession({ sub: info.sub, email: info.email || null, name: info.name || null }), { maxAge: SESSION_TTL });
    res.redirect("/");
  } catch (err) {
    console.error("[auth] callback error:", err.message);
    fail("unexpected error");
  }
});

app.post("/auth/logout", (req, res) => {
  clearCookie(res, "mc_session");
  res.json({ ok: true });
});

app.post("/api/waitlist", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "That doesn't look like an email." });
  }
  const dn = req.body?.dn ? safeDomain(req.body.dn) : null;
  if (req.body?.dn && !dn) return res.status(400).json({ error: "invalid domain" });
  try {
    const result = await addSignup({ email, dn: dn || "moshcoding.com", ua: req.get("user-agent") });
    res.json(result);
  } catch (err) {
    console.error("waitlist insert failed:", err.message);
    res.status(500).json({ error: "Couldn't save that. Try again." });
  }
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// everything else falls back to the SPA shell (so /?dn=... always works)
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`moshcoding listening on :${PORT}  (db → Turso)`));
  })
  .catch((err) => {
    console.error("Failed to init Turso schema:", err.message);
    process.exit(1);
  });

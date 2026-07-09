import express from "express";
import fs from "node:fs";
import path from "node:path";
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
  const file = path.join(CONFIG_DIR, `${dn}.json`);
  if (fs.existsSync(file)) {
    try {
      const override = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...base, ...override, dn };
    } catch { /* fall through to default */ }
  }
  return base;
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

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const CONFIG_DIR = path.join(__dirname, "configs");
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.jsonl");

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * tiny append-only waitlist store (no native deps, Railway-friendly)  *
 * ------------------------------------------------------------------ */
const seen = new Set(); // `${dn}\n${email}` dedupe, loaded at boot
if (fs.existsSync(WAITLIST_FILE)) {
  for (const line of fs.readFileSync(WAITLIST_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const { email, dn } = JSON.parse(line);
      if (email) seen.add(`${dn || ""}\n${email.toLowerCase()}`);
    } catch { /* skip malformed line */ }
  }
}

function addSignup({ email, dn, ua }) {
  const key = `${dn || ""}\n${email.toLowerCase()}`;
  if (seen.has(key)) return { ok: true, already: true };
  seen.add(key);
  const row = { email, dn: dn || null, ts: new Date().toISOString(), ua: (ua || "").slice(0, 300) };
  fs.appendFileSync(WAITLIST_FILE, JSON.stringify(row) + "\n");
  return { ok: true, already: false, count: seen.size };
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

app.get("/healthz", (_req, res) => res.json({ ok: true, count: seen.size }));

app.get("/api/config", (req, res) => {
  const dn = safeDomain(req.query.dn);
  if (!dn) return res.status(400).json({ error: "invalid domain" });
  res.json(configFor(dn));
});

app.post("/api/waitlist", (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "That doesn't look like an email." });
  }
  const dn = req.body?.dn ? safeDomain(req.body.dn) : null;
  if (req.body?.dn && !dn) return res.status(400).json({ error: "invalid domain" });
  const result = addSignup({ email, dn: dn || "moshcoding.com", ua: req.get("user-agent") });
  res.json(result);
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// everything else falls back to the SPA shell (so /?dn=... always works)
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`moshcoding listening on :${PORT}  (data → ${DATA_DIR})`));

import crypto from "node:crypto";
import { db, activeDomainWebhooks } from "./db";

const TOLERANCE = 300; // seconds

/* ---- Standard Webhooks signing (interoperates with coinpay/crawlproof) ---- */
export function signWebhook(id: string, tsSec: number, body: string, secret: string) {
  const mac = crypto.createHmac("sha256", secret).update(`${id}.${tsSec}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(tsSec),
    "webhook-signature": `v1,${mac}`,
  };
}

export function verifyWebhook(headers: Record<string, string | null | undefined>, body: string, secret: string): boolean {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
  if (!id || !ts || !sig) return false;
  const tsNum = parseInt(String(ts), 10);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > TOLERANCE) return false;
  const expected = `v1,${crypto.createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const expectedBytes = Buffer.from(expected);
  return String(sig)
    .split(/\s+/)
    .filter(Boolean)
    .some((candidate) => {
      const candidateBytes = Buffer.from(candidate.trim());
      return candidateBytes.length === expectedBytes.length && crypto.timingSafeEqual(candidateBytes, expectedBytes);
    });
}

export function newSecret(prefix = "whsec_") {
  return prefix + crypto.randomBytes(24).toString("base64url");
}

/* ---- SSRF guard: never POST to internal/loopback/link-local addresses ---- */
export function isInternalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return true;
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") return true;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "metadata.google.internal") return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/* ---- per-domain outbound delivery (best-effort, no owner server needed) ---- */
/**
 * Fires a parked-domain event to every active target URL for that domain,
 * Standard-Webhooks-signed with each target's secret. Best-effort and
 * SSRF-guarded; never throws (so it can't break the triggering request).
 */
export async function fireDomainEvent(dn: string, type: string, data: unknown): Promise<void> {
  let targets: { url: string; secret: string }[] = [];
  try { targets = await activeDomainWebhooks(dn); } catch { return; }
  if (!targets.length) return;
  const id = "evt_" + crypto.randomBytes(12).toString("hex");
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id, type, dn, data, created_at: new Date().toISOString() });
  await Promise.allSettled(
    targets.map(async (t) => {
      if (isInternalUrl(t.url)) return;
      try {
        await fetch(t.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...signWebhook(id, ts, body, t.secret) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch { /* best-effort */ }
    }),
  );
}

/* ---- outbound delivery ---- */
export function eventEnvelope(type: string, data: unknown, projectId: string) {
  const id = "evt_" + crypto.randomBytes(12).toString("hex");
  return { id, type, data, created_at: new Date().toISOString(), project_id: projectId };
}

/** Dispatch an event to every active endpoint of a project that subscribes to it. */
export async function dispatchEvent(projectId: string, type: string, data: unknown) {
  const { rows } = await db().execute({
    sql: `SELECT id, url, secret, events FROM webhook_endpoints WHERE project_id = ? AND active = 1`,
    args: [projectId],
  });
  const results: any[] = [];
  for (const ep of rows as any[]) {
    let events: string[] = ["*"];
    try { events = JSON.parse(ep.events); } catch { /* default */ }
    if (!events.includes("*") && !events.includes(type)) continue;
    results.push(await deliverToEndpoint(String(ep.id), String(ep.url), String(ep.secret), type, data, projectId));
  }
  return results;
}

/** Deliver a single event to one endpoint, recording the attempt. */
export async function deliverToEndpoint(
  endpointId: string, url: string, secret: string, type: string, data: unknown, projectId: string
) {
  const envelope = eventEnvelope(type, data, projectId);
  const body = JSON.stringify(envelope);
  const deliveryId = envelope.id;

  if (isInternalUrl(url)) {
    await recordDelivery(endpointId, type, body, deliveryId, "dead_letter", 1, null, "blocked: internal url");
    return { ok: false, error: "internal url blocked" };
  }
  const ts = Math.floor(Date.now() / 1000);
  const headers = {
    "content-type": "application/json",
    "user-agent": "moshcoding-webhooks/1",
    ...signWebhook(deliveryId, ts, body, secret),
  };
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    const ok = res.ok;
    await recordDelivery(endpointId, type, body, deliveryId, ok ? "delivered" : "failed", 1, res.status, ok ? null : `HTTP ${res.status}`);
    return { ok, status: res.status };
  } catch (err: any) {
    await recordDelivery(endpointId, type, body, deliveryId, "failed", 1, null, err?.message || "network error");
    return { ok: false, error: err?.message };
  }
}

async function recordDelivery(
  endpointId: string, type: string, body: string, idem: string,
  status: string, attempts: number, responseStatus: number | null, err: string | null
) {
  await db().execute({
    sql: `INSERT INTO webhook_deliveries
            (endpoint_id, event_type, payload, idempotency_key, status, attempts, response_status, last_error, next_attempt_at, delivered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?,
            CASE WHEN ?='failed' THEN datetime('now', '+30 seconds') END,
            CASE WHEN ?='delivered' THEN datetime('now') END)
          ON CONFLICT (endpoint_id, idempotency_key) DO UPDATE SET
            status=excluded.status, attempts=webhook_deliveries.attempts+1,
            response_status=excluded.response_status, last_error=excluded.last_error,
            next_attempt_at=CASE
              WHEN excluded.status='failed'
                THEN datetime('now', '+' || min(1800, 30 * (1 << min(webhook_deliveries.attempts, 6))) || ' seconds')
              ELSE NULL
            END,
            delivered_at=CASE WHEN excluded.status='delivered' THEN datetime('now') ELSE webhook_deliveries.delivered_at END`,
    args: [endpointId, type, body, idem, status, attempts, responseStatus, err, status, status],
  });
}

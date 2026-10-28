// A @profullstack/webhooks store on the app's own libSQL-shaped client.
//
// The package ships sqliteStore (bun:sqlite & co.) and postgresStore (a pg
// pool); this app talks to both engines through one @libsql/client surface
// (`db()`: Postgres via @profullstack/libsql-pg in production, a `file:`
// database locally and in the tests), so the store is written against that.
// The tables are the package's own DDL with a `hub_` prefix (the unprefixed
// names are the pre-hub `webhook_endpoints`/`webhook_deliveries`), created in
// initSchema (lib/db.ts) along with the one-time copy of the old rows.

import type { Client } from "@libsql/client";
import type { Delivery, Endpoint, WebhookStore } from "@profullstack/webhooks";

export const HUB_PREFIX = "hub_";
export const HUB_ENDPOINTS = `${HUB_PREFIX}webhook_endpoints`;
export const HUB_DELIVERIES = `${HUB_PREFIX}webhook_deliveries`;

const ENDPOINT_COLS = "id, owner, url, secret, events, description, enabled, failures, disabled_reason, created_at, updated_at";
const DELIVERY_COLS = "id, endpoint_id, owner, event_id, event_type, payload, status, attempts, next_at, last_status, last_error, created_at, updated_at";

const ENDPOINT_FIELDS: Record<string, string> = {
  url: "url", secret: "secret", events: "events", description: "description", enabled: "enabled",
  failures: "failures", disabledReason: "disabled_reason", updatedAt: "updated_at",
};
const DELIVERY_FIELDS: Record<string, string> = {
  status: "status", attempts: "attempts", nextAt: "next_at", lastStatus: "last_status", lastError: "last_error", updatedAt: "updated_at",
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toEndpoint(r: any): Endpoint | null {
  if (!r) return null;
  let events: string[] = ["*"];
  try { events = JSON.parse(String(r.events)); } catch { /* default */ }
  return {
    id: String(r.id),
    owner: String(r.owner),
    url: String(r.url),
    secret: String(r.secret),
    events,
    description: r.description == null ? "" : String(r.description),
    enabled: Number(r.enabled) === 1 || r.enabled === true,
    failures: Number(r.failures ?? 0),
    disabledReason: r.disabled_reason == null ? null : String(r.disabled_reason),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toDelivery(r: any): Delivery | null {
  if (!r) return null;
  return {
    id: String(r.id),
    endpointId: String(r.endpoint_id),
    owner: String(r.owner),
    eventId: String(r.event_id),
    eventType: String(r.event_type),
    payload: String(r.payload),
    status: String(r.status) as Delivery["status"],
    attempts: Number(r.attempts ?? 0),
    nextAt: Number(r.next_at),
    lastStatus: num(r.last_status),
    lastError: r.last_error == null ? null : String(r.last_error),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// libSQL's remote client throws on `undefined` (a local file binds it as null),
// so every value is normalised before it is bound.
function sqlValue(key: string, value: unknown): string | number | null {
  if (key === "events") return JSON.stringify(value ?? ["*"]);
  if (key === "enabled") return value ? 1 : 0;
  if (value === undefined || value === null) return null;
  return value as string | number;
}

/**
 * `ready` runs before every statement: the app's ensureSchema(), so the tables
 * exist (and the old rows are copied) before the first read.
 */
export function libsqlStore(client: () => Client, ready: () => Promise<void> = async () => {}): WebhookStore {
  const all = async (sql: string, args: (string | number | null)[] = []) => {
    await ready();
    return (await client().execute({ sql, args })).rows as any[];
  };
  const run = async (sql: string, args: (string | number | null)[] = []) => {
    await ready();
    await client().execute({ sql, args });
  };
  const update = async (table: string, fields: Record<string, string>, id: string, patch: Record<string, unknown>) => {
    const keys = Object.keys(patch).filter((k) => fields[k] && patch[k] !== undefined);
    if (!keys.length) return;
    await run(
      `UPDATE ${table} SET ${keys.map((k) => `${fields[k]} = ?`).join(", ")} WHERE id = ?`,
      [...keys.map((k) => sqlValue(k, patch[k])), id],
    );
  };

  return {
    async insertEndpoint(e) {
      await run(`INSERT INTO ${HUB_ENDPOINTS} (${ENDPOINT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        e.id, e.owner, e.url, e.secret, JSON.stringify(e.events), e.description ?? "", e.enabled ? 1 : 0,
        e.failures ?? 0, e.disabledReason ?? null, e.createdAt, e.updatedAt,
      ]);
    },
    async getEndpoint(id) {
      return toEndpoint((await all(`SELECT ${ENDPOINT_COLS} FROM ${HUB_ENDPOINTS} WHERE id = ?`, [id]))[0]);
    },
    async listEndpoints(owner) {
      return (await all(`SELECT ${ENDPOINT_COLS} FROM ${HUB_ENDPOINTS} WHERE owner = ? ORDER BY created_at, id`, [owner]))
        .map((r) => toEndpoint(r)!);
    },
    updateEndpoint: (id, patch) => update(HUB_ENDPOINTS, ENDPOINT_FIELDS, id, patch as Record<string, unknown>),
    async deleteEndpoint(id) {
      await run(`DELETE FROM ${HUB_DELIVERIES} WHERE endpoint_id = ?`, [id]);
      await run(`DELETE FROM ${HUB_ENDPOINTS} WHERE id = ?`, [id]);
    },
    async insertDeliveries(rows) {
      for (const d of rows) {
        await run(`INSERT INTO ${HUB_DELIVERIES} (${DELIVERY_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          d.id, d.endpointId, d.owner, d.eventId, d.eventType, d.payload, d.status, d.attempts, d.nextAt,
          d.lastStatus ?? null, d.lastError ?? null, d.createdAt, d.updatedAt,
        ]);
      }
    },
    async getDelivery(id) {
      return toDelivery((await all(`SELECT ${DELIVERY_COLS} FROM ${HUB_DELIVERIES} WHERE id = ?`, [id]))[0]);
    },
    async listDeliveries({ owner, endpointId, limit = 50 }) {
      const where = endpointId ? "owner = ? AND endpoint_id = ?" : "owner = ?";
      const args = endpointId ? [owner, endpointId] : [owner];
      return (await all(`SELECT ${DELIVERY_COLS} FROM ${HUB_DELIVERIES} WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, [...args, limit]))
        .map((r) => toDelivery(r)!);
    },
    updateDelivery: (id, patch) => update(HUB_DELIVERIES, DELIVERY_FIELDS, id, patch as Record<string, unknown>),
    /**
     * Takes due rows by pushing their next_at past the lease in one statement.
     * The outer `next_at <= ?` is re-checked against the row Postgres actually
     * locks, so two drainers racing on one row cannot both take it.
     */
    async claimDue(now, limit, leaseMs) {
      const rows = await all(
        `UPDATE ${HUB_DELIVERIES} SET next_at = ?
          WHERE id IN (SELECT id FROM ${HUB_DELIVERIES} WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?)
            AND status = 'pending' AND next_at <= ?
          RETURNING ${DELIVERY_COLS}`,
        [now + leaseMs, now, limit, now],
      );
      // RETURNING carries the new next_at; the hub only reads the rest. Oldest first.
      return rows.map((r) => toDelivery(r)!).sort((a, b) => a.createdAt - b.createdAt);
    },
    async prune(before) {
      await run(`DELETE FROM ${HUB_DELIVERIES} WHERE status <> 'pending' AND updated_at < ?`, [before]);
    },
  };
}

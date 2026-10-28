// Outbound webhooks on @profullstack/webhooks: customers register endpoints,
// the app emits events, the hub signs (Standard Webhooks), queues, retries with
// backoff and logs every delivery in the database.
//
// Two kinds of owner share one hub:
//   dn:<domain>     a parked domain's targets (dashboard "Webhooks" tab, and
//                   /api/v1/webhooks?dn=<domain> with an API key)
//   project:<id>    a project's outbound endpoints (/api/projects/:id/webhooks)
//
// Endpoints created before the hub were copied into its tables with their ids,
// URLs, subscriptions and signing keys (see migrateLegacyWebhooks in lib/db.ts),
// so receivers keep verifying without changing anything.

import { Webhooks, WebhookError, type PublicEndpoint } from "@profullstack/webhooks";
import { db, ensureSchema } from "./db";
import { libsqlStore, HUB_ENDPOINTS } from "./webhook-store";
import { isInternalUrl, isSelfWebhookUrl } from "./url-guard";
import { RELAY_HOP_HEADER } from "./webhook-events";
export { newSecret, signWebhook, verifyWebhook } from "./webhook-signing";

export { isInternalUrl, isSelfWebhookUrl, WebhookError };

/** The events a domain's targets can subscribe to. `inbound.*` relays whatever arrived at /api/webhooks/<dn>. */
export const WEBHOOK_EVENT_TYPES = [
  "waitlist.signup",
  "bid.placed",
  "bid.won",
  "bid.accepted",
  "inbound.*",
];

export const domainOwner = (dn: string) => `dn:${dn.trim().toLowerCase()}`;
export const projectOwner = (projectId: string) => `project:${projectId}`;

// process.env[name] with a computed key: Next.js inlines process.env.LITERAL at build time.
const env = (name: string) => process.env[name] ?? "";

/** fetch that refuses our own inbound receivers: delivering there would feed the relay loop. */
const guardedFetch: typeof fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (isSelfWebhookUrl(url)) throw new Error("blocked: self-referential url");
  return fetch(input, init);
}) as typeof fetch;

/**
 * Headers every delivery carried before the hub, kept so receivers that read
 * them still work: the relay hop counter (receivers and our own inbound route
 * use it to stop loops) and the user agent.
 */
function legacyHeaders({ body }: { body: string }): Record<string, string> {
  let hop = 1;
  try {
    const h = Number(JSON.parse(body)?.data?.relay_hop);
    if (Number.isInteger(h) && h > 0) hop = h;
  } catch { /* not JSON: first hop */ }
  return { "user-agent": "moshcoding-webhooks/1", [RELAY_HOP_HEADER]: String(hop) };
}

export type HooksOptions = { fetchImpl?: typeof fetch; guard?: { allowHttp?: boolean; allowPrivate?: boolean; lookup?: (host: string) => Promise<string[]> } };

export function createHooks(opts: HooksOptions = {}): Webhooks {
  return new Webhooks({
    store: libsqlStore(db, ensureSchema),
    source: env("APP_BASE_URL") || "https://moshcoding.com",
    eventTypes: WEBHOOK_EVENT_TYPES,
    maxEndpoints: 25,
    extraHeaders: legacyHeaders,
    fetchImpl: opts.fetchImpl ?? guardedFetch,
    guard: opts.guard ?? {},
    log: (m) => console.warn(m),
  });
}

let _hooks: Webhooks | undefined;
/** The process-wide hub. instrumentation.ts calls start() on it once at boot. */
export function hooks(): Webhooks {
  return (_hooks ??= createHooks());
}
/** For tests: swap in a hub with a fake fetch / DNS guard. */
export function setHooksForTests(h: Webhooks | undefined) {
  _hooks = h;
}

/* ---- domain events ------------------------------------------------------- */

/**
 * Queues a parked-domain event for every subscribed target of that domain.
 * Never throws, so it can't break the request that triggered it.
 *
 * `opts.hop` is the hop count of the event that triggered this fan-out; the
 * delivery carries hop+1 (in data.relay_hop and the x-moshcoding-hop header)
 * so a receiver can tell how far an event has travelled.
 */
export async function fireDomainEvent(dn: string, type: string, data: unknown, opts: { hop?: number } = {}): Promise<void> {
  try {
    const payload = opts.hop !== undefined && data && typeof data === "object"
      ? { ...(data as Record<string, unknown>), relay_hop: opts.hop + 1 }
      : data;
    await hooks().emit(domainOwner(dn), type, payload, { subject: dn.toLowerCase() });
  } catch (e: any) {
    console.warn(`webhooks: emit ${type} for ${dn} failed: ${e?.message}`);
  }
}

export type DomainWebhook = { id: string; dn: string; url: string; secret: string; events: string[]; active: boolean; failures: number; disabled_reason: string | null; created_at: string };

async function withSecret(owner: string, dn: string, e: PublicEndpoint): Promise<DomainWebhook> {
  const { secret } = await hooks().secret(owner, e.id);
  return { id: e.id, dn, url: e.url, secret, events: e.events, active: e.enabled, failures: e.failures, disabled_reason: e.disabled_reason, created_at: e.created_at };
}

export async function listDomainWebhooks(dn: string): Promise<DomainWebhook[]> {
  const owner = domainOwner(dn);
  const list = await hooks().listEndpoints(owner);
  return Promise.all(list.map((e) => withSecret(owner, dn.toLowerCase(), e)));
}

/** Adds a target; throws WebhookError (status 400/409) for a URL or event list the hub refuses. */
export async function addDomainWebhook(dn: string, url: string, events?: string[] | string): Promise<DomainWebhook> {
  const owner = domainOwner(dn);
  const { endpoint, secret } = await hooks().createEndpoint(owner, { url, events });
  return { id: endpoint.id, dn: dn.toLowerCase(), url: endpoint.url, secret, events: endpoint.events, active: endpoint.enabled, failures: 0, disabled_reason: null, created_at: endpoint.created_at };
}

const notFound = (e: unknown) => e instanceof WebhookError && e.status === 404;

export async function deleteDomainWebhook(id: string, dn: string): Promise<boolean> {
  try { await hooks().deleteEndpoint(domainOwner(dn), id); return true; } catch (e) { if (notFound(e)) return false; throw e; }
}

/** Pause or resume one outbound target without discarding its signing secret. */
export async function setDomainWebhookActive(id: string, dn: string, active: boolean): Promise<boolean> {
  try { await hooks().updateEndpoint(domainOwner(dn), id, { enabled: active }); return true; } catch (e) { if (notFound(e)) return false; throw e; }
}

/** A new signing secret for one target; the old one stops working at once. */
export async function rotateDomainWebhookSecret(id: string, dn: string): Promise<string | null> {
  try { return (await hooks().rotateSecret(domainOwner(dn), id)).secret; } catch (e) { if (notFound(e)) return null; throw e; }
}

/** Sends `webhook.test` now to one target, or to every enabled target of the domain. */
export async function testDomainWebhooks(dn: string, id?: string) {
  const owner = domainOwner(dn);
  const ids = id ? [id] : (await hooks().listEndpoints(owner)).filter((e) => e.enabled).map((e) => e.id);
  const results = [];
  for (const one of ids) results.push({ id: one, ...(await hooks().test(owner, one)) });
  return results;
}

export async function domainDeliveries(dn: string, limit = 25) {
  return hooks().deliveries(domainOwner(dn), { limit });
}

/* ---- project endpoints --------------------------------------------------- */

/** The row shape /api/projects/:id/webhooks has always answered with. */
export function projectEndpointRow(e: PublicEndpoint) {
  return { id: e.id, url: e.url, events: JSON.stringify(e.events), active: e.enabled ? 1 : 0, created_at: e.created_at };
}

export async function listProjectWebhooks(projectId: string) {
  return (await hooks().listEndpoints(projectOwner(projectId))).map(projectEndpointRow);
}

/**
 * Creates a project endpoint. `events` was already normalised with the app's
 * own grammar (normalizeWebhookEventSubscriptions), which is wider than the
 * hub's list of domain events, so the subscription is written to the store
 * after the hub has made (and validated the URL of) the endpoint.
 */
export async function createProjectWebhook(projectId: string, url: string, events: string[]) {
  const { endpoint, secret } = await hooks().createEndpoint(projectOwner(projectId), { url });
  if (!(events.length === 1 && events[0] === "*")) await libsqlStore(db, ensureSchema).updateEndpoint(endpoint.id, { events, updatedAt: Date.now() });
  return { endpoint: projectEndpointRow({ ...endpoint, events }), secret };
}

/** Pause or resume one project webhook without discarding its signing secret. */
export async function setProjectWebhookActive(id: string, projectId: string, active: boolean): Promise<boolean> {
  try { await hooks().updateEndpoint(projectOwner(projectId), id, { enabled: active }); return true; } catch (e) { if (notFound(e)) return false; throw e; }
}

/** Delete one project webhook and its delivery history. */
export async function deleteProjectWebhook(id: string, projectId: string): Promise<boolean> {
  try { await hooks().deleteEndpoint(projectOwner(projectId), id); return true; } catch (e) { if (notFound(e)) return false; throw e; }
}

/** Queue an event for a project's subscribed, enabled endpoints. */
export async function dispatchEvent(projectId: string, type: string, data: unknown) {
  return hooks().emit(projectOwner(projectId), type, data, { subject: projectId });
}

/** Send `webhook.test` now to every enabled endpoint of a project, whatever it subscribes to. */
export async function testProjectWebhooks(projectId: string) {
  const owner = projectOwner(projectId);
  const enabled = (await hooks().listEndpoints(owner)).filter((e) => e.enabled);
  const results = [];
  for (const e of enabled) results.push(await hooks().test(owner, e.id));
  return results;
}

/** Distinct outbound URLs across the given projects, to pre-fill a domain target. */
export async function distinctWebhookUrls(projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  await ensureSchema();
  const placeholders = projectIds.map(() => "?").join(",");
  const r = await db().execute({
    sql: `SELECT url, MAX(created_at) AS latest FROM ${HUB_ENDPOINTS} WHERE owner IN (${placeholders}) GROUP BY url ORDER BY latest DESC LIMIT 25`,
    args: projectIds.map(projectOwner),
  });
  return r.rows.map((x: any) => String(x.url)).filter(Boolean);
}


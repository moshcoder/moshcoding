import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { safeDomain } from "@/lib/config";
import { accountIdForCoinpay, accountOwnsDomain, listInboundEvents } from "@/lib/db";
import {
  addDomainWebhook,
  deleteDomainWebhook,
  distinctWebhookUrls,
  domainDeliveries,
  isInternalUrl,
  isSelfWebhookUrl,
  listDomainWebhooks,
  rotateDomainWebhookSecret,
  setDomainWebhookActive,
  testDomainWebhooks,
  WebhookError,
  WEBHOOK_EVENT_TYPES,
} from "@/lib/webhooks";
import { listAccessibleProjectIds } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveAccountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  return accountIdForCoinpay(s.sub, s.email);
}

function inboundUrl(req: NextRequest, dn: string): string {
  const base = process.env.APP_BASE_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/webhooks/${dn}`;
}

// GET /api/domain-webhooks?dn= — owner: inbound URL + outbound targets + recent inbound events.
export async function GET(req: NextRequest) {
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "bad domain" }, { status: 400 });
  const accountId = await resolveAccountId(req);
  if (!accountId || !(await accountOwnsDomain(accountId, dn))) {
    return NextResponse.json({ error: "You don't own this domain." }, { status: 403 });
  }
  // Suggest target URLs the user already uses on their project webhooks
  // (orgs → teams → projects), so a domain webhook can auto-populate.
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  let knownUrls: string[] = [];
  if (s?.sub) {
    try { knownUrls = await distinctWebhookUrls(await listAccessibleProjectIds(s.sub)); } catch { /* best-effort */ }
  }

  const [webhooks, events, deliveries] = await Promise.all([listDomainWebhooks(dn), listInboundEvents(dn, 25), domainDeliveries(dn, 25)]);
  // Don't re-suggest URLs already added as targets for this domain.
  const have = new Set(webhooks.map((w) => w.url));
  return NextResponse.json({
    dn,
    inboundUrl: inboundUrl(req, dn),
    webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, secret: w.secret, events: w.events, active: w.active, failures: w.failures, disabled_reason: w.disabled_reason, created_at: w.created_at })),
    events,
    deliveries: deliveries.map(({ payload: _p, ...d }) => d),
    eventTypes: WEBHOOK_EVENT_TYPES,
    knownUrls: knownUrls.filter((u) => !have.has(u)),
  });
}

// POST /api/domain-webhooks — owner: add, pause/resume, rotate, delete, or test a target.
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return NextResponse.json({ error: "Sign in to manage webhooks." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const dn = safeDomain(body.dn);
  if (!dn) return NextResponse.json({ error: "Invalid domain." }, { status: 400 });
  if (!(await accountOwnsDomain(accountId, dn))) {
    return NextResponse.json({ error: "You don't own this domain." }, { status: 403 });
  }

  if (body.action === "delete") {
    const ok = await deleteDomainWebhook(String(body.id || ""), dn);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  if (body.action === "setActive") {
    const id = String(body.id || "");
    if (!id || typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Webhook id and active state are required." }, { status: 400 });
    }
    const ok = await setDomainWebhookActive(id, dn, body.active);
    if (!ok) return NextResponse.json({ error: "Webhook target not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id, active: body.active });
  }

  if (body.action === "rotate") {
    const secret = await rotateDomainWebhookSecret(String(body.id || ""), dn);
    if (!secret) return NextResponse.json({ error: "Webhook target not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id: String(body.id), secret });
  }

  // Sends webhook.test now: to one target (`id`) or every active one.
  if (body.action === "test") {
    try {
      const results = await testDomainWebhooks(dn, body.id ? String(body.id) : undefined);
      return NextResponse.json({ ok: true, sent: results.length > 0, results });
    } catch (e) {
      if (e instanceof WebhookError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }

  // Default: add an outbound target.
  const url = String(body.url || "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
  }
  if (isInternalUrl(url)) {
    return NextResponse.json({ error: "That URL points to an internal/loopback address." }, { status: 400 });
  }
  if (isSelfWebhookUrl(url)) {
    return NextResponse.json({ error: "That's an inbound receiver URL — sending events there would loop back into this dashboard. Use the URL of your own server." }, { status: 400 });
  }
  try {
    const wh = await addDomainWebhook(dn, url, body.events);
    return NextResponse.json({ ok: true, webhook: { id: wh.id, url: wh.url, secret: wh.secret, events: wh.events, active: wh.active } }, { status: 201 });
  } catch (e) {
    if (e instanceof WebhookError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

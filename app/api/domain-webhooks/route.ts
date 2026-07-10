import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { safeDomain } from "@/lib/config";
import {
  findOrCreateAccountByEmail,
  accountOwnsDomain,
  listDomainWebhooks,
  addDomainWebhook,
  deleteDomainWebhook,
  listInboundEvents,
  distinctWebhookUrls,
} from "@/lib/db";
import { fireDomainEvent, newSecret, isInternalUrl } from "@/lib/webhooks";
import { listAccessibleProjectIds } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveAccountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
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

  const [webhooks, events] = await Promise.all([listDomainWebhooks(dn), listInboundEvents(dn, 25)]);
  // Don't re-suggest URLs already added as targets for this domain.
  const have = new Set(webhooks.map((w) => w.url));
  return NextResponse.json({
    dn,
    inboundUrl: inboundUrl(req, dn),
    webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, secret: w.secret, active: w.active, created_at: w.created_at })),
    events,
    knownUrls: knownUrls.filter((u) => !have.has(u)),
  });
}

// POST /api/domain-webhooks — owner: add a target, delete one, or send a test.
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

  if (body.action === "test") {
    await fireDomainEvent(dn, "test.ping", { message: "Test event from moshcoding", dn });
    return NextResponse.json({ ok: true, sent: true });
  }

  // Default: add an outbound target.
  const url = String(body.url || "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
  }
  if (isInternalUrl(url)) {
    return NextResponse.json({ error: "That URL points to an internal/loopback address." }, { status: 400 });
  }
  const wh = await addDomainWebhook(dn, url, newSecret());
  return NextResponse.json({ ok: true, webhook: { id: wh.id, url: wh.url, secret: wh.secret, active: wh.active } }, { status: 201 });
}

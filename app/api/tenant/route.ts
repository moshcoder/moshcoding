import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import {
  findOrCreateAccountByEmail, ownsParkedDomain, addParkedDomain, removeParkedDomain,
  listParkedDomains, getTenantConfig, upsertTenant,
} from "@/lib/db";
import { safeDomain } from "@/lib/config";
import { sanitizeTenantConfig } from "@/lib/tenant-config";
import { listRepoAssets } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-domain (per-"project") tenant settings. Each parked domain has its OWN
// config in the tenants table — this is the CRUD surface for it. Ownership is
// enforced via parked_domains.
async function accountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

// GET /api/tenant?dn=<domain> → that domain's config (owner only).
export async function GET(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });
  return NextResponse.json({ dn, config: (await getTenantConfig(dn)) || {}, pageUrl: `/?dn=${encodeURIComponent(dn)}` });
}

// POST /api/tenant           { addDomain } -> park a new domain
// POST /api/tenant?dn=<d>     { ...config } -> save that domain's config
export async function POST(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Add a parked domain (project).
  if (body?.addDomain) {
    const dn = safeDomain(body.addDomain);
    if (!dn) return NextResponse.json({ error: "Enter a valid domain name." }, { status: 400 });
    await addParkedDomain(id, dn);
    return NextResponse.json({ ok: true, dn, domains: await listParkedDomains(id) });
  }

  const dn = safeDomain(req.nextUrl.searchParams.get("dn") || body?.dn);
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });

  const src = body?.config ? body.config : body;
  const config = sanitizeTenantConfig(src);
  let warning: string | undefined;
  if (config.repo) {
    try {
      config.assets = await listRepoAssets(config.repo, { pattern: config.assetPattern });
    } catch (e: any) {
      warning = `Couldn't load assets from ${config.repo}: ${e?.message || e}`;
      const prior = (await getTenantConfig(dn)) as any;
      if (Array.isArray(prior?.assets)) config.assets = prior.assets;
    }
  }
  await upsertTenant(dn, id, config);
  return NextResponse.json({ dn, config, pageUrl: `/?dn=${encodeURIComponent(dn)}`, ...(warning ? { warning } : {}) });
}

// DELETE /api/tenant?dn=<domain> → un-park it (removes the page + config).
export async function DELETE(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });
  await removeParkedDomain(id, dn);
  return NextResponse.json({ ok: true, domains: await listParkedDomains(id) });
}

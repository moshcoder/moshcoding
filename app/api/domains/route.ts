import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { getAccountById, listParkedDomains, accountOwnsDomain } from "@/lib/db";
import { safeDomain } from "@/lib/config";
import {
  railwayConfigured, listCustomDomains, createCustomDomain, deleteCustomDomain,
  type CustomDomain,
} from "@/lib/railway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The domains this account owns (their tenant domain + parked domains). */
async function ownedDomains(accountId: string): Promise<string[]> {
  const acct = await getAccountById(accountId);
  const parked = await listParkedDomains(accountId);
  const set = new Set<string>();
  for (const d of [acct?.domain, ...parked.map((p) => p.domain)]) {
    const dn = safeDomain(d);
    if (dn) set.add(dn);
  }
  return [...set];
}

/** Turn a raw Railway custom-domain record into the friendly UI shape. */
function record(cd: CustomDomain | undefined, apex: boolean) {
  const r = cd?.dnsRecords?.[0];
  return {
    host: apex ? "@" : "www",
    type: apex ? "ALIAS" : "CNAME",
    value: r?.requiredValue || "",
    status: (r?.status || "").replace("DNS_RECORD_STATUS_", "").toLowerCase() || "not added",
    registered: Boolean(cd),
    propagated: r?.status === "DNS_RECORD_STATUS_PROPAGATED",
  };
}

// List the caller's own domains with their DNS records + live status.
export async function GET(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();
  if (!railwayConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const owned = await ownedDomains(id);
  const { customDomains } = await listCustomDomains();
  const byDomain = new Map(customDomains.map((c) => [c.domain, c]));

  const domains = owned.map((dn) => {
    const apex = record(byDomain.get(dn), true);
    const www = record(byDomain.get(`www.${dn}`), false);
    return {
      domain: dn,
      registered: apex.registered,
      live: apex.propagated && www.propagated,
      records: [apex, www],
    };
  });
  return NextResponse.json({ configured: true, domains });
}

// Park one of the caller's domains here: create the apex + www custom domains.
export async function POST(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();
  if (!railwayConfigured()) return bad("Custom domains aren't enabled yet.", 503);

  const body = await req.json().catch(() => ({}));
  const dn = safeDomain(body?.domain);
  if (!dn) return bad("Enter a valid domain (e.g. yourdomain.com).");
  if (!(await accountOwnsDomain(id, dn))) {
    return bad("Claim that domain on the Domains tab first, then park it here.", 403);
  }

  const warnings: string[] = [];
  for (const d of [dn, `www.${dn}`]) {
    try {
      await createCustomDomain(d);
    } catch (e: any) {
      if (!/already|exists|taken/i.test(String(e?.message))) warnings.push(`${d}: ${e?.message || e}`);
    }
  }
  return NextResponse.json({ ok: true, warnings });
}

// Un-park a domain (remove its apex + www custom domains).
export async function DELETE(req: NextRequest) {
  const id = await resolveAccountId(req);
  if (!id) return unauthorized();
  if (!railwayConfigured()) return bad("Custom domains aren't enabled yet.", 503);
  const dn = safeDomain(req.nextUrl.searchParams.get("domain"));
  if (!dn) return bad("valid domain required");
  if (!(await accountOwnsDomain(id, dn))) return bad("You don't own that domain.", 403);

  const { customDomains } = await listCustomDomains();
  for (const c of customDomains.filter((c) => c.domain === dn || c.domain === `www.${dn}`)) {
    await deleteCustomDomain(c.id).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

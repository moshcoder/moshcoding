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

/** The routing record (ALIAS at the apex, CNAME on www) that points traffic here. */
function routingRecord(cd: CustomDomain | undefined, apex: boolean) {
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

/**
 * The TXT record Railway uses to verify domain ownership. Without it the domain
 * stays stuck "validating ownership" and never gets a TLS cert — a correct
 * ALIAS/CNAME is NOT enough on its own.
 */
function verifyRecord(cd: CustomDomain | undefined, apex: boolean) {
  if (!cd?.verificationToken) return null;
  return {
    host: cd.verificationDnsHost || (apex ? "_railway-verify" : "_railway-verify.www"),
    type: "TXT",
    value: cd.verificationToken,
    status: cd.verified ? "verified" : "not added",
    registered: Boolean(cd),
    propagated: cd.verified,
  };
}

/** A domain is truly live once Railway has issued its cert (ownership verified + DNS propagated). */
function isLive(cd: CustomDomain | undefined): boolean {
  if (!cd) return false;
  if (cd.certificateStatus) return cd.certificateStatus === "CERTIFICATE_STATUS_TYPE_VALID";
  const r = cd.dnsRecords?.[0];
  return Boolean(cd.verified) && r?.status === "DNS_RECORD_STATUS_PROPAGATED";
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
    const apexCd = byDomain.get(dn);
    const wwwCd = byDomain.get(`www.${dn}`);
    // Order the rows the way a user sets them: apex routing + its verify TXT,
    // then www routing + its verify TXT. Verify rows are omitted once Railway
    // stops handing out a token (i.e. nothing left to prove).
    const records = [
      routingRecord(apexCd, true),
      verifyRecord(apexCd, true),
      routingRecord(wwwCd, false),
      verifyRecord(wwwCd, false),
    ].filter(Boolean);
    return {
      domain: dn,
      registered: Boolean(apexCd),
      live: isLive(apexCd) && isLive(wwwCd),
      records,
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

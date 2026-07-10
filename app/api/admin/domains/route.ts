import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { getAccountById } from "@/lib/db";
import { safeDomain } from "@/lib/config";
import {
  railwayConfigured, listCustomDomains, createCustomDomain, deleteCustomDomain,
  isPropagated, type CustomDomain,
} from "@/lib/railway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest): Promise<boolean> {
  const id = await resolveAccountId(req);
  if (!id) return false;
  const acct = await getAccountById(id);
  return Boolean(acct?.is_admin);
}

/** UI shape: the DNS record(s) to set + Railway's live propagation status. */
function view(cd: CustomDomain) {
  return {
    id: cd.id,
    domain: cd.domain,
    apex: !cd.dnsRecords[0]?.hostlabel,
    records: cd.dnsRecords.map((r) => ({
      // apex (empty host) can't take a plain CNAME → set it as an ALIAS.
      host: r.hostlabel || "@",
      type: r.hostlabel ? "CNAME" : "ALIAS",
      value: r.requiredValue,
      status: r.status.replace("DNS_RECORD_STATUS_", "").toLowerCase(),
    })),
    propagated: isPropagated(cd),
  };
}

// List all custom domains + live DNS status. "Verify DNS" just re-calls this.
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return unauthorized();
  if (!railwayConfigured()) {
    return NextResponse.json({ configured: false, error: "Set RAILWAY_API_TOKEN to manage custom domains." });
  }
  const { customDomains, serviceDomain } = await listCustomDomains();
  return NextResponse.json({
    configured: true,
    serviceDomain,
    domains: customDomains.map(view).sort((a, b) => a.domain.localeCompare(b.domain)),
  });
}

// Point a parked domain here via DNS — adds the apex + www custom domains.
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return unauthorized();
  if (!railwayConfigured()) return bad("Set RAILWAY_API_TOKEN first.", 400);

  const body = await req.json().catch(() => ({}));
  const dn = safeDomain(body?.domain);
  if (!dn) return bad("Enter a valid domain (e.g. moshscript.com).");

  const targets = [dn, `www.${dn}`];
  const created: ReturnType<typeof view>[] = [];
  const warnings: string[] = [];
  for (const d of targets) {
    try {
      created.push(view(await createCustomDomain(d)));
    } catch (e: any) {
      // Already added? Not fatal — we'll surface it from the list.
      if (/already|exists|taken/i.test(String(e?.message))) warnings.push(`${d}: already added`);
      else warnings.push(`${d}: ${e?.message || e}`);
    }
  }
  const { customDomains } = await listCustomDomains();
  const domains = customDomains.filter((c) => c.domain === dn || c.domain === `www.${dn}`).map(view);
  return NextResponse.json({ ok: true, created, domains, warnings });
}

// Remove a parked domain (both apex + www).
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return unauthorized();
  if (!railwayConfigured()) return bad("Set RAILWAY_API_TOKEN first.", 400);
  const dn = safeDomain(req.nextUrl.searchParams.get("domain"));
  if (!dn) return bad("valid domain required");
  const { customDomains } = await listCustomDomains();
  const toDelete = customDomains.filter((c) => c.domain === dn || c.domain === `www.${dn}`);
  for (const c of toDelete) await deleteCustomDomain(c.id).catch(() => {});
  return NextResponse.json({ ok: true, removed: toDelete.map((c) => c.domain) });
}

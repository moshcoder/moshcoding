import { NextRequest, NextResponse } from "next/server";
import { readSession, authConfigured, SESSION_COOKIE } from "@/lib/session";
import { findOrCreateAccountByEmail, ownsParkedDomain, listDomainSignups } from "@/lib/db";
import { safeDomain } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function accountId(req: NextRequest): Promise<string | null> {
  if (!authConfigured()) return null;
  const s = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.sub?.startsWith("acct:")) return s.sub.slice("acct:".length);
  if (s.email) return (await findOrCreateAccountByEmail(s.email)).id;
  return null;
}

// GET /api/waitlist/manage?dn=<domain>[&format=csv] — the signups for one of the
// caller's parked domains. Each domain's waitlist is separate (signups.dn).
export async function GET(req: NextRequest) {
  const id = await accountId(req);
  if (!id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const dn = safeDomain(req.nextUrl.searchParams.get("dn"));
  if (!dn) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  if (!(await ownsParkedDomain(id, dn))) {
    return NextResponse.json({ error: "You don't own that domain." }, { status: 403 });
  }
  const signups = await listDomainSignups(dn);

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const rows = [["email", "verified", "ref", "created_at"]].concat(
      signups.map((s) => [s.email, s.verified ? "yes" : "no", s.ref || "", s.created_at]),
    );
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${dn}-waitlist.csv"`,
      },
    });
  }
  return NextResponse.json({ dn, count: signups.length, signups });
}

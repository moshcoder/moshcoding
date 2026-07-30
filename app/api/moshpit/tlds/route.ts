import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { getAccountById } from "@/lib/db";
import { listTlds, listTldsForAccount, registerTld } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/moshpit/tlds — the public registry, or `?mine=1` for yours. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("mine")) {
    const accountId = await resolveAccountId(req);
    if (!accountId) return unauthorized();
    return NextResponse.json({ tlds: await listTldsForAccount(accountId) });
  }
  return NextResponse.json({ tlds: await listTlds() });
}

/** POST /api/moshpit/tlds — claim `.<whatever>`. First writer wins. */
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const account = await getAccountById(accountId);

  const result = await registerTld({
    tld: body?.tld,
    accountId,
    ownerEmail: account?.email ?? null,
    ownerKey: typeof body?.owner_key === "string" ? body.owner_key : null,
  });

  // 409 rather than 400 when the name is gone: the request was well formed,
  // someone else simply got there first, and a client should be able to tell
  // those apart without parsing the message.
  if (!result.ok) return bad(result.error || "could not register that TLD", result.taken ? 409 : 400);
  return NextResponse.json({ tld: result.tld }, { status: 201 });
}

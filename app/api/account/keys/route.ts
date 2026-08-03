// API keys for the signed-in account.
//
// Session-authenticated only, deliberately: a key must not be able to mint
// another key. Otherwise one leak becomes permanent access that outlives
// revoking the key that leaked, and the revoke button stops meaning anything.

import { NextRequest, NextResponse } from "next/server";
import { resolveAccountId, bad, unauthorized } from "@/lib/api";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/apikeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account/keys — the account's keys. Never the tokens; they are not stored. */
export async function GET(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();
  return NextResponse.json({ keys: await listApiKeys(accountId) });
}

/**
 * POST /api/account/keys { name? } — mint one.
 *
 * The token comes back exactly once. Only its hash is stored, so it cannot be
 * shown again by us or by anyone who reaches the database — the response says
 * so, because a UI that does not will produce a support ticket instead of a
 * saved credential.
 */
export async function POST(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const { token, row } = await createApiKey(accountId, body?.name);

  return NextResponse.json(
    { key: row, token, note: "Copy this now — it is stored only as a hash and cannot be shown again." },
    { status: 201 },
  );
}

/** DELETE /api/account/keys?id=... — revoke, effective on the next request. */
export async function DELETE(req: NextRequest) {
  const accountId = await resolveAccountId(req);
  if (!accountId) return unauthorized();

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return bad("id is required");

  // Scoped to the account inside the UPDATE, so a wrong id is indistinguishable
  // from someone else's id: neither reveals whether that key exists.
  return (await revokeApiKey(accountId, id))
    ? NextResponse.json({ id, revoked: true })
    : bad("no such key", 404);
}

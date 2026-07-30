import { NextRequest, NextResponse } from "next/server";
import { getTld, normalizeTld, tldRejection } from "@/lib/moshpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/moshpit/tlds/:tld — availability lookup, no auth.
 *
 * This is what a registration page calls as you type, and what a resolver calls
 * to find out who owns a name, so it answers for every case rather than 404ing
 * on "not registered" — unregistered is a legitimate answer here.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ tld: string }> }) {
  const { tld: raw } = await ctx.params;
  const tld = normalizeTld(raw);
  if (!tld) {
    return NextResponse.json(
      { tld: raw, available: false, reason: "not a valid TLD — letters, digits and dashes only, no dots" },
      { status: 400 },
    );
  }

  const reserved = tldRejection(tld);
  if (reserved) return NextResponse.json({ tld, available: false, reason: reserved });

  const owned = await getTld(tld);
  if (owned) {
    // Deliberately not the owning account id — ownership is public, the
    // account behind it is not.
    return NextResponse.json({
      tld,
      available: false,
      reason: "already registered",
      registered_at: owned.created_at,
    });
  }
  return NextResponse.json({ tld, available: true });
}

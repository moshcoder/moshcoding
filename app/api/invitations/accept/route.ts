import { NextRequest, NextResponse } from "next/server";
import { normalizeApiKeyTimestamp } from "@/lib/api-key-time";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// accept a team invitation by token (caller's email must match the invite)
export async function POST(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "").trim();
  if (!token) return bad("token required");

  const inv = await db().execute({
    sql: `SELECT id, team_id, email, role, expires_at, accepted_at FROM team_invitations WHERE token = ?`,
    args: [token],
  });
  if (!inv.rows.length) return bad("invitation not found", 404);
  const row: any = inv.rows[0];
  if (row.accepted_at) return bad("invitation already used", 409);
  // expires_at is SQLite's "YYYY-MM-DD HH:MM:SS" on a file database and ISO on
  // Postgres; normalizeApiKeyTimestamp reads both (a blind + "Z" made the ISO
  // form Invalid Date, which read as "never expires").
  if (new Date(normalizeApiKeyTimestamp(String(row.expires_at))).getTime() < Date.now()) return bad("invitation expired", 410);
  if (u.email && String(row.email).toLowerCase() !== u.email.toLowerCase()) {
    return bad("this invitation is for a different email", 403);
  }

  await db().execute({
    sql: `INSERT INTO team_members (team_id, user_sub, role) VALUES (?, ?, ?)
          ON CONFLICT (team_id, user_sub) DO UPDATE SET role = excluded.role`,
    args: [row.team_id, u.sub, row.role],
  });
  await db().execute({ sql: `UPDATE team_invitations SET accepted_at = datetime('now') WHERE id = ?`, args: [row.id] });
  return NextResponse.json({ ok: true, team_id: row.team_id, role: row.role });
}

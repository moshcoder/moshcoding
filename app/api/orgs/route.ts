import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list orgs the user owns or belongs to (via a team), with their teams
export async function GET(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { rows } = await db().execute({
    sql: `SELECT DISTINCT o.id, o.name, o.owner_sub, o.created_at
          FROM orgs o
          LEFT JOIN teams t ON t.org_id = o.id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_sub = ?1
          WHERE o.owner_sub = ?1 OR tm.user_sub IS NOT NULL
          ORDER BY o.created_at`,
    args: [u.sub],
  });
  return NextResponse.json({ orgs: rows });
}

export async function POST(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name || name.length > 80) return bad("name required (max 80 chars)");
  const res = await db().execute({ sql: `INSERT INTO orgs (owner_sub, name) VALUES (?, ?) RETURNING id, name, created_at`, args: [u.sub, name] });
  return NextResponse.json({ org: res.rows[0] }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list teams the user can see (owned org or member), with project counts
export async function GET(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { rows } = await db().execute({
    sql: `SELECT t.id, t.name, t.org_id, o.name AS org_name,
                 COALESCE(mine.role, CASE WHEN o.owner_sub = ?1 THEN 'owner' END) AS role
          FROM teams t JOIN orgs o ON o.id = t.org_id
          LEFT JOIN team_members mine ON mine.team_id = t.id AND mine.user_sub = ?1
          WHERE o.owner_sub = ?1 OR mine.user_sub IS NOT NULL
          ORDER BY t.created_at`,
    args: [u.sub],
  });
  return NextResponse.json({ teams: rows });
}

// create a team inside an org the user owns
export async function POST(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const orgId = String(body?.org_id || "").trim();
  const name = String(body?.name || "").trim();
  if (!orgId) return bad("org_id required");
  if (!name || name.length > 80) return bad("name required (max 80 chars)");

  const owns = await db().execute({ sql: `SELECT 1 FROM orgs WHERE id = ? AND owner_sub = ?`, args: [orgId, u.sub] });
  if (!owns.rows.length) return bad("Not found", 404);

  const team = await db().execute({ sql: `INSERT INTO teams (org_id, name) VALUES (?, ?) RETURNING id, name, org_id, created_at`, args: [orgId, name] });
  const teamId = String(team.rows[0].id);
  await db().execute({ sql: `INSERT INTO team_members (team_id, user_sub, role) VALUES (?, ?, 'owner')`, args: [teamId, u.sub] });
  return NextResponse.json({ team: team.rows[0] }, { status: 201 });
}

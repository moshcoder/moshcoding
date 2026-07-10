import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, unauthorized, bad } from "@/lib/api";
import { authorizeTeam } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// list projects the user can access
export async function GET(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const { rows } = await db().execute({
    sql: `SELECT p.id, p.name, p.team_id, t.name AS team_name, o.name AS org_name
          FROM projects p JOIN teams t ON t.id = p.team_id JOIN orgs o ON o.id = t.org_id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_sub = ?1
          WHERE o.owner_sub = ?1 OR tm.user_sub IS NOT NULL
          ORDER BY p.created_at`,
    args: [u.sub],
  });
  return NextResponse.json({ projects: rows });
}

// create a project in a team (needs project.create on the team)
export async function POST(req: NextRequest) {
  const u = await requireUser(req);
  if (!u) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const teamId = String(body?.team_id || "").trim();
  const name = String(body?.name || "").trim();
  if (!teamId) return bad("team_id required");
  if (!name || name.length > 80) return bad("name required (max 80 chars)");

  const az = await authorizeTeam(u.sub, teamId, "project.create");
  if (!az.ok) return bad(az.error, az.status);

  const res = await db().execute({ sql: `INSERT INTO projects (team_id, name) VALUES (?, ?) RETURNING id, name, team_id, created_at`, args: [teamId, name] });
  return NextResponse.json({ project: res.rows[0] }, { status: 201 });
}

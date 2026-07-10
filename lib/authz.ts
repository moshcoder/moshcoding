import { NextRequest } from "next/server";
import { db, ensureSchema, upsertUser } from "./db";
import { readSession, authConfigured, SESSION_COOKIE, type Session } from "./session";

/* ---------------- roles & capabilities (pure) ---------------- */
export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export type Capability =
  | "project.read" | "project.write" | "webhook.manage"
  | "team.manage" | "project.create" | "project.delete" | "team.delete";

const VIEWER: Capability[] = ["project.read"];
const MEMBER: Capability[] = [...VIEWER, "project.write"];
const ADMIN: Capability[] = [...MEMBER, "webhook.manage", "team.manage", "project.create"];
const OWNER: Capability[] = [...ADMIN, "project.delete", "team.delete"];
const CAPS: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(VIEWER), member: new Set(MEMBER), admin: new Set(ADMIN), owner: new Set(OWNER),
};
export const can = (r: Role | null, c: Capability) => !!r && CAPS[r].has(c);
export const canAssignRole = (actor: Role, target: Role) => ROLE_RANK[actor] > ROLE_RANK[target];

const maxRole = (a: Role | null, b: Role | null): Role | null =>
  !a ? b : !b ? a : ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;

/* ---------------- session -> user ---------------- */
export function sessionUser(req: NextRequest): Session | null {
  if (!authConfigured()) return null;
  return readSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Ensure the user has a row + a default org/team with an owner membership. */
export async function getOrCreateUser(sub: string, email?: string | null, name?: string | null) {
  await ensureSchema();
  await upsertUser({ sub, email, name });
  const existing = await db().execute({
    sql: `SELECT t.id AS team_id, t.org_id FROM team_members tm
          JOIN teams t ON t.id = tm.team_id
          WHERE tm.user_sub = ? AND tm.role = 'owner' LIMIT 1`,
    args: [sub],
  });
  if (existing.rows.length) return { sub, teamId: String(existing.rows[0].team_id), orgId: String(existing.rows[0].org_id) };

  const who = (email || name || "my").split("@")[0];
  const org = await db().execute({ sql: `INSERT INTO orgs (owner_sub, name) VALUES (?, ?) RETURNING id`, args: [sub, `${who}'s org`] });
  const orgId = String(org.rows[0].id);
  const team = await db().execute({ sql: `INSERT INTO teams (org_id, name) VALUES (?, ?) RETURNING id`, args: [orgId, "Default team"] });
  const teamId = String(team.rows[0].id);
  await db().execute({ sql: `INSERT INTO team_members (team_id, user_sub, role) VALUES (?, ?, 'owner')`, args: [teamId, sub] });
  return { sub, teamId, orgId };
}

/* ---------------- role resolution (the security boundary) ---------------- */
export async function resolveTeamRole(sub: string, teamId: string): Promise<Role | null> {
  await ensureSchema();
  const { rows } = await db().execute({
    sql: `SELECT tm.role AS team_role, CASE WHEN o.owner_sub = ?1 THEN 'owner' END AS org_owner
          FROM teams t JOIN orgs o ON o.id = t.org_id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_sub = ?1
          WHERE t.id = ?2`,
    args: [sub, teamId],
  });
  if (!rows.length) return null;
  const r: any = rows[0];
  return maxRole((r.org_owner ?? null) as Role | null, (r.team_role ?? null) as Role | null);
}

export async function resolveProjectRole(sub: string, projectId: string): Promise<Role | null> {
  await ensureSchema();
  const { rows } = await db().execute({
    sql: `SELECT tm.role AS team_role, CASE WHEN o.owner_sub = ?1 THEN 'owner' END AS org_owner
          FROM projects p JOIN teams t ON t.id = p.team_id JOIN orgs o ON o.id = t.org_id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_sub = ?1
          WHERE p.id = ?2`,
    args: [sub, projectId],
  });
  if (!rows.length) return null;
  const r: any = rows[0];
  return maxRole((r.org_owner ?? null) as Role | null, (r.team_role ?? null) as Role | null);
}

export type Authz = { ok: boolean; role?: Role; status?: number; error?: string };

export async function authorizeTeam(sub: string, teamId: string, cap: Capability): Promise<Authz> {
  const role = await resolveTeamRole(sub, teamId);
  if (!role) return { ok: false, status: 404, error: "Not found" };
  if (!can(role, cap)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, role };
}

export async function authorizeProject(sub: string, projectId: string, cap: Capability): Promise<Authz> {
  const role = await resolveProjectRole(sub, projectId);
  if (!role) return { ok: false, status: 404, error: "Not found" };
  if (!can(role, cap)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, role };
}

/** All project ids the user can touch (team membership ∪ org ownership). */
export async function listAccessibleProjectIds(sub: string): Promise<string[]> {
  await ensureSchema();
  const { rows } = await db().execute({
    sql: `SELECT p.id FROM projects p JOIN teams t ON t.id = p.team_id JOIN orgs o ON o.id = t.org_id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_sub = ?1
          WHERE o.owner_sub = ?1 OR tm.user_sub IS NOT NULL`,
    args: [sub],
  });
  return rows.map((r: any) => String(r.id));
}

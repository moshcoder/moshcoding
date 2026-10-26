// Signup with the shared @profullstack/profile fields: names are required, the
// fields land in user_profiles under the session sub, and /api/v1/me/profile
// is the signed-in owner's only.
import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = "file::memory:";
process.env.SESSION_SECRET = "test-secret-for-signup-profile";
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;

const { POST: signup } = await import("../app/api/auth/signup/route.ts");
const profileRoute = await import("../app/api/v1/me/profile/route.ts");
const { profiles } = await import("../lib/profile.ts");
const { getAccountByEmail, ensureSchema } = await import("../lib/db.ts");
const { NextRequest } = await import("next/server");

await ensureSchema();

const post = (body) =>
  new NextRequest("http://local/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("a signup without a last name is refused before any account exists", async () => {
  const res = await signup(post({ email: "nolast@acme.com", password: "a-long-passphrase", domain: "nolast.com", first_name: "No" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.last_name);
  assert.equal(await getAccountByEmail("nolast@acme.com"), null);
});

test("a signup with the fields stores them, normalized, under the session sub", async () => {
  const res = await signup(
    post({
      email: "Ada@Acme.com",
      password: "a-long-passphrase",
      domain: "ada-lovelace.com",
      first_name: "Ada",
      last_name: "Lovelace",
      company_domain: "https://www.acme.com/about",
      job_title: "VP Engineering",
      linkedin_url: "in/ada-lovelace",
    }),
  );
  assert.equal(res.status, 200);
  const account = await getAccountByEmail("ada@acme.com");
  const profile = await profiles().get(`acct:${account.id}`);
  assert.equal(profile.email, "ada@acme.com");
  assert.equal(profile.first_name, "Ada");
  assert.equal(profile.last_name, "Lovelace");
  assert.equal(profile.company_domain, "acme.com");
  assert.equal(profile.job_title, "VP Engineering");
  assert.equal(profile.linkedin_url, "https://www.linkedin.com/in/ada-lovelace");

  // The session cookie it set reads the same profile back from the API.
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const got = await profileRoute.GET(new Request("http://local/api/v1/me/profile", { headers: { cookie } }));
  assert.equal(got.status, 200);
  assert.equal((await got.json()).profile.job_title, "VP Engineering");
});

test("the profile API needs a session", async () => {
  const res = await profileRoute.GET(new Request("http://local/api/v1/me/profile"));
  assert.equal(res.status, 401);
});

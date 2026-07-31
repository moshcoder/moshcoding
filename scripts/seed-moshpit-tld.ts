// Seed the network's own TLD: `.moshpit`, owned by the operator.
//
//   bun run scripts/seed-moshpit-tld.ts
//
// Idempotent — running it twice is a no-op, so it is safe on every deploy.
// `.moshpit` is on the reserved list, which is what stops anyone else claiming
// it; assigning it to us is the one case that bypasses the list on purpose.
import { findOrCreateAccountByEmail } from "../lib/db";
import { getTld, registerTld } from "../lib/moshpit";

const OWNER_EMAIL = process.env.MOSHPIT_OWNER_EMAIL || "anthony@profullstack.com";
const TLD = process.env.MOSHPIT_SEED_TLD || "moshpit";

const existing = await getTld(TLD);
if (existing) {
  console.log(`.${TLD} already registered to ${existing.owner_email ?? existing.account_id} (${existing.created_at})`);
  process.exit(0);
}

const account = await findOrCreateAccountByEmail(OWNER_EMAIL);
const result = await registerTld({
  tld: TLD,
  accountId: account.id,
  ownerEmail: OWNER_EMAIL,
  allowReserved: true,
});

if (!result.ok) {
  console.error(`could not register .${TLD}: ${result.error}`);
  process.exit(1);
}
console.log(`registered .${result.tld.tld} -> ${OWNER_EMAIL}`);

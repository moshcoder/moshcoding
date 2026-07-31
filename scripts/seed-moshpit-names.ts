// Register a batch of TLDs to one owner, then wire up their aliases.
//
//   bun run scripts/seed-moshpit-names.ts
//   bun run scripts/seed-moshpit-names.ts --dry-run
//   MOSHPIT_OWNER_EMAIL=someone@example.com bun run scripts/seed-moshpit-names.ts
//
// Idempotent: a TLD that is already held is left exactly as it is, and an alias
// that already points where it should is not rewritten. Safe to re-run, safe on
// every deploy.
//
// Only TLDs are registered, because only TLDs exist. `.yeah` carries
// `fuck.yeah` with it — "the operator of that TLD then owns everything under
// it" (see docs/prd/0001-moshpit-namespace.md). Second-level names are listed
// below purely so the intent is readable, and are checked for parseability
// rather than claimed.

import { findOrCreateAccountByEmail } from "../lib/db";
import { getTld, registerTld, setAlias, parseMoshpitName, tldRejection, normalizeTld } from "../lib/moshpit";

const OWNER_EMAIL = process.env.MOSHPIT_OWNER_EMAIL || "anthony@profullstack.com";
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * `reserved: true` is the deliberate bypass, not an oversight. `.profullstack`
 * is on RESERVED_TLDS under "ours: the network's own names are not for sale" —
 * the list exists to stop *other people* claiming it, and assigning one of our
 * own names to us is the single case it is meant to yield to. It is never
 * reachable from the public API.
 */
const TLDS: { tld: string; reserved?: boolean; carries: string[] }[] = [
  { tld: "yeah", carries: ["fuck.yeah"] },
  { tld: "oranges", carries: ["chovy.oranges", "california.oranges"] },
  { tld: "agent", carries: ["profullstack.agent"] },
  { tld: "profullstack", reserved: true, carries: [] },
  { tld: "sploof", carries: ["original.sploof"] },
  // Registered so it can be pointed at `.agent` below. An alias requires the
  // same account to hold both ends, which is what stops aliasing being used to
  // absorb names you never claimed.
  { tld: "agentic", carries: [] },
];

const ALIASES: { from: string; to: string }[] = [{ from: "agentic", to: "agent" }];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// --- validate before touching anything -------------------------------------
// A typo should stop the run while it is still a no-op, not halfway through.
for (const entry of TLDS) {
  const tld = normalizeTld(entry.tld);
  if (!tld) fail(`"${entry.tld}" is not a valid TLD`);
  const rejection = tldRejection(tld);
  if (rejection && !entry.reserved) fail(`.${tld} — ${rejection}`);
  for (const name of entry.carries) {
    const parsed = parseMoshpitName(name);
    if (!parsed) fail(`"${name}" is not a parseable moshpit name`);
    if (parsed.tld !== tld) fail(`"${name}" is not under .${tld}`);
  }
}

const account = DRY_RUN ? { id: "(dry-run)" } : await findOrCreateAccountByEmail(OWNER_EMAIL);
console.log(`owner: ${OWNER_EMAIL}${DRY_RUN ? "  [DRY RUN — nothing will be written]" : ""}\n`);

let registered = 0;
let alreadyHeld = 0;

for (const entry of TLDS) {
  const tld = normalizeTld(entry.tld);
  const existing = await getTld(tld);

  if (existing) {
    const owner = existing.owner_email ?? existing.account_id;
    // Someone else holding it is not something a re-run should paper over.
    if (existing.owner_email && existing.owner_email !== OWNER_EMAIL) {
      console.log(`!  .${tld} is held by ${owner} — left alone`);
    } else {
      console.log(`=  .${tld} already registered to ${owner}`);
    }
    alreadyHeld += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`+  .${tld} would be registered${entry.reserved ? " (reserved — deliberate bypass)" : ""}`);
    registered += 1;
    continue;
  }

  const result = await registerTld({
    tld,
    accountId: account.id,
    ownerEmail: OWNER_EMAIL,
    allowReserved: entry.reserved === true,
  });
  if (!result.ok) fail(`could not register .${tld}: ${result.error}`);
  console.log(`+  .${tld} registered${entry.reserved ? " (reserved — deliberate bypass)" : ""}`);
  registered += 1;
}

// --- aliases ---------------------------------------------------------------
console.log("");
for (const { from, to } of ALIASES) {
  const source = await getTld(normalizeTld(from));
  if (source?.alias_of === normalizeTld(to)) {
    console.log(`=  .${from} already points at .${to}`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`→  .${from} would point at .${to}`);
    continue;
  }
  const result = await setAlias({ from, to, accountId: account.id });
  if (!result.ok) fail(`could not alias .${from} -> .${to}: ${result.error}`);
  console.log(`→  .${from} now points at .${to}`);
}

// --- what the TLDs carry ---------------------------------------------------
console.log("\nnames these carry (no separate registration — they come with the TLD):");
for (const entry of TLDS) {
  for (const name of entry.carries) console.log(`   ${name}`);
}

console.log(`\n${registered} registered, ${alreadyHeld} already held.`);

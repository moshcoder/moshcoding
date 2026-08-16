---
openprd: "0.2"
id: "0004"
title: Moshpit Communities — One Button Turns a Claimed Name Into a Running Community
status: Draft
authors:
  - anthony@profullstack.com
created: 2026-08-16
updated: 2026-08-16
tags: [moshpit, communities, hosting, bbs, irc, rss, mail, ssh, vps, sqlite]
---

## Problem

5,679 endings are claimed in the pit today. A claimed name does approximately
nothing: it resolves, and it shows a parked coming-soon page. The owner of
`scrambled.eggs` cannot do anything *with* it that they could not do with a
bookmark.

PRD `0002` answers this with a decentralized compute grid — encrypted snapshots,
provider marketplaces, reputation slashing. That is the right destination and
the wrong next step. It has shipped nothing in the time it has existed, because
every requirement in it is a distributed-systems project.

Meanwhile every single piece of the stack we would want a community to have is
**already built and already running**, welded to one domain:

| Piece | Where it already runs | What it is |
|---|---|---|
| SSH front door, per-user dev pods | `bbs.profullstack.com` | AgentBBS (Go, single binary, SQLite, rootless Docker pods) |
| IRC | `irc.bbs.profullstack.com` | co-located Ergo, members-only SASL, BBS account = IRC identity |
| Dev environment | `dev.profullstack.com` | `dottemplates/root-ubuntu.sh` — idempotent, `WEB_DOMAIN=` already parameterized |
| Feed corpus | brisk.news (Supabase) | ~33k `smallweb` rows + ~340 hand-collected OPML feeds |
| Blog directory / discovery | rssamplifier.com | submit → resolve → permanent page → JSON/OPML/llms.txt |
| Payments | coinpayportal | `/api/organizations`, `/api/businesses`, merchant ids |
| Mail | `mail.profullstack.com` (Mailu) + forwardemail | AgentBBS already provisions member mailboxes |
| Group chat | qryptchat.com | PQ E2EE, SMS-verified identities |
| Namespace | `pit.moshcode.sh` | registry API: resolve, pins, tlds |

The gap is not capability. The gap is that all of it is single-tenant and none of
it is reachable from a button. **This PRD is the boring version of `0002`**: one
cheap VPS, one provisioner, the stack we already run, multiplied by N
communities.

## Goals

- Make "enable my community" a **free, opt-in, one-click** action on any claimed
  name, gated by a human on our side.
- Give each enabled name a **complete standard stack** on day one: shell, IRC,
  BBS board, blog + feed, topic news reader, search, discovery, group chat,
  payments org, and mail.
- Run it on **one cheap VPS we control**, not a grid. Boring, replaceable,
  provisioned by a script we already maintain.
- Keep the per-community stack **radically vanilla** — a directory, a SQLite
  file, and static-ish services — so an owner who wants something different can
  read it, understand it in an hour, and change it.
- Make it a **modular web app development stack**, not a template: every feature
  is an installable npm package, pages are composed from plugin-contributed
  blocks in named regions, and the whole lifecycle is drivable from a CLI or a
  webhook without a human in a browser.
- Give every pit user a dev environment that is a **clone of
  `dev.profullstack.com`**, not a new thing to learn.

## Non-Goals

- The decentralized grid from `0002`. No provider marketplace, no encrypted
  snapshots across 3+ nodes, no auto-migration, no slashing. One box, backups,
  and a rebuild script.
- A website builder. Communities get our stack, themed. Owners who want
  something else get a shell and our blessing.
- Custom per-community code deployment in V1. You get root in your pod; what you
  do with it is not the provisioner's problem.
- Automatic enablement. Nothing provisions itself because someone bought a name.
- Migrating `bbs.profullstack.com`. It keeps running exactly as it does; the pit
  box is a second, independent deployment.

## Users

**Name Owners** — Bought `scrambled.eggs` for $2 as a joke, would run a community
if it took one click instead of a weekend. Today they get a parked page.

**Community Members** — Show up because a `.eggs` link looked interesting. Want
to read the feed, join the channel, and post, without installing anything but
possibly the resolver extension.

**Pit Residents** — Want the `dev.profullstack.com` experience without being on
the Profullstack team. `ssh` in, get a box, mosh, irssi, mise, moshcode.

`dev.moshcode.sh` is exactly that box opened to the public. On
`dev.profullstack.com` you need to be an employee or a contractor; on
`dev.moshcode.sh` the only qualification is **being a moshpit and moshcode
user**. Same environment, same dotfiles, same shell — different door. That is
the pitch, and it is the whole reason the two boxes share provisioning
(`root-ubuntu.sh`) but nothing else.

**Us** — Need this to cost tens of dollars a month, not thousands, and to be
rebuildable from a script when the VPS dies.

## Interpretation of the request

Two phrases in the brief carry weight and are read here as follows. Flag if
either is wrong, because R1 and R3 change shape.

1. **"every claimed (and a person intervening)"** → the offer is extended to
   every claimed name, but provisioning requires a human to press the button and
   a human on our side to approve it. Not automatic, not retroactive.
2. **"pit.moshcode.sh ssh server"** → the *idea* of a public SSH front door on
   the moshcode.sh brand. The literal hostname is already taken; see C1.

## Constraints discovered (read before designing)

These are facts about the current system, verified on 2026-08-16, not opinions.
Several of them delete requirements.

- **C1 — `pit.moshcode.sh` is already the registry. RESOLVED.** It is a Railway
  service (`mcrmqfx9.up.railway.app` → `69.46.46.24`) serving
  `/api/moshpit/tlds`, `/resolve`, `/pins`, and it is the hardcoded
  `DEFAULT_REGISTRY_BASE` in `@moshcoder/moshpit-registry`. Railway will not
  give us `sshd` on port 22. **Decision (2026-08-16): the SSH box is
  `dev.moshcode.sh`; the registry stays where it is.** No published default
  changes and no package release is needed.

  `dev.profullstack.com` is **not** reused and is not part of this: it keeps
  running as the Profullstack team box. `dev.moshcode.sh` is a separate machine
  that merely shares its provisioning — same `root-ubuntu.sh`, same dotfiles,
  same shell — so the environment is familiar without the two boxes being
  coupled. Wherever this PRD says "a clone of `dev.profullstack.com`", it means
  parity of setup, never shared hardware or shared accounts.
- **C2 — `*.eggs` is not in the ICANN root.** `ssh anthony@scrambled.eggs` works
  only for someone running the resolver, the extension, or our DoH. Every
  service needs a real, dialable hostname as its primary address, with the
  moshpit name as the pretty alias. Plan on `scrambled-eggs.moshcode.sh`.
- **C3 — mail at `@scrambled.eggs` cannot receive internet mail.** No MX in the
  root means no external sender can deliver to it. Real mailboxes must live at
  `name@mail.moshcode.sh`; `name@scrambled.eggs` can be an internal/BBS-local
  address and a display identity, and nothing more, unless the owner also owns
  the equivalent real domain.
- **C4 — QryptChat groups cannot be created server-side.** Identities are
  SMS-verified and keys are client-held; there is no honest way to mint a group
  with members from a provisioner. The community gets an **invite link** its
  owner completes, not a pre-populated group.
- **C5 — the 33k feed corpus is untagged.** brisk's `smallweb` rows are a
  firehose; there is no topic column to filter on. "Feeds about scrambled eggs"
  is a classification/search problem, not a `WHERE` clause. It is the single
  largest build in this PRD.
- **C6 — rssamplifier.com indexes 4 blogs.** It is the right *shape* for
  discovery and the wrong *source* for volume. Point community discovery at
  brisk's corpus; submit community blogs *into* rssamplifier.
- **C7 — pods are the RAM budget.** AgentBBS defaults to `512m` per pod. An 8 GB
  box is ~10–12 concurrent pods before swap. It also cannot build AgentBBS
  on-box comfortably under ~1.5 GB.
- **C9 — `root-ubuntu.sh` is not publicly fetchable.** `ralyodio/dottemplates`
  is a **private** repo, so the `curl -fsSL … | bash` pattern fails on a fresh
  box, and netcup's first-boot `customScript` cannot pull it. Three ways out:
  publish the script at a public URL (moshcoding already serves `install.sh`
  this way), bake a token into the install config (no — that leaves a GitHub
  token sitting in netcup's panel), or **provision with the SSH key only and
  push the script over SSH afterwards**, which is how `dev.profullstack.com` is
  maintained today. The third is the recommendation; it keeps the repo private
  and costs one extra step.
- **C8 — the parked-page config merges under the DB row per-key.** Any community
  theming written to `configs/*.json` loses to an existing DB value on that key,
  which is how half-applied pages happen today.

## Requirements

### The box

- **R1 [P0] One VPS, provisioned by `root-ubuntu.sh`.** The pit box is a stock
  Ubuntu LTS VPS brought up by `sudo ./root-ubuntu.sh` with
  `WEB_DOMAIN=dev.moshcode.sh`. No new provisioning tool. The script already
  does users, ufw, dotfiles, oh-my-zsh, tmux, irssi configs, mise, moshcode,
  nginx per-user pages and TLS. This requirement is "run the script we have."
- **R2 [P0] Second AgentBBS deployment.** Stand up AgentBBS on the same box via
  its own idempotent `setup.sh`, with `AGENTBBS_HOST=dev.moshcode.sh`, its own
  data dir, its own SQLite, its own Ergo. It is a peer of
  `bbs.profullstack.com`, sharing no state with it.
- **R3 [P0] Public SSH front door.** `ssh join@dev.moshcode.sh` onboards a key;
  `ssh <name>@dev.moshcode.sh` is the hub. Every verified member gets a pod
  (`ubuntu:24.04`) and a homepage at `/~name`. This is the "clone of
  dev.profullstack.com" deliverable, and it is a config change, not a build.
- **R4 [P1] Rebuild, not restore.** The box is disposable. `root-ubuntu.sh` +
  `setup.sh` + a restore of `/var/lib/moshpit-communities` reconstitutes it. Any
  state that cannot survive that path is a bug.
- **R5 [P2] Self-update timer.** Mirror AgentBBS's 15-minute origin poll so the
  box self-heals when CI is down.

### The button

- **R6 [P0] Opt-in enable, free.** On the dashboard for a claimed name, a
  **Set up the standard stack** button. Off by default. Free. Enabling records
  who pressed it and when.
- **R7 [P0] Human approval gate.** Enablement creates a request; an operator
  approves it before anything provisions. Rejections are logged with a reason.
  This is the abuse valve and the cost valve.
- **R8 [P0] Idempotent provisioner.** One job takes a name and drives every
  service below to the desired state. Re-running it is safe and is the supported
  repair path. Partial failure leaves the community in `degraded` with the
  failing step named, never in an ambiguous half-state.
- **R9 [P1] Disable / tear down.** An owner can turn it off. Data is retained for
  30 days, then dropped. Disabling never deletes the name.

### The standard stack, per community

Provisioned for `scrambled.eggs`, primary hostname `scrambled-eggs.moshcode.sh`
(C2), moshpit alias `scrambled.eggs`.

- **R10 [P0] Home page + blog.** A themed landing page and a blog the owner can
  post to, publishing a real RSS/Atom feed at `/feed.xml`. Vanilla server-rendered
  HTML. No SPA. Posts live in the community's SQLite file.
- **R11 [P0] SQLite per community, one file.** `data/<name>/community.db` holds
  posts, members, settings, subscriptions, and auth. One file per community. No
  shared multi-tenant schema, no Postgres, no RLS. Backing up a community is
  copying a file; giving a community to its owner is handing them the file.
- **R12 [P0] IRC channel.** `#scrambled` on the pit's Ergo, members-only SASL,
  BBS account as identity, WebSocket-fronted for browsers. A dedicated Ergo
  *network* per community is explicitly deferred — one server, N channels.
- **R13 [P0] BBS board.** A board for the community inside the pit's AgentBBS,
  reachable over SSH and mirrored to the web page.
- **R14 [P0] Topic news feed.** A reader on the community page showing recent
  items from feeds matched to the community's topic, refreshed on a schedule —
  **not polled inline per request**, which is the mistake brisk's firehose page
  already makes and pays for in latency.
- **R15 [P0] Feed matching over the corpus.** Given a topic ("scrambled eggs"),
  select a starting subscription set from the ~34k corpus. V1 = full-text match
  over feed titles, descriptions and recent item titles, plus an LLM pass to
  score the top candidates, plus **the owner curating the result**. The owner's
  edits are the source of truth, always. Sync the corpus from brisk via its
  server-side OPML export; never pull 33k rows through an agent's context.
- **R16 [P0] Search.** A search box on the community page, backed by Kagi,
  scoped to the topic. Server-side, one shared key, rate-limited per community.
  Kagi is a V1 dependency and an explicit swap point.
- **R17 [P1] Discovery surface.** Each community publishes its own machine-readable
  half in the rssamplifier shape: `/index.json`, `/feed.opml`, `/llms.txt`. The
  community's own blog is auto-submitted to rssamplifier.com. This is how
  communities find each other, and it is why an agent can read one in a request.
- **R18 [P1] Mailbox.** `name@mail.moshcode.sh` for members, plus a community
  address and a webmail link, reusing AgentBBS's existing mailbox provisioning
  and `notify-creds` path. `mail.moshcode.sh` is a **new host** — SPF, DKIM,
  DMARC and warmup from zero reputation. `@scrambled.eggs` addresses are local
  identity only (C3).
- **R19 [P1] CoinPay org.** Provision an organization/business on coinpayportal
  for the community, store the merchant id, and wire it to the community's
  page so it can take money on day one. Reuses `COINPAY_API_KEY` /
  `AGENTBBS_COINPAY_MERCHANT_ID`, which AgentBBS already reads.
- **R20 [P1] QryptChat group link.** Generate and display a join link the owner
  completes; do not pretend to create the group (C4).
- **R21 [P2] Owner shell.** The owner gets a pod with the community directory
  mounted, so "change my community" is `ssh` + `vim` + restart. The escape hatch
  is the product, not a support burden.

### The app model: packages, regions, webhooks, CLI

The stack above describes *what a community gets*. This describes *how it is
built*, and it is what makes the thing a development stack rather than a
template. Every feature in R10–R21 ships as an installable package; a community
is a manifest of installed packages plus a SQLite file.

- **R26 [P0] One npm package per feature.** Each feature is
  `@profullstack/pit-<feature>` — `pit-blog`, `pit-feeds`, `pit-irc`, `pit-bbs`,
  `pit-search`, `pit-mail`, `pit-coinpay`, `pit-chat`. Published from one
  monorepo, versioned independently. The "standard stack" is a meta-package
  (`@profullstack/pit-standard`) that depends on the default set, so R8's
  provisioner is one install, not twelve.
- **R27 [P0] Plugin contract.** A package default-exports a definition with
  `id`, `label`, `version`, lifecycle hooks (`install`, `uninstall`, `update`),
  `routes` it serves, `widgets` it can render into regions, `jobs` it wants
  scheduled, and the `events` it emits. Lifecycle hooks receive a context with
  the community's SQLite handle, its config, and a logger. Nothing reaches into
  another plugin's tables.
- **R28 [P0] Migrations belong to the plugin.** `install` creates the plugin's
  own tables in the community DB, `update` migrates from the recorded version,
  `uninstall` drops them (after an export). A community's schema is therefore
  the sum of what it has installed — which is why R11's one-file-per-community
  rule matters more than it first appears.
- **R29 [P0] Region endpoints.** A page is composed from four named regions —
  `header`, `sidebar`, `footer`, `body` — each an ordered list of blocks, each
  block naming a plugin widget plus its config. The management API is uniform:

  ```
  GET    /api/v1/sites/{name}/regions/{region}          list blocks, in order
  POST   /api/v1/sites/{name}/regions/{region}          add a block
  PATCH  /api/v1/sites/{name}/regions/{region}          reorder (array of block ids)
  GET    /api/v1/sites/{name}/regions/{region}/{block}  one block + its config
  PUT    /api/v1/sites/{name}/regions/{region}/{block}  reconfigure it
  DELETE /api/v1/sites/{name}/regions/{region}/{block}  remove it
  ```

  A region rejects a widget whose plugin is not installed, and returns the
  install command rather than a bare 400.
- **R30 [P0] Package management API + webhooks.** `GET/POST /api/v1/sites/{name}/packages`
  and `DELETE`/`PUT` per package drive install, uninstall and update. Every
  lifecycle transition is also reachable by **inbound signed webhook**, so
  external automation can manage a community without a session — this is the
  "manage them via webhooks" requirement, and it is the same code path as the
  API, never a second one.
- **R31 [P1] Outbound webhooks.** Communities emit `package.installed`,
  `package.updated`, `package.removed`, `post.published`, `feed.item.matched`,
  `member.joined`. HMAC-signed, with a delivery log and bounded retries the
  owner can inspect. An event that cannot be delivered is visible, not silent.
- **R32 [P0] CLI is the primary interface.** Driven through moshcode under a
  `pit` namespace, so the whole lifecycle is scriptable and an agent can run it
  unattended:

  ```
  moshcode pit new scrambled.eggs          request a community
  moshcode pit use scrambled.eggs          set the working community
  moshcode pit add @profullstack/pit-blog  install a package
  moshcode pit rm  @profullstack/pit-irc   uninstall
  moshcode pit up                          update everything installed
  moshcode pit ls                          what is installed, and at what version
  moshcode pit feed add <url>              subscribe a feed
  moshcode pit feed find "scrambled eggs"  discover + backfill (R33)
  moshcode pit region sidebar add pit-feeds/latest
  moshcode pit region sidebar order <ids>
  moshcode pit hook add <url> --events 'package.*,post.published'
  moshcode pit status
  ```

  Every command is also an API call, so nothing is CLI-only. **Check
  `cli-tools` PR #5 (the moshcode plugin marketplace) before building the
  install/registry half — it may already be the mechanism, and two plugin
  systems in one CLI is the outcome to avoid.**
- **R33 [P1] Discovery and backfill through rssamplifier.** `pit feed find <topic>`
  queries `rssamplifier.com/api/search`, resolves candidate URLs through
  `/api/submit` (which turns a page into a feed), and pulls historical items so
  a new community's reader is not empty on day one. Because rssamplifier indexes
  only 4 blogs today (C6), the same command also searches brisk's ~34k corpus —
  and every community blog is submitted *into* rssamplifier, so the directory
  grows as communities do.
- **R34 [P2] Package registry surface.** `GET /api/v1/packages` lists installable
  packages with versions and descriptions, so the dashboard, the CLI and an
  agent all read one list. Third-party packages are a later question (see open
  questions), but the surface should not assume ours are the only ones.

### Tiers: free to develop, paid to grow

The dev environment is the free tier and the funnel. Every moshpit user gets a
box for free; resources are what costs money. The pod exists **to develop your
moshpit site** — it is not general-purpose hosting that happens to be free, and
the product should not read like it is.

- **R35 [P0] Free dev environment for every moshpit user.** Anyone who holds a
  moshpit name gets a pod at no charge, with the default quotas AgentBBS
  already enforces (512 MB RAM, 1 CPU) plus a disk and bandwidth cap. Free is
  the default state, not a trial — there is no expiry and no card required.
  **Eligibility is holding a moshpit name and using moshcode — nothing else.**
  No employment, no contract, no invite. This is the one gate, and it should be
  checkable from the registry (`/api/moshpit/resolve`) at signup rather than
  maintained as a second list of who is allowed in.
- **R36 [P1] Paid upgrades as independent dials.** RAM, CPU, disk and bandwidth
  are each upgradable on their own, priced monthly. Someone who needs disk and
  not CPU should not have to buy a bundle. Upgrades apply to the pod without
  rebuilding it where the container runtime allows.
- **R37 [P1] Quotas are visible before they bite.** The owner sees usage against
  each cap in the CLI and on the dashboard. Hitting a cap **degrades
  predictably** — throttle, refuse the write, warn — and never silently kills a
  pod or drops data. A surprise is a support ticket; a warning is an upgrade.
- **R38 [P1] Billing through CoinPay.** Upgrades are a subscription against the
  CoinPay org from R19, so the payment rail we sell to communities is the one
  we run ourselves. Non-payment downgrades to the free tier; it never deletes
  the pod or the community.
- **R39 [P1] Develop here, publish there.** The pod mounts the community
  directory (R21), and `moshcode pit deploy` promotes what is in the pod to the
  live community. Without that verb the dev environment is a box with no exit,
  which is the difference between a dev environment and a free VPS.
- **R41 [P0] The pod ships the toolchain, moshcode included.** AgentBBS's
  `AGENTBBS_POD_IMAGE` defaults to bare `ubuntu:24.04`, which gets none of what
  `root-ubuntu.sh` installs on the *host* — that script provisions the machine,
  not the containers on it. So the pod needs its own image, built and pinned by
  us: **moshcode**, mise, git, zsh + oh-my-zsh, tmux + our `.tmux.conf.local`,
  irssi config, vim, and the dotfiles. A user who lands in a pod and types
  `moshcode` should get moshcode, not `command not found`.

  Two rules the image must honour, both learned the hard way:
  **never invoke moshcode under `sudo`** — it escalates itself, and
  `sudo moshcode update` installs into `/root`; and **never auto-enable
  moshcode's DNS** — auto-enabling has broken a working system before, so
  `dns enable` stays something a human types.
- **R40 [P2] Capacity is a business input, not a constraint to hide.** The free
  tier's cost is bounded by pods per box (C7). When the box fills, the answer is
  a second box funded by upgrade revenue — never quietly shrinking the free
  tier, which is the move that kills the funnel.

### Cross-cutting

- **R22 [P0] Resolution and TLS.** Every service answers on its real
  `*.moshcode.sh` hostname with a normal cert, and on the moshpit name through
  the resolver/proxy. Pins are published to the registry. Origin certs must be
  leaf certs — `CA:TRUE` origins are why `.hacker` HTTPS never verified.
- **R23 [P1] Per-community limits.** Pod count, disk, feed-poll frequency, Kagi
  queries, and outbound mail are all capped per community with the cap visible
  to the owner.
- **R24 [P1] Abuse handling.** An operator can suspend a community in one
  command. Content policy is stated up front, since C3/C2 mean we are the
  operator of record for everything reachable here.
- **R25 [P2] Theming.** Community accent/logo/copy, applied through a path that
  does not lose to a stale DB row (C8).

## UX Notes

**The whole flow.** Owner opens `scrambled.eggs` in the dashboard. One button:
*Set up the standard stack — free.* Copy underneath says exactly what appears:
a page, a blog, a feed reader, a channel, a board, a mailbox, an org. They press
it. It says *requested — we approve these by hand, usually within a day.* An
operator approves. Ninety seconds later:

```
scrambled.eggs is live.

  web      https://scrambled-eggs.moshcode.sh   (and https://scrambled.eggs with the resolver)
  irc      #scrambled on irc.moshcode.sh:6697   SASL as your pit name
  bbs      ssh scrambled@dev.moshcode.sh
  shell    ssh <you>@dev.moshcode.sh            your pod, community dir mounted
  mail     you@mail.moshcode.sh
  feed     https://scrambled-eggs.moshcode.sh/feed.xml
  org      coinpay merchant cp_xxxx — take payments now

  We picked 40 feeds about scrambled eggs. Fix our guesses: /admin/feeds
```

**"We picked 40 feeds. Fix our guesses."** The honest framing for R15. Automated
topic matching over an untagged corpus will be roughly 70% right, and a UI that
pretends otherwise makes the 30% feel like a defect instead of a first draft. The
curation screen is the feature.

**The pit box feels like `dev.profullstack.com` because it is.** Same dotfiles,
same zsh, same tmux, same irssi config, same `motd`, same `mise`. Someone who has
used one has used the other. This is deliberate: the second environment we ask
people to learn is the one they do not adopt.

**Nothing happens automatically.** No one wakes up to a provisioned community
they did not ask for. Every one of the 5,679 endings stays a parked page until
its owner presses a button and a human agrees.

## Success Metrics

- **M1** — 25 communities enabled within 60 days of the button shipping.
- **M2** — Median time from operator approval to a working stack under 3 minutes.
- **M3** — 60%+ of enabled communities still have a human post or channel message
  in week 4. (Enablement is easy; retention is the actual signal.)
- **M4** — Owners keep ≥50% of auto-matched feeds after curating. Below that, R15
  is not working and should be replaced by "pick from a topic list."
- **M5** — Box cost under €25/month all-in at 25 communities.
- **M6** — A full rebuild from bare VPS to restored communities, timed and
  documented, under 60 minutes.

## Hosting

Requirement is ≥8 GB RAM (C7 says the real number is higher once pods are used).
Checked 2026-08-16:

| Option | Specs | Price/mo | Notes |
|---|---|---|---|
| **netcup VPS 2000 G12** | 8 vCPU, 16 GB DDR5 ECC, 512 GB NVMe | €19.25 inc. VAT | **Recommended.** Headroom for ~25 pods, builds on-box fine |
| netcup VPS 1000 G12 | 4 vCPU, 8 GB DDR5 ECC, 256 GB NVMe | €10.37 inc. VAT | Meets the letter of the ask; ~10–12 pods |
| Contabo VPS | 4 vCPU, 8 GB, 50 GB NVMe | ~$6 advertised | Cheapest seen; site blocks automated checks, unverified, and 50 GB is thin for pods |
| Vultr / Linode / DigitalOcean | comparable | ~$40–48 | Pricier, but the only options sh1pt can provision end-to-end today (see below) |

Hetzner is excluded by standing preference and is not to be reconsidered on
price. Serverhunter could not be scraped (JS-rendered listings); the above is
from provider pages directly. **Recommendation: netcup VPS 2000 G12.** The
€9/month difference over the 8 GB plan buys the difference between "pods work"
and "pods swap," and pods are the entire dev-environment promise.

### sh1pt netcup adapter — built, with one hard limit

sh1pt now ships `@profullstack/sh1pt-cloud-netcup` (branch
`worktree-cloud-netcup`), driving netcup's SCP REST API — the SOAP webservice
was retired on 2026-04-30 and replaced by a 63-endpoint REST API with a public
OpenAPI spec.

The limit that does not go away: **netcup has no order endpoint and no cancel
endpoint.** Servers are monthly contracts bought through checkout, not API
resources. So the adapter redefines two verbs:

- `provision` **adopts** — it takes a server already on the account with no OS
  installed and installs one via `POST /servers/{serverId}/image`, which carries
  `hostname`, `sshKeyIds` and a first-boot `customScript`. One call lands a
  fully configured box. Note C9 before planning on it: `root-ubuntu.sh` lives in
  a private repo, so the `customScript` cannot fetch it today — provision with
  the SSH key and push the script over SSH, or publish the script publicly
  first.
- `destroy` **throws**, naming the Customer Control Panel. Powering a server off
  would report success while the contract kept billing.

Adoption is deliberately timid, because installing an image wipes the target
disk: never a server that already has a template, never a disabled one, and
never a guess between multiple candidates without an `adoptPrefix`.

**The one manual step in this PRD is buying the VPS.** Everything after it is
automated.

## Rollout

- **Phase 0 — the box.** VPS, `root-ubuntu.sh`, AgentBBS `setup.sh`, Ergo, TLS,
  DNS. Deliverable: `ssh join@dev.moshcode.sh` works for a stranger. No
  communities yet. The hostname is settled (C1); the only remaining gate is
  buying the VPS, which has no API.
- **Phase 1 — one community by hand.** Provision `scrambled.eggs` manually,
  end to end, writing down every step. The written-down steps are the
  provisioner's spec. Deliverable: a real community, and an honest estimate.
- **Phase 2 — the plugin host.** R26–R30: the package contract, lifecycle
  hooks, per-plugin migrations, region endpoints, and the package management
  API. Build `pit-blog` and `pit-feeds` first — two plugins is the smallest
  number that proves the contract, one proves nothing. Deliverable: a community
  whose home page is composed from installed packages.
- **Phase 3 — the provisioner and the CLI.** R8 driving the standard set as one
  meta-package install, plus R32's `moshcode pit` verbs and R31's outbound
  webhooks. Deliverable: a name goes in, a stack comes out, twice, idempotently,
  from a script with no browser involved.
- **Phase 3.5 — the button.** R6, R7, R9 in the dashboard. Deliberately after
  the CLI: the button should call the same API the CLI does, and building it
  first is how that stops being true.
- **Phase 4 — topic matching.** R15, R16, R17. Deliberately last: it is the
  largest build (C5), and a community with hand-picked feeds is already useful.

## Risks & Open Questions

- **Mail is the hardest piece and the least discussed.** A brand-new
  `mail.moshcode.sh` starts with zero sending reputation, and communities are
  exactly the shape of thing that attracts spam-adjacent use. Do we run our own
  MTA (Mailu, as on `mail.profullstack.com`), or relay through forwardemail, as
  AgentBBS's Premium path already does? The second is duller and likelier right.
- **One box is one blast radius.** 25 communities on one VPS means one bad
  neighbor, one kernel panic, or one abuse complaint takes all of them out. Is
  that acceptable for a free tier? (It probably is — say so out loud rather than
  discovering it during the first outage.)
- **Is the free tier's unit economics actually positive?** RESOLVED in shape
  (R35–R40): free dev environment, paid resource upgrades, billed through
  CoinPay. Still open in numbers — what a free pod costs us per month against
  what fraction upgrade, and what the upgrade prices are. Until someone puts
  figures on that, M5's "under €25/month at 25 communities" is the only
  constraint on the table and it does not survive contact with paid pods.
- **Topic matching may not be good enough (C5).** If M4 comes in under 50%, is
  the fallback a curated topic taxonomy (~200 topics, hand-mapped to feeds) that
  owners pick from? That is less magical and much more likely to work.
- **Kagi's terms.** Is proxying search for N communities on one key within
  Kagi's acceptable use? Worth reading before it is load-bearing, not after.
- **QryptChat's phone requirement (C4).** SMS verification is real friction for a
  community that otherwise needs no account. Is the group link worth shipping in
  V1, or does IRC cover chat until QryptChat has a keys-only onboarding path?
- **Relationship to `0002`.** Is this the V1 of `0002` — the thing that gets
  replaced when the grid exists — or a permanent "managed" tier alongside a
  self-hosted grid? The answer changes whether the provisioner should be written
  against a container abstraction now or against this box.
- **Does an owner get root on the community itself, or only on a pod?** R21 says
  pod. An owner who wants to replace the whole stack currently has to leave. Is
  "export your `community.db` and go" a good enough answer?
- **Do third parties get to publish packages?** R34's registry surface should
  not assume ours are the only packages, but a community installing arbitrary
  npm code that runs in-process with its SQLite handle is a different security
  posture entirely. First-party-only in V1, or a sandbox from the start?
- **What runs plugin code, and where?** In-process with the community server is
  simplest and gives a bad package the whole box. Per-community process or pod
  is safer and costs RAM we counted carefully in C7.
- **Is `pit` the right namespace?** `moshcode pit ...` reads well and matches
  the brand, but moshcode already carries `/rss` and `/news` list commands that
  overlap R33's feed verbs. Decide whether `pit feed` subsumes them or sits
  beside them — two ways to add a feed is the confusing outcome.
- **Reuse the existing plugin marketplace?** `cli-tools` PR #5 adds a moshcode
  plugin marketplace and is unmerged. If it is the right mechanism, R26/R34
  should build on it rather than beside it. Verify before writing a registry.
- **Inbound webhooks are remote code execution by design.** A signed webhook
  that installs a package is exactly the capability an attacker wants. HMAC plus
  a per-community secret is the floor; does it also need an allowlist of
  installable packages, or operator approval for anything outside the standard
  set?
- **The parked page still exists.** When a community is enabled, does the
  moshcoding parked page redirect, or does the community page replace it? C8
  means whichever we choose has a config-merge trap waiting in it.

# Moshpit DNS — `.moshpit` without the extension

The Moshpit namespace has always resolved for people running the TronBrowser
extension or a node. This is the other half: public resolvers at
`*.pit.moshcode.sh` that anyone can point a laptop, phone or router at and get
`.moshpit`, `.eggs`, `.yeah` — **and** `.com`, `.org` and the rest of the
ordinary internet, from the same resolver.

Nothing to install. You change one setting, the one every operating system
already has.

This is PRD `0004` R1 (Inbound Resolution Gateway) approached from the resolver
side rather than the URL side: instead of asking people to type
`scrambled.eggs.pit.moshcode.sh`, they type `scrambled.eggs`.

## What it answers

| Query | Answer |
| --- | --- |
| `scrambled.eggs` (a registered Moshpit TLD) | the gateway's address, so the site loads |
| `www.scrambled.eggs` | the same — the gateway routes by Host header |
| `example.com` | whatever 8.8.8.8 or 1.1.1.1 says, relayed byte for byte |
| `nobody.zzzz` (unregistered) | NXDOMAIN, exactly as clearnet said |
| a name aliased at the TLD level | a real `CNAME` to where it points, then the address |
| a name with an explicit target | that address, or a `CNAME` to that host |

Two positions on names that exist in **both** namespaces — `profullstack.ai` is
a real domain someone can buy and a name the registry can hold:

- **`clearnet`** (the default) — clearnet owns any name clearnet can answer, and
  the registry is a *backfill* that fills the gaps. A public resolver that
  silently redirected a domain which resolves perfectly well would be
  indistinguishable from a hijack.
- **`moshpit`** (`MOSHPIT_RESOLVE_MODE=moshpit`) — a registered Moshpit name
  wins even when clearnet has an answer. For people who want the namespace they
  opted into, on a resolver they chose.

Either way, names under a TLD the legacy root has never heard of resolve
through the registry: there is nothing to conflict with.

This mirrors the browser extension's policy exactly, so switching from the
extension to these resolvers does not change which site you land on.

## Running one

```sh
bun run dns                       # port 5354, unprivileged, for development
MOSHPIT_DNS_PORT=53 bun run dns   # the real thing
```

Then check it:

```sh
dig @127.0.0.1 -p 5354 +short anything.moshpit    # -> the gateway's address
dig @127.0.0.1 -p 5354 +short example.com         # -> the ordinary answer
dig @127.0.0.1 -p 5354 TXT scrambled.eggs         # -> who resolved it and how
curl -s http://127.0.0.1:8053/health              # -> query counters
```

Everything is configured by environment variable and nothing is required —
with an empty environment it reads the public registry at `pit.moshcode.sh`
and forwards everything else to 8.8.8.8 and 1.1.1.1. See `.env.example` for
the full list.

### Docker

```sh
docker build -f deploy/Dockerfile.dns -t moshpit-dns .
docker run -d --restart=always --name moshpit-dns \
  -p 53:5354/udp -p 53:5354/tcp -p 8053:8053 moshpit-dns
```

### systemd

`deploy/moshpit-dns.service`, which runs it under `DynamicUser` with
`CAP_NET_BIND_SERVICE` and nothing else. On Ubuntu and Debian, if the bind to
port 53 fails, `systemd-resolved` already has it — set `DNSStubListener=no` in
`/etc/systemd/resolved.conf`.

### Where it can run

Not Railway, and not any other host that only forwards HTTP: DNS is UDP, and
`pit.moshcode.sh` itself is deployed somewhere that does not offer UDP ingress.
A small VPS with a static address is the whole requirement — the process holds
no state, uses no database, and has no dependencies to install.

The DoH endpoint is a different story: it is plain HTTP, so it can sit behind
the same proxy that already terminates TLS for `pit.moshcode.sh`.

## Publishing it at `*.pit.moshcode.sh`

Two resolvers, so one can be rebooted without taking the namespace down with
it. In the `moshcode.sh` zone:

```
dns1.pit    A     <resolver 1 address>
dns2.pit    A     <resolver 2 address>
dns         A     <load balancer or resolver 1>    ; DoH: https://dns.pit.moshcode.sh/dns-query
```

These have to be **explicit** records. The wildcard that serves the HTTP
gateway (`*.pit.moshcode.sh`) would otherwise answer for `dns1.pit` and point
people's resolvers at a web server; an exact name always beats a wildcard.

Then set `MOSHPIT_GATEWAY_HOST=pit.moshcode.sh` (the default) and the resolvers
follow the gateway wherever it moves, because they look its address up through
the same upstreams they use for everything else.

Anyone can run their own instead — a different registry, a different gateway,
a resolver on a Raspberry Pi for one household. Nothing here privileges
`pit.moshcode.sh`; it is a convenience default, which is PRD `0004` R8.

## Using one

**macOS** — System Settings → Network → your connection → Details → DNS, and
add `dns1.pit.moshcode.sh`'s address as the first server.

**Linux** — either `/etc/resolv.conf` directly (`nameserver <address>`), or,
under systemd-resolved:

```sh
resolvectl dns <interface> <resolver address>
```

**Windows** — Settings → Network & Internet → your adapter → DNS server
assignment → Edit → Manual.

**Router** — set it as the DHCP-advertised DNS and every device on the network
gets the namespace, which is the setup this is really for.

**Browser (DoH)** — Firefox: Settings → Privacy & Security → DNS over HTTPS →
Max Protection, custom provider `https://dns.pit.moshcode.sh/dns-query`. Chrome:
Settings → Privacy and security → Security → Use secure DNS → custom. This is
the option for a locked-down work machine where system DNS is not yours to
change.

**Android / iOS** — no DoT listener yet (Android's Private DNS needs one). It
is a TLS wrapper over the same TCP port; until then, DoH in the browser works.

## The gateway side, which is not done

Resolution is half of reaching a Moshpit site. The resolver answers
`scrambled.eggs` with the gateway's address; the browser then connects there
with `Host: scrambled.eggs`, and something has to accept that Host.

Today nothing does. `pit.moshcode.sh` sits behind Railway's edge, which routes
by Host against the domains registered on the service and answers

```
{"status":"error","code":404,"message":"Application not found"}
```

for anything else — and a Moshpit name cannot be registered there, because the
namespace's whole premise is that anyone can invent one. Verified with
`curl -H 'Host: fuck.yeah' http://<pit address>/`.

So a deployment needs an ingress that accepts any Host, on the same box as a
resolver, with `MOSHPIT_GATEWAY_A` pointed at it. `deploy/Caddyfile.gateway` is
that ingress. Until the hosting grid exists to proxy into, it sends the visitor
to the pit with the name they typed:

```
mosh.whatever  ->  302  ->  https://app.moshcode.sh/pit?name=mosh.whatever
```

A redirect rather than a proxy, deliberately: proxying would leave people
signing in under a hostname no CA will vouch for, with a session cookie on a
domain the app does not own. The redirect puts them on the real origin, with a
real padlock, where signing in works — and the pit then offers them the ending
the name sits under.

None of this changes the resolver — that is why the gateway address is a
setting rather than a constant.

## The catch-all

By default a name nobody has claimed gets clearnet's verdict, which is
NXDOMAIN — an error page. `MOSHPIT_DNS_CATCHALL=1` changes that: an unclaimed
name under an ending **the legacy root does not have** resolves to the gateway,
and the visitor lands on the pit with `mosh.whatever` filled in, one form away
from holding the ending it sits under.

The boundary is the entire feature. `asdkjh.com` is NXDOMAIN too, and answering
that one would make this resolver a typo-squatter for the whole internet — the
behaviour ISPs were rightly hated for. So the catch-all fires only when the TLD
itself is absent from the root, which is checked by asking the upstreams for the
TLD's SOA (one cached query per ending, not per name) rather than by shipping an
IANA list that would be stale within the week. An unreachable upstream fails
closed: unknown means "the root has it".

Answers are marked: `aa` is 0, because nobody holds the name and claiming
authority over it would be a lie, and a `TXT` lookup says `unclaimed=1`.

Off by default. It makes the resolver answer for names the registry never
granted, and that is a product decision rather than something a resolver should
assume on your behalf.

## What this does not fix

**HTTPS on a Moshpit name.** No public CA will issue a certificate for
`scrambled.eggs`, because no public CA recognises the namespace. So
`http://scrambled.eggs` works through these resolvers, and
`https://scrambled.eggs` gets a certificate warning. That is a property of the
namespace, not of this resolver: the gateway URL (`scrambled.eggs`'s page under
`pit.moshcode.sh`) is the padlocked path, and the extension is the other. A
Moshpit CA that clients opt into is the real answer, and it is not built.

**DNSSEC on Moshpit names.** Synthesized answers are unsigned — there is no
chain from the ICANN root to a namespace that does not descend from it.
Forwarded clearnet answers keep whatever the upstream signed, relayed
untouched, so validating clients keep validating `.com`.

**Privacy.** Clearnet queries go to Google and Cloudflare, which is what a
forwarder does. Point `MOSHPIT_DNS_UPSTREAMS` somewhere else — Quad9, a local
Unbound, your own recursor — if that trade is wrong for you. Moshpit lookups go
to the registry, which sees the name but not the client.

## Operating it

A public resolver is a **reflection amplifier**: an attacker sends small
queries with a victim's address forged as the source, and the resolver mails
the answers to the victim. Scanners find open resolvers within hours. This one
ships with the standard defences on by default —

- a per-client token bucket (`MOSHPIT_DNS_QPS`, default 50/s with a burst of
  100), which **drops** rather than replies, because a refusal is still a
  packet sent at the victim;
- `ANY` queries refused, since that is the query type reflection uses;
- non-recursive queries refused for clearnet names, so the resolver cannot be
  used as a cache to probe;
- responses arriving at the listening socket ignored entirely.

— and none of that removes the need to watch it. `/health` reports
`queries`, `moshpit`, `forwarded`, `refused`, `dropped` and `failed` counters;
a `dropped` count climbing on its own is someone testing you.

If the resolver is for a known set of users, put it behind a firewall rule
rather than relying on rate limits alone.

## How it fits together

```
  client ──udp/53──▶ moshpit-dns ──┬──▶ pit.moshcode.sh/api/moshpit/resolve   (is this a Moshpit name?)
                                   ├──▶ 8.8.8.8 / 1.1.1.1                     (everything else)
                                   └──▶ answers with pit.moshcode.sh's address
                                        └─ browser connects there with Host: scrambled.eggs
                                           └─ gateway routes into the hosting grid
```

The registry stays authoritative and this process stays a reader of it — it
cannot create, reassign or override a name (PRD `0004` R2). If the registry is
unreachable, Moshpit names fall back to clearnet's verdict and the rest of the
internet is unaffected: an outage here costs the namespace, not the web.

Code: `lib/dns/` (`wire.ts` codec, `policy.ts` the namespace decision,
`registry.ts`, `upstream.ts`, `answers.ts`, `server.ts`, `doh.ts`), entry point
`scripts/moshpit-dns.ts`, tests in `tests/dns-*.test.mjs`.

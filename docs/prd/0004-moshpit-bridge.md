---
openprd: "0.2"
id: "0004"
title: Moshpit Bridge — Gateway Between the Moshpit Namespace and Legacy DNS
status: Draft
authors:
  - anthony@profullstack.com
created: 2026-07-28
updated: 2026-07-28
tags: [bridge, gateway, dns, p2p, interop, identity, attestation, moshpit]
---

## Problem

A Moshpit name like `scrambled.eggs` only resolves for people who run the extension or a `moshpit` node (see PRD `0001`). Everyone else — the entire legacy internet — hits a wall. That kills virality: you cannot share a `.eggs` link in a tweet and expect a normal user to open it. At the same time, a Moshpit identity is invisible to the old internet, and a legacy domain owner (`example.com`) has no way to prove they are the same entity inside Moshpit. There is demand for a controlled, opt-in bridge in both directions — resolution *and* identity — that grows reach without collapsing Moshpit back into ICANN/DNS dependence for its core operation.

The trap to avoid is the rejected "Internet 2" model: making legacy DNS the *root of trust* for Moshpit. This spec does the opposite. The Moshpit P2P directory (`0001` R4) stays authoritative. The bridge is a convenience and interop layer bolted on the side — never a dependency, never an authority.

## Goals

- Let anyone on the plain internet reach a Moshpit site through a real-DNS gateway, with no extension and no node.
- Let a Moshpit name owner *optionally* publish a legacy-DNS alias so the name is linkable and shareable on the old internet.
- Let a legacy domain owner prove control (DNS TXT / HTTPS `.well-known`) and cryptographically bind that domain to a Moshpit identity — and require the Moshpit side to sign back, so binds are mutual, not one-sided land grabs.
- Keep the bridge strictly optional and non-authoritative: the Moshpit P2P directory remains the source of truth; no gateway can seize, censor, impersonate, or override a Moshpit name.
- Make the bridge federated and self-hostable so it never becomes a single chokepoint.

## Non-Goals

- Making legacy DNS the root of control for Moshpit (this is the "Internet 2" model we explicitly cut).
- Messaging interop or federated relays — messaging stays P2P and namespace-native per PRD `0003`. This bridge moves *names and web traffic*, not chat.
- Anonymity or metadata resistance (this is not Tor; consistent with `0001`).
- Bridging to blockchain naming systems (Handshake/ENS) in V1 — possible later via adapters, out of scope now.
- Guaranteeing a Moshpit name keeps working if the *owner* lets their optional legacy alias domain expire.

## Users

**Extension-less Visitors** — Someone who clicks `scrambled.eggs` in a tweet on a locked-down work laptop. They cannot install anything but should still see the site.

**Moshpit Site Owners** — Owners of `.eggs` or `scrambled.eggs` who want their site reachable by the whole internet, not just Moshpit natives, without giving up sovereignty.

**Legacy Domain Owners** — People who already own `example.com` and want a *verified* Moshpit presence that provably belongs to them (anti-impersonation).

**Bridge / Gateway Operators** — Anyone who runs a public gateway (starting with `pit.moshcode.sh`) or a private one, and wants clear rules on abuse, cost, and liability.

## Requirements

- R1 [P0] **Inbound Resolution Gateway**: A real-DNS wildcard suffix (e.g. `*.pit.moshcode.sh`) resolves any Moshpit name to a reverse proxy that routes into the hosting grid (`0002` R7). `scrambled.eggs` is reachable at `scrambled.eggs.pit.moshcode.sh` over standard HTTPS — no extension, no node. This is the operational core of `0001` R11 (Clearnet Bootstrap).
- R2 [P0] **Non-Authoritative by Construction**: The gateway is a stateless reader of the Moshpit P2P directory (`0001` R4). It MUST NOT be able to create, reassign, or override a name binding. If the directory says `scrambled.eggs` moved, the gateway follows; it never leads.
- R3 [P0] **TLS Termination + SNI Routing**: The gateway terminates TLS and routes by SNI to the correct container even as it migrates between providers (`0002` R5/R7). Certificates for the suffix domain are issued via ACME. Native (extension) resolution remains end-to-end to the container and does not depend on the gateway's certs.
- R4 [P0] **Legacy → Moshpit Identity Attestation**: A legacy domain owner proves control by publishing a signed binding statement at DNS TXT `_moshpit.<domain>` and/or `https://<domain>/.well-known/moshpit.json`. The statement binds the legacy domain to a Moshpit identity key. Clients MUST prefer HTTPS when both exist and MUST detect conflicts.
- R5 [P0] **Moshpit → Legacy Counter-Attestation**: A bind is valid only when the Moshpit identity signs a matching counter-statement referencing the legacy domain. One-directional claims MUST render as `unverified`. This prevents a legacy owner from squatting a Moshpit identity (and vice versa) without the other side's consent.
- R6 [P0] **Conflict Blocking**: If the two attestation directions disagree, or DNS and HTTPS proofs disagree, clients MUST show the bind as `unverified` and MUST NOT grant it trust/badging until resolved. Mirrors the anti-phishing posture of `0001`.
- R7 [P1] **Optional Legacy Alias Publishing**: A Moshpit name owner MAY opt in to publish a `CNAME`/`A` alias in real DNS pointing at a gateway, so the name is directly reachable and indexable on the legacy internet. Opt-in only; disabled by default; revocable at any time.
- R8 [P1] **Federated & Self-Hostable Gateways**: Anyone can run a gateway implementing the resolution + attestation API. Multiple gateways MAY serve the same name; no gateway is privileged. `pit.moshcode.sh` is a convenience default, not a required intermediary.
- R9 [P1] **Content-Blind Abuse Controls**: Gateways enforce rate limits, proof-of-use, and operator-set deny lists *without reading proxied content*, to blunt phishing/squatting (e.g. `apple.eggs` via the gateway) and trademark abuse — the open risks flagged in `0001`.
- R10 [P2] **Outbound Legacy Linking**: Define a canonical, safe syntax for referencing and rendering legacy `https://` links from within Moshpit clients. Egress itself already works — grid containers have real internet (`0002`) — so this is about safe presentation, not new plumbing.
- R11 [P2] **Extension-less Preview Fallback**: A visitor hitting a bare Moshpit link without the extension lands on the `pit.moshcode.sh` preview (`0001` R11) with a one-click "continue via gateway" path, instead of a dead link.
- R12 [P2] **Attestation Transparency Log**: An append-only, gossipable record of legacy↔Moshpit binds so impersonation and silent re-binding are publicly detectable. MVP MAY ship signed bind statements only; transparency log is a hardening follow-up.

## UX Notes

**Visiting Without the Extension**: A normie clicks `scrambled.eggs`. Their browser has no Moshpit extension, so the link is authored as `https://scrambled.eggs.pit.moshcode.sh`. Normal DNS resolves the suffix, the gateway proxies into the grid, and the site loads with a padlock. It just works, anywhere — even a corporate laptop.

**Owner Enables Reach**: The owner of `scrambled.eggs` runs `preshy bridge enable scrambled.eggs`. The CLI confirms the name is live on the grid and prints the gateway URL. If they want a vanity legacy alias, `preshy bridge alias scrambled.eggs --domain scrambled-eggs.io` prints (or auto-adds via a DNS provider) the exact `CNAME` to publish. CLI-first, matching the `preshy`/`moshpit` ethos of `0002` and `0003`.

**Verifying a Legacy Identity**: A company owns `example.com` and wants a provable Moshpit presence. They run `preshy bridge link scrambled.eggs --domain example.com`. The CLI prints the `_moshpit.example.com` TXT record and the `/.well-known/moshpit.json` to publish, then signs the Moshpit-side counter-statement automatically. Once both sides are visible and agree, clients render a **verified** badge: "`scrambled.eggs` ⇄ `example.com`". If only one side is present, the badge stays gray and says `unverified`.

**When Things Disagree**: If `example.com`'s TXT and `.well-known` documents conflict, or the Moshpit counter-statement is missing, the client refuses to badge it and shows a loud banner, not a footnote. Silent trust is never the default.

**Killing the Gateway Changes Nothing Native**: A Moshpit-native user (extension or node) resolving `scrambled.eggs` never touches the gateway. If `pit.moshcode.sh` went offline tomorrow, native resolution and P2P messaging (`0003`) keep working. Only extension-less legacy visitors are affected — and they can use any other gateway.

## Success Metrics

- **M1**: An extension-less visitor loads a Moshpit site through the gateway in under 3 seconds on broadband.
- **M2**: 500+ verified bidirectional legacy⇄Moshpit binds within 90 days of launch.
- **M3**: Taking the reference gateway (`pit.moshcode.sh`) fully offline breaks **zero** native (extension/node) resolutions in a test — proving the bridge is non-authoritative.
- **M4**: At least 3 independently operated gateways serving the same names, demonstrating federation.
- **M5**: Zero successful one-sided identity binds (every accepted bind is mutually signed).

## Risks & Open Questions

- **Chokepoint / Recentralization**: If everyone uses `pit.moshcode.sh`, does the "sovereign" network quietly re-centralize on one gateway? Federation (R8) is the answer in theory — is it enough in practice, or do we need to actively seed independent gateways?
- **Phishing via Legacy Aliases**: A legacy alias like `apple.eggs.pit.moshcode.sh` or a lookalike vanity domain is a phishing vector the extension's native resolver would have flagged. How much can content-blind controls (R9) actually catch?
- **Certificate Issuance at Scale**: Wildcard/per-name ACME issuance for a suffix serving thousands of Moshpit names will hit CA rate limits. Do we need our own ACME setup, a wildcard cert, or on-demand issuance with caching?
- **Gateway Operator Liability**: A gateway proxies arbitrary tenant content. Is the operator liable for what passes through? Does this need the same content-policy discussion as the hosting grid (`0002`)?
- **Attestation Revocation & Rotation**: How does a legacy owner revoke a bind, and how fast does that propagate? What happens to the badge during Moshpit identity-key rotation?
- **Does Aliasing Reintroduce ICANN Dependence?**: Owners who lean on legacy aliases (R7) are back to paying a registrar. Is that acceptable as an *optional* convenience, or does it undermine the sovereignty pitch if it becomes the norm?
- **Egress Cost & Bandwidth**: Who pays for gateway egress when a Moshpit site goes viral on the legacy internet — the site owner, the gateway operator, or a network fee (echoing `0002` R6 metering)?
- **Relationship to `0001`/`0002`**: This PRD operationalizes `0001` R10/R11 and `0002` R7. Should those requirements be trimmed to just reference this spec, or kept as-is with this as the detailed companion?

---
openprd: "0.2"
id: "0002"
title: Moshpit Hosting Layer — The .Anything Compute Grid
status: Draft
authors:
  - anthony@profullstack.com
created: 2026-07-28
updated: 2026-07-28
tags: [decentralized-hosting, compute, storage, vps, p2p, root-access, moshpit]
---

## Problem

Owning a custom TLD or subdomain (e.g., `scrambled.eggs`) means nothing if you still need AWS, Vercel, or a traditional VPS to host it. That reintroduces centralization: account bans, payment blocks, ToS takedowns, and DNS seizures. There is no way for a namespace owner to have true sovereignty over their domain *and* the compute/storage behind it. We need a hosting grid where `root@scrambled.eggs` is a real, persistent, owner-controlled shell — not a redirect to someone else's server.

## Goals

- Give every TLD/subdomain owner a sovereign compute instance that is censorship-resistant and persists as long as the owner pays the network.
- Allow anyone with spare compute (a home server, a Raspberry Pi, a rented dedi) to join the grid as a provider and earn revenue.
- Ensure the owner of `scrambled.eggs` has root access, can install software, run services, and persist data — just like a VPS, but no single provider can deplatform them.
- Make migration automatic: if Provider A goes offline, the instance respawns on Provider B within minutes with the same state.

## Non-Goals

- General-purpose cloud replacement for enterprise workloads (this is for web services, apps, and personal sites tied to the Moshpit namespace).
- Guaranteed 99.999% uptime (this is resilient, not enterprise SLA; target is "good enough for indie hackers").
- GPU compute or heavy ML training in V1 (CPU, RAM, SSD, and bandwidth only).
- Anonymous hosting (providers and tenants are pseudonymous but not anonymous; reputation matters).

## Users

**TLD Owners** — People who bought `.eggs` and want to run a registry dashboard, a forum, or an API on `registry.eggs` without relying on AWS.

**Subdomain Tenants** — Someone who bought `scrambled.eggs` and wants a blog, a store, or a custom app. They want `ssh root@scrambled.eggs` to Just Work.

**Grid Providers** — Homelabbers, small hosts, or datacenter operators with spare capacity who want to monetize it by renting to the network.

## Requirements

- R1 [P0] **Container-per-Domain**: Each domain (TLD or subdomain) maps to a container (OCI/Docker or lightweight VM). The owner has root inside their container. The container is the unit of migration.
- R2 [P0] **Encrypted State Snapshots**: The container's filesystem and data are snapshotted, encrypted with the owner's key, and replicated across 3+ provider nodes. No single provider can read the tenant's data.
- R3 [P0] **Owner Key Authentication**: Access to `root@scrambled.eggs` is gated by the owner's cryptographic key (SSH key or wallet-derived key). No passwords. No provider admin backdoor.
- R4 [P0] **Provider Marketplace**: A decentralized listing of available providers with reputation scores (uptime, bandwidth, latency). Tenants choose or auto-select providers.
- R5 [P1] **Auto-Migration**: If a provider fails a health check, the orchestrator automatically respawns the container on another provider using the latest encrypted snapshot. Target: <5 min downtime.
- R6 [P1] **Resource Metering**: Track CPU, RAM, storage, and egress per container. Tenants pay providers in a stable unit (USD-backed credits, not volatile crypto). The network takes a small facilitation fee.
- R7 [P1] **Reverse Proxy / Ingress**: The hosting layer exposes a reverse proxy so `scrambled.eggs:80` and `scrambled.eggs:443` route to the correct container, even as it migrates between providers. Integrates with the Moshpit browser extension resolver from PRD `0001`.
- R8 [P1] **CLI / TUI: The Canonical Interface**: A command-line tool (`preshy`) is the primary way to manage your instance remotely. All operations — provision, snapshot, rollback, status, ssh, mosh — are driven through the CLI/TUI. There is no mandatory web dashboard; the CLI works over mosh, ssh, or any pipe you have. If you can reach `scrambled.eggs`, you can manage it.
- R9 [P2] **Static Site Shortcut**: A zero-config mode where uploading a folder auto-deploys a static site on `scrambled.eggs` without the owner needing to manage a container.
- R10 [P2] **Provider Reputation Slashing**: Providers who fail health checks, lose data, or go offline are penalized (reduced visibility, withheld payouts, or temporary suspension from the marketplace).
- R11 [P1] **Default OS: Ubuntu LTS**: Every provisioned container boots the latest Ubuntu LTS release. No other OS options in V1. This is the one true environment.
- R12 [P1] **Default Provisioning: moshcode.sh**: On first boot, the container automatically runs `moshcode.sh` — installing mosh, dotfiles, dev tooling (git, vim, node, python, docker, wireguard), and any other standard environment setup. The owner gets a ready-to-hack box, not a blank slate.
- R13 [P2] **No Staging Environment**: There is no separate staging environment. There is only production. We build and test in production, like the good old days. Containers are cheap; if you break it, snapshot back or respawn. Speed > safety.
- R14 [P2] **Optional Staging Subdomain**: If a tenant wants a staging environment, they register a subdomain (e.g., `staging.scrambled.eggs`) through the normal TLD marketplace. It provisions the same Ubuntu LTS + `moshcode.sh` stack. No special staging tier — it is just another box.
- R15 [P2] **VPN-as-Root**: There is no separate VPN service. You are root on `scrambled.eggs`. WireGuard is pre-installed via `moshcode.sh`. Run `wg-quick up` or configure it however you want. Your VPS is your VPN endpoint. You tunnel through your own box because it is your box.

## UX Notes

**The CLI Is the Product**: You do not log into a web panel to manage `scrambled.eggs`. You run `preshy` from your laptop and it talks to your box over ssh or mosh. Provision: `preshy hosting init scrambled.eggs`. Check status: `preshy hosting status scrambled.eggs`. Rollback: `preshy hosting rollback scrambled.eggs`. SSH in: `preshy ssh scrambled.eggs`. Mosh in: `preshy mosh scrambled.eggs`. The TUI (`preshy tui`) gives you a dashboard in your terminal. If you have a terminal, you have full control. No browser required.

**Onboarding a New Site**: Owner of `scrambled.eggs` runs `preshy hosting init scrambled.eggs`. The CLI picks 3 providers, provisions an Ubuntu LTS container, runs `moshcode.sh`, and prints:
```
ssh root@scrambled.eggs
mosh root@scrambled.eggs
```
Ready in 60 seconds. Dotfiles, dev tools, mosh, and wireguard already installed.

**The Production-First Philosophy**: We do not maintain a separate staging environment. Every `git push` goes live. Containers are ephemeral and snapshotted; breaking production is a non-event — you roll back to the last snapshot. This is a feature, not a bug. It forces small, fast iterations and removes the "works on my machine" class of problems entirely.

**Want Staging? Buy It**: If you want `staging.scrambled.eggs`, register it like any other subdomain. It gets the same Ubuntu LTS + `moshcode.sh` stack. Point your DNS to it, test your changes, then promote to `scrambled.eggs` when ready. No special staging infrastructure — just another box in your namespace.

**VPN? You Are Root**: There is no `preshy vpn enable`. You are `root@scrambled.eggs`. WireGuard is already installed. Edit `/etc/wireguard/wg0.conf`, run `wg-quick up wg0`, and your phone/laptop tunnels through your own box. It is your VPS. You do not ask permission to run a VPN on your own server.

**Developer Flow**: A developer runs `preshy mosh scrambled.eggs`, clones a repo, runs `npm install`, edits in vim, and restarts the process. If it breaks, they run `preshy hosting rollback scrambled.eggs` from their local terminal. No browser, no web UI, no CI pipeline, no staging approval. The CLI is the only interface you need.

**Migration in Action**: Provider A in Texas goes down. The owner gets a push notification: "Your instance migrated to Provider B in Germany. Downtime: 3m 12s. No action needed. Ubuntu LTS + moshcode.sh restored from snapshot."

**Provider Dashboard**: A homelabber sees their node is earning $12/month hosting 4 small sites. They can set limits (max CPU, max bandwidth) and pause new assignments anytime.

**Static Site Flow**: A non-technical user buys `blog.eggs`. They drag a folder into a web UI. The site is live at `https://blog.eggs` in 30 seconds, backed by 3 providers, no container management needed.

## Success Metrics

- **M1**: 100 active containers running on the grid within 60 days of launch.
- **M2**: Average migration downtime under 5 minutes during provider failures.
- **M3**: 50+ providers joined the grid within 90 days.
- **M4**: A documented, working `ssh root@scrambled.eggs` flow that a new user completes in under 5 minutes.

## Risks & Open Questions

- **Encryption Key Loss**: If the owner loses their private key, their encrypted snapshots are unrecoverable. Do we offer a social-recovery or escrow option, or is that a feature (true sovereignty)?
- **Provider Collusion**: What if 2 of 3 providers collude to try to decrypt a tenant's data? Does our encryption scheme (e.g., Shamir's Secret Sharing) prevent this?
- **Legal Liability for Providers**: If someone hosts illegal content on `scrambled.eggs`, is the provider node operator liable? Do we need a content-policy layer or is this purely a neutral compute grid?
- **Bootstrapping the Grid**: Chicken-and-egg problem — no tenants without providers, no providers without tenants. Do we seed the grid with our own nodes initially?
- **Cost Competitiveness**: Can a distributed grid of homelabbers actually undercut AWS on price while being reliable enough? What is the minimum viable provider spec?
- **Integration with PRD 0001**: Should the browser extension resolve the hosting layer directly, or does the hosting layer publish IPs to the TLD directory? Who is the source of truth for "where is scrambled.eggs right now"?
- **moshcode.sh Maintenance**: Who owns and updates `moshcode.sh`? Is it a community script, a network-governed default, or controlled by the founding team? What happens if a tenant wants to opt out or customize it?
- **Production-First Risks**: Are we okay with the reputational risk of "these guys deploy straight to prod"? How do we message this so it sounds like confidence, not recklessness?
- **Staging Subdomain Confusion**: Will users expect `staging.*` to be free or discounted because it is "not production"? Do we price subdomains uniformly, or is there a staging tier?
- **VPN Abuse Liability**: If a tenant uses their root access to run a VPN for illegal activity (torrenting, botnets, etc.), does the provider node operator face liability? Is the provider's IP their own responsibility, or does the network need an abuse-reporting mechanism?
- **VPN Bandwidth Costs**: VPN traffic can be heavy. Is it metered against the tenant's plan, or does it incur overage? Who pays for the egress — tenant or provider?
- **CLI-Only Accessibility**: Will non-technical users be intimidated by a CLI-first product? Do we need a web dashboard as a secondary option, or is the target audience technical enough that this is a feature?
- **mosh/ssh Fallback**: If mosh is blocked on a network, does the CLI gracefully fall back to plain ssh? What if both are blocked — is there a web-based emergency console?

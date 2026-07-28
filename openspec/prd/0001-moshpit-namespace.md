---
openprd: "0.2"
id: "0001"
title: Moshpit Namespace — Decentralized Custom TLD Protocol
status: Draft
authors:
  - anthony@profullstack.com
created: 2026-07-28
updated: 2026-07-28
tags: [decentralization, dns, browser-extension, p2p, namespace, moshpit]
---

## Problem

The internet namespace is artificially scarce and centrally controlled. `.com` domains are exhausted or expensive, platform bans are arbitrary and irreversible (Reddit, X, LinkedIn), and users have no sovereignty over their own digital space. Existing decentralized alternatives like Tor optimize for anonymity and privacy, which introduces complexity and stigma that limits mainstream adoption. There is no middle ground: a decentralized namespace that is transparent, monetizable, and user-owned without the baggage of dark-web associations.

## Goals

- Enable anyone to create and operate their own top-level domain (e.g., `.eggs`, `.preshy`, `.scrambled`) without centralized approval.
- Allow TLD operators to sell subdomains (e.g., `scrambled.eggs`, `poached.eggs`) and retain revenue.
- Provide a browser-based resolution layer so these domains work seamlessly on the normal web.
- Build a viral, easy-to-understand hook that makes custom TLDs desirable and shareable.
- Create a pricing model that rewards early adopters with predictable, exponential long-term value.

## Non-Goals

- Anonymity or privacy-by-default (this is not Tor; traffic is transparent).
- Mobile-native resolution in V1 (desktop browser extension is the initial target).
- Replacing ICANN or the existing DNS root (this runs parallel to it, not as a hostile fork).
- Blockchain consensus or cryptocurrency payments for V1 (keep it simple: fiat or standard payment rails).
- Content hosting or storage (see companion spec `0002` for the Moshpit hosting layer).

## Users

**Platform Refugees** — Users banned or alienated by Reddit, X, LinkedIn, Bluesky who want a space they control and cannot be exiled from.

**TLD Entrepreneurs** — Early adopters who buy catchy TLDs (`.eggs`, `.crypto`, `.ai`) and sell subdomains to others.

**Developers & Indie Hackers** — People who want to run services on a namespace they fully control without rent-seeking registrars.

**Normie Curious** — Users who see a cool `.something` link and install the extension because it is novel and viral.

## Requirements

- R1 [P0] **Browser Extension Resolver**: A desktop browser extension (Chrome/Firefox/Edge) that intercepts custom TLD requests and resolves them via the Moshpit decentralized directory.
- R2 [P0] **TLD Registration**: Any user can register a new TLD (e.g., `.eggs`) on a first-come, first-served basis. Registration fee is flat and low initially.
- R3 [P0] **Subdomain Sales**: TLD operators can create and sell subdomains (e.g., `scrambled.eggs`) to other users. The TLD operator sets pricing and retains revenue.
- R4 [P0] **Decentralized Directory**: A peer-to-peer registry (DHT or similar) that maps custom TLDs and subdomains to IP addresses or redirect targets without relying on traditional DNS roots. No single server or company controls the directory.
- R5 [P1] **Pricing Guardrails**: TLD registration and renewal rates can only increase by a capped amount per year (e.g., $0.10/year max increase after year 1) to prevent gouging and encourage speculation.
- R6 [P1] **Service Hosting**: TLD operators can point domains to hosted services, static sites, or redirects just like traditional DNS.
- R7 [P1] **Viral Onboarding**: A landing page and explainer video that communicates the concept in under 60 seconds: "Buy .anything. Sell anything.yourthing."
- R8 [P2] **Store Bypass Distribution**: A distribution mechanism for the browser extension and any associated apps that does not depend on Chrome Web Store or Apple App Store policies (sideloading, PWA, or self-updating installer).
- R9 [P2] **Basic Reputation / Anti-Squatting**: A lightweight mechanism to discourage TLD squatting (e.g., use-it-or-lose-it renewal rules, or a small proof-of-use requirement).
- R10 [P1] **Moshpit Hosting Bridge**: The namespace must integrate with the companion Moshpit hosting layer (see PRD `0002`) so that `scrambled.eggs` resolves not just to an IP, but to a sovereign, owner-controlled compute instance with `root@scrambled.eggs` access.
- R11 [P0] **Clearnet Bootstrap**: `pit.moshcode.sh` serves as the clearnet entry point for users without the extension — a landing page that explains Moshpit, offers extension download, and allows TLD search/registration via standard HTTPS.

## UX Notes

**Discovery**: User sees `scrambled.eggs` in a tweet. They click it. If they have the Moshpit extension, it resolves. If not, they hit `pit.moshcode.sh` with a preview: "Install the Moshpit extension to visit .eggs domains."

**Registration Flow**: User visits `pit.moshcode.sh`, searches for a TLD, pays a flat fee (e.g., $5), and owns `.whatever`. They get a dashboard to manage subdomains and set prices.

**Subdomain Purchase**: A visitor wants `poached.eggs`. They go to `poached.eggs`, see a "Buy this subdomain" button, pay the TLD operator directly, and the operator provisions it via their dashboard.

**Resolution**: The extension maintains a local cache of the decentralized directory. For `.anything` requests, it checks the cache first, then the network. Standard domains (`.com`, `.org`) pass through untouched.

**Pricing Display**: On the registration page, show a 30-year projection: "Year 1: $1.00 | Year 10: $2.00 | Year 30: ~$1M" — illustrating exponential growth for early holders.

## Success Metrics

- **M1**: 1,000 custom TLDs registered within 90 days of launch.
- **M2**: 10,000 active Moshpit browser extension installs within 90 days.
- **M3**: Top 10 TLDs each have 50+ paid subdomains sold within 6 months.
- **M4**: A viral explainer video with 100K+ views.
- **M5**: Zero dependency on traditional app stores for distribution by month 3.

## Risks & Open Questions

- **DNS Leakage / ISP Blocking**: How do we prevent ISPs from simply blocking the bootstrap nodes or directory traffic? Do we need TLS-over-DNS or similar obfuscation?
- **Security & Phishing**: Without a centralized authority, how do we prevent `.bank` or `.apple` scams? Is reputation enough, or do we need a dispute/arbitration layer?
- **Browser Store Policy**: If Chrome bans the extension, does our sideloading/PWA strategy actually work for non-technical users?
- **Legal**: ICANN and trademark holders will not ignore this. What is our legal posture when the first C&D arrives?
- **Monetization Sustainability**: Is the TLD/subdomain model enough to fund infrastructure, or do we need a transaction fee on sales?
- **Mobile Path**: The conversation explicitly excludes mobile native for V1, but mobile is 60%+ of traffic. What is the actual technical path to mobile resolution (VPN app, custom browser, OS-level DNS)?
- **Directory Consensus**: If two people claim `.eggs` simultaneously in a decentralized system, who wins? Do we need a lightweight consensus or timestamping mechanism?

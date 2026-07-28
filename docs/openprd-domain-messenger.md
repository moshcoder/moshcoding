---
openprd: "0.2"
id: "0001"
title: "Standardize Passwordless Domain-Identity Messaging"
status: Draft
authors:
  - open-source-contributors
created: 2026-07-28
updated: 2026-07-28
repo:
discussion:
implementation:
tags:
  - messaging
  - identity
  - dns
  - e2ee
  - cli
  - tui
  - web
  - pwa
supersedes:
superseded-by:
---

# OpenPRD 0001 — Standardize Passwordless Domain-Identity Messaging

Working name: **Open Domain Messenger (ODM)**. This document defines an open,
implementable protocol and client family inspired by the product category of
passwordless, domain-based messengers, without copying any proprietary UI,
brand, protocol, or patented implementation.

## Problem

Mainstream messengers still anchor accounts to phone numbers, email addresses,
or passwords. That creates avoidable failure modes: SIM-swap and number-recycling
risk, mailbox takeover, password reuse/phishing, provider lock-in, opaque server
retention, and closed networks where identity dies if the company shuts down or
bans the account.

A newer product category showed demand for a different model: use a domain name
as the account identity, prove control through DNS/HTTPS instead of passwords,
minimize server-side retention, and sync across devices. The visible proof of
demand is proprietary and closed. The open-source ecosystem needs a clean-room,
interoperable specification with first-class terminal and browser clients so
users are not dependent on one company, one relay, one app store, or one
identity provider.

## Goals

- G1: Let a person or organization use a domain or subdomain they control as a
  portable messaging identity, e.g. `alice.example.com` or `team.example.org`.
- G2: Authenticate identity changes through domain control proofs over DNS TXT
  and/or HTTPS well-known documents, not passwords.
- G3: Make end-to-end encryption the default for direct messages, groups,
  attachments, and calls.
- G4: Keep relays dumb: route encrypted envelopes, retain as little as possible,
  expire undelivered data quickly, and never require plaintext message access.
- G5: Support secure multi-device use with explicit device linking, revocation,
  and encrypted history sync.
- G6: Ship three reference clients from one shared core: CLI, TUI, and Web/PWA.
- G7: Make federation practical: anyone can run a relay; identity remains valid
  across relays; clients from different teams can interoperate.
- G8: Be auditable: reproducible builds, published crypto design, test vectors,
  interop suite, and documented threat model.

## Non-Goals

- N1: Cloning any proprietary product's branding, UI, server code, patented
  protocol details, or user base.
- N2: Providing strong anonymity or metadata resistance in the MVP. Tor/onion
  routing and cover traffic are later, optional layers.
- N3: Becoming a blockchain naming system. Handshake/ENS/other name systems may
  be supported through resolvers later, but DNS remains the MVP root of control.
- N4: Replacing Signal/WhatsApp/iMessage feature-for-feature on day one. The
  first release optimizes for correctness, auditability, portability, and
  interop.
- N5: Requiring users to run servers. Self-hosting must be easy, but hosted
  relays are allowed.
- N6: Supporting plaintext fallback, server-side search of message content, or
  law-enforcement backdoors.
- N7: Mobile native apps in the first milestone. The PWA covers mobile browsers;
  native wrappers can come later.

## Users

- U1: Privacy-conscious domain owners who want messaging tied to infrastructure
  they already control.
- U2: Developers, sysadmins, and self-hosters who prefer terminal workflows and
  auditable daemons.
- U3: Small teams/communities that want `name.teamdomain.example` identities
  without giving a provider their phone book.
- U4: Client implementers who need a stable spec, test vectors, and a
  compatibility suite.
- U5: Relay operators who want a low-retention, low-support-cost service.
- U6: Security reviewers who need a narrow, documented crypto and identity
  boundary.

## Requirements

Priority key: P0 = required for the first usable release; P1 = required for a
credible 1.0; P2 = valuable after core adoption.

### Identity and account model

- R1 [P0] An identity is a DNS name or subdomain, encoded lowercase and
  normalized as UTS-46/IDNA where applicable. Example: `alice.example.com`.
- R2 [P0] Identity control is proven by publishing an ODM identity document at
  either `https://<identity>/.well-known/odm.json` or DNS TXT
  `_odm.<identity>`. Clients MUST prefer HTTPS when both exist and MUST detect
  conflicts. If sources conflict, clients MUST block automatic sending; a user
  MAY pin one source only after an explicit warning that is re-shown on every
  launch until resolved.
- R3 [P0] The identity document MUST contain: spec version, identity, current
  identity signing key, current key-agreement key or MLS credential material,
  relay hints, device policy, revocation list or transparency-log pointer,
  timestamps, and a signature over the canonical document.
- R4 [P0] Key rotation MUST NOT change the public identity. Old keys remain
  discoverable for a bounded overlap window unless explicitly revoked.
- R5 [P0] Revocation MUST be possible for devices and identity keys. A revoked
  device MUST stop receiving new key packages and MUST be visibly marked in
  clients.
- R6 [P0] DNSSEC is RECOMMENDED but not mandatory. Clients MUST surface DNSSEC
  state as one trust signal, not as a binary gate that breaks legacy domains.
- R7 [P1] Organizations MAY delegate issuance: a domain owner can authorize
  subdomain identities under a policy document, e.g. `*.team.example.com` with
  per-user approval hooks.
- R8 [P2] Resolvers MAY support non-DNS names through explicit adapter plugins;
  adapters MUST NOT weaken DNS-origin verification for normal domains.

### Cryptography and messaging

- R9 [P0] All message content MUST be end-to-end encrypted. Relays MUST NOT have
  message plaintext, attachment plaintext, contact lists, or group membership in
  plaintext.
- R10 [P0] Use audited primitives: Ed25519 for identity signatures, X25519 for
  legacy pairwise key agreement where needed, HPKE for sealed sender/device
  bootstrap, ChaCha20-Poly1305 or AES-256-GCM for payloads, Argon2id for local
  passphrase derivation, and MLS for group membership/evolution.
- R11 [P0] Group conversations SHOULD use MLS from the start; a two-person
  conversation is represented as a small MLS group unless a deployment profile
  explicitly selects pairwise Double Ratchet for constrained clients.
- R12 [P0] Every device has its own device identity key signed by the account
  identity key. Compromise of one device MUST NOT equal compromise of the whole
  account.
- R13 [P0] Perfect forward secrecy and post-compromise recovery are required for
  message sessions. Backup/export formats MUST be encrypted and MUST require an
  explicit user action.
- R14 [P1] Calls MUST use WebRTC with DTLS-SRTP at minimum; end-to-end media
  keying SHOULD use SFrame/MLS-derived keys where browser support allows.
- R15 [P1] Attachments MUST be chunked, content-addressed by ciphertext hash,
  resumable, and encrypted before upload. Servers store only opaque blobs plus
  size/TTL metadata.
- R16 [P0] Local storage MUST be encrypted at rest where the platform permits:
  SQLCipher or equivalent for CLI/TUI; WebCrypto-wrapped IndexedDB keys for PWA.
- R17 [P1] The protocol MUST define a transparency mechanism for identity-key
  history: append-only log, gossiped signed checkpoints, or equivalent. MVP MAY
  ship with signed key-history documents, but 1.0 SHOULD add a public log.

### Relay, retention, and federation

- R18 [P0] A relay MUST expose capability discovery at
  `/.well-known/odm-relay.json`, including supported versions, max blob size,
  mailbox TTL, push support, WebRTC signaling, abuse contact, and key-history
  endpoints.
- R19 [P0] Relays MUST accept and deliver only encrypted envelopes with a
  routing token, expiry, size, priority class, and sender proof-of-inbox-write.
  Relays MUST reject plaintext message bodies.
- R20 [P0] Default undelivered message TTL MUST be <= 7 days; delivered
  messages MUST be deleted after acknowledged receipt unless the recipient
  explicitly opts into server-assisted encrypted mailbox history.
- R21 [P0] Metadata MUST be minimized: no global social graph, no plaintext
  sender/recipient pairs after routing setup, rotating mailbox tokens, and no
  persistent public directory unless explicitly enabled.
- R22 [P0] Federation MUST NOT require permission from a central authority. Any
  HTTPS/WebSocket relay implementing the API can participate; identity validity
  comes from DNS/HTTPS proofs, not relay ownership.
- R23 [P1] Relays SHOULD support abuse controls that do not require reading
  content: rate limits, proof-of-work or payment for unknown senders, domain
  allow/deny lists, and signed abuse reports.
- R24 [P2] Relays MAY offer Tor onion endpoints, push notification relays, or
  media TURN services as separate capabilities.

### Multi-device sync and recovery

- R25 [P0] Adding a device MUST require an explicit ceremony on an existing
  device: QR code, short alphanumeric code, or local pairing. The new device
  proves control of its fresh device key and receives encrypted credentials.
- R26 [P0] Users MUST be able to list devices, rename them, see last-seen trust
  state, and revoke them from any still-trusted device.
- R27 [P0] Encrypted history sync MUST be opt-in per conversation. Sync blobs
  MUST be encrypted to the account/device set and MUST include deletion
  tombstones and read-state where the user chooses to sync them.
- R28 [P1] Conflict resolution MUST be deterministic: display order MAY use
  sender-declared timestamp plus message ID tie-break, but timestamps are
  advisory UI metadata and MUST NOT grant authority; profile/device metadata
  MUST order by signed sequence number.
- R29 [P1] Account recovery MUST NOT rely on a password. Options: existing
  trusted device, encrypted recovery kit, social recovery shares, or domain
  control re-assertion plus key rotation with visible security warnings.
- R30 [P2] A "domain moved" flow SHOULD support continuity when a user changes
  domains by publishing a signed migration statement from the old identity while
  the old domain remains controlled.

### Client requirements: shared core + CLI/TUI/Web/PWA

- R31 [P0] Implement one shared Rust core, `odm-core`, exposing: identity
  verification, key management, MLS/session handling, envelope encode/decode,
  relay client, sync engine, storage trait, and crypto audit logging.
- R32 [P0] Provide stable bindings: C ABI for embedding and WASM for the web.
  All clients MUST use the same canonical encodings and test vectors.
- R33 [P0] CLI binary `odm` MUST support: identity publish/verify, device
  link/revoke, send/receive messages, contacts import/export, relay config,
  mailbox drain, encrypted backup, and JSON output mode for scripting.
- R34 [P0] TUI binary `odm-tui` MUST provide: conversation list, message pane,
  identity/trust indicators, device manager, key verification screen, attachment
  picker, config editor, and keyboard-first navigation.
- R35 [P0] Web/PWA `odm-web` MUST compile the core to WASM, store state in
  IndexedDB, install as a PWA, work offline for cached encrypted history, and
  degrade gracefully when background push is unavailable.
- R36 [P0] The PWA MUST NOT require a central app store and MUST document
  browser limits: service-worker lifetime, push vendor lock, background sync
  gaps, private-mode storage eviction, and WebCrypto non-extractability.
- R37 [P1] CLI/TUI/Web MUST pass a common interop suite: same identity can send
  from CLI and read on PWA; revoked web device loses access; DNS rotation does
  not corrupt conversations.
- R38 [P1] Accessibility MUST be explicit: TUI has screen-reader-friendly plain
  mode; PWA meets WCAG 2.2 AA; crypto warnings are understandable without
  domain expertise.

### Operations and governance

- R39 [P0] The reference relay MUST be deployable with one container or one
  static binary plus config. State requirements MUST be documented and small by
  default.
- R40 [P0] All protocol changes MUST be proposed as OpenPRD-compatible docs and
  versioned. Wire formats MUST have explicit version negotiation.
- R41 [P0] Reference clients MUST publish reproducible builds, SBOMs, signed
  releases, and third-party dependency review.
- R42 [P1] Before calling anything "1.0 secure", obtain at least one external
  crypto/protocol review and publish the findings.
- R43 [P1] Maintain a public compatibility dashboard for independent clients
  and relays.
- R44 [P2] Establish a trademark/usage policy that keeps the protocol open while
  preventing misleading "certified" claims.
- R45 [P0] Choose OSI-approved licenses before public launch: the specification
  text SHOULD be CC-BY-SA-4.0 or equivalent, reference code SHOULD be
  MPL-2.0/Apache-2.0/MIT-style, and patent grant language MUST be reviewed.

## UX Notes

### Primary onboarding flow

1. User enters a domain/subdomain they control.
2. Client generates account identity key and first device key locally.
3. Client shows two publishing options:
   - DNS TXT: add `_odm.<name>` record with the signed identity document.
   - HTTPS well-known: upload `odm.json` to `/.well-known/`.
4. Client polls for publication, validates signature and DNSSEC state if present,
  and marks identity as `unverified -> pending -> verified`.
5. User chooses relays: default public relay, hosted provider, or self-hosted.
6. User optionally links a second device via QR/code.
7. Client explains the real trust boundary: control the domain, protect the
   registrar/DNS account, keep recovery kit offline.

### Important states

- `unverified`: keys generated locally; nothing published.
- `pending`: proof published but not yet visible/consistent.
- `verified`: identity document validates; messaging enabled.
- `conflict`: DNS and HTTPS documents disagree; sending is blocked until user
  resolves or explicitly chooses one source after warning.
- `rotating`: new identity key published; old key still accepted for overlap.
- `revoked`: device/key is untrusted; clients must not silently keep using it.
- `migrating`: old domain signed a migration to a new domain.
- `compromised-suspected`: user or peer marked key material suspect; UI/TUI must
  prefer loud re-verification over silent continuation.

### CLI examples

```bash
odm identity init alice.example.com --method dns --dns-provider cloudflare
odm identity publish --wait
odm device link --qr
odm send bob.example.net "spec draft is up" --conversation proposal
odm inbox --json --since 2026-07-28T00:00:00Z
odm backup create --out ./alice-odm-backup.age --recipient age1...
odm relay add https://relay.example.org --make-default
odm-tui --identity alice.example.com --theme light --plain
```

### TUI screens

- Conversations: sortable by unread, pinned, muted; trust badges per identity.
- Message pane: plaintext only after local decrypt; failed verification is a
  banner, not a footnote.
- Verify: side-by-side safety numbers/key fingerprints, QR scan via attached
  camera where available, manual compare path for headless systems.
- Devices: add/rename/revoke; show creation time, last sync, platform, and
  recovery authority.
- Publish: DNS provider profile, manual TXT instructions, HTTPS upload helper,
  propagation checker.
- Settings: relays, TTL policy, history sync, push, theme, plain mode, logging.

### Web/PWA constraints

- Use WASM for crypto/protocol logic; avoid duplicating sensitive logic in JS.
- Keep IndexedDB encrypted; never persist identity private keys extractable if
  WebCrypto allows non-extractable storage for wrapping keys.
- Service worker caches app shell and encrypted sync metadata only; it must not
  keep decrypted messages longer than the visible session requires.
- Push notifications should contain only a wakeup token or encrypted ping; no
  message preview unless the platform supports client-side decryption.
- On Safari/iOS, document limited background execution and recommend periodic
  foreground sync or a trusted desktop companion for high-volume users.

## Success Metrics

- SM1: A technically comfortable user can publish and verify an identity in
  under 10 minutes with DNS API automation, under 25 minutes manually.
- SM2: First-time DNS publication success rate >= 90% across the top five DNS
  provider automation paths.
- SM3: CLI-to-PWA interop passes 100% of the core conformance suite; at least
  two independent client implementations pass >= 95% before 1.0.
- SM4: Online direct-message delivery p95 < 2 seconds on broadband; offline
  delivery correct within TTL without duplicate plaintext recovery prompts.
- SM5: Relay default storage after delivery is near-zero for message content;
  undelivered encrypted envelopes expire by TTL in >= 99% of cases.
- SM6: No critical or high findings remain open from the external crypto review
  before stable release.
- SM7: Reproducible build verification succeeds for CLI, relay, and WASM core on
  Linux/macOS/Windows where applicable.
- SM8: User comprehension test: >= 80% of testers can explain that losing the
  domain/registrar account can mean losing the identity.

## Architecture Sketch

Components:

- `odm-core`: Rust library; canonical models, crypto, MLS integration, sync,
  relay client, verification, storage traits.
- `odm-relay`: Rust reference relay; HTTPS + WebSocket, object store or local
  disk for encrypted blobs, TTL sweeper, abuse/rate-limit hooks.
- `odm`: CLI for scripting and power users.
- `odm-tui`: terminal UI over the same core; optional daemon mode.
- `odm-web`: WASM PWA; IndexedDB storage adapter; service worker; WebRTC.
- `odm-tests`: conformance vectors, DNS/HTTPS fixtures, malicious-relay tests,
  federation interop runner.

Minimal identity document:

```json
{
  "version": 1,
  "identity": "alice.example.com",
  "identity_key": "ed25519:...",
  "credentials": [{"type": "mls", "key_package": "..."}],
  "devices": [{"device_id": "dev_...", "key": "ed25519:...", "status": "active"}],
  "relays": ["https://relay.example.org"],
  "policy": {"history_sync": "opt-in", "unknown_sender": "ask"},
  "revocations": [],
  "issued_at": "2026-07-28T00:00:00Z",
  "expires_at": "2026-08-27T00:00:00Z",
  "signature": "..."
}
```

Relay envelope:

```json
{
  "version": 1,
  "mailbox": "rotating-token",
  "expires_at": "2026-08-04T00:00:00Z",
  "class": "message",
  "sealed_sender": "...",
  "ciphertext": "...",
  "attachments": [{"id": "sha256:...", "size": 12345, "chunks": 3}],
  "write_proof": "..."
}
```

API surface, draft:

- `GET /.well-known/odm.json` — identity document.
- `GET /.well-known/odm-relay.json` — relay capabilities.
- `POST /v1/key-packages` — upload signed device key package.
- `GET /v1/identities/{name}/key-packages?device=` — fetch current packages.
- `POST /v1/mailboxes/{token}/messages` — submit encrypted envelope.
- `GET /v1/mailboxes/{token}/events` or `WS /v1/events` — receive envelopes.
- `POST /v1/attachments` / `PUT /v1/attachments/{id}/chunks/{n}` — blob upload.
- `POST /v1/devices/{id}/revoke` — publish signed revocation.
- `GET /v1/transparency/{identity}` — key-history checkpoint if enabled.

## Threat Model

In scope:

- Malicious or curious relay: can delay/delete/permute encrypted envelopes and
  observe coarse metadata, but MUST NOT read content or impersonate without
  detection.
- Malicious DNS provider/registrar: powerful; mitigated by DNSSEC where used,
  registrar 2FA, registry locks, transparency logs, key-history comparison, and
  user-visible warnings. Not fully solvable by protocol alone.
- WebPKI/CA compromise of the HTTPS well-known path: mitigated by treating HTTPS
  as one proof channel, cross-checking DNS TXT when available, certificate
  transparency monitoring where feasible, transparency/key-history comparison,
  and conflict blocking rather than silent preference.
- Device theft: mitigated by per-device keys, encrypted local storage,
  revocation, and optional passphrase/biometric wrapping.
- Key-package MITM by fake relay: mitigated because packages are signed by the
  identity key discovered from domain-controlled documents and checked against
  history.
- Spam/abuse: mitigated by domain cost, unknown-sender policies, rate limits,
  proof-of-work/payment, and block lists.

Out of scope for MVP:

- Global passive adversary with traffic analysis across relays.
- Compelled client-side scanning or malicious platform app stores.
- Guaranteeing domain ownership continuity after domain expiry or registrar
  seizure.
- Legal patent clearance; implementers need review and clean-room discipline.

## Risks & Open Questions

- Patent/legal risk: any commercial implementation that resembles an existing
  proprietary domain-messaging system needs legal review. This spec intentionally
  describes a clean-room protocol, but that is not a legal opinion.
- DNSSEC adoption is uneven; requiring it would exclude many users, while
  ignoring it weakens identity. Decision owed: exact trust UI and minimum policy
  for high-risk accounts.
- MLS browser/WASM maturity and bundle size need validation before committing to
  MLS-only groups in the PWA.
- Multi-device encrypted history sync conflicts with "minimal server retention"
  unless mailbox history is explicitly opt-in and TTL-bounded.
- Push notifications on mobile browsers are platform-limited; native wrappers
  may be required for a good mobile experience.
- Public key transparency is the strongest anti-MITM tool but adds operational
  complexity. Decision owed: reference log, third-party log, or gossip model.
- Domain expiry is an identity-death event. Need migration UX and warnings that
  do not encourage users to keep paying for domains they no longer want.
- Handshake/ENS adapters could broaden adoption but may import naming-system
  governance and resolver trust issues.
- Abuse handling without plaintext scanning is hard; unknown-sender economics may
  exclude legitimate low-income users if poorly designed.
- Need a name/trademark that is clearly distinct from existing "Thunderbolt"
  uses before public launch.

Template source: LogicSRC OpenPRD 0.2 template (`docs/openprd/0000-template.md`).

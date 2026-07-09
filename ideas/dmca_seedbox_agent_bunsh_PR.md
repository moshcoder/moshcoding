# PR: Add Bun.sh DMCA Seedbox Agent API + CLI

## Summary

This PR adds a Bun.sh-based HTTP API and CLI for turning BitTorrent / seedbox peer evidence into provider abuse-contact lookups and DMCA notice drafts.

The service is designed to be dry-run first. It resolves a peer IP, gathers provider/network contact data, creates an auditable report, drafts a DMCA notice as an `.eml` file, and only sends via SMTP when explicitly certified and enabled.

## Why

For BitTorrent / seedbox enforcement workflows, there usually is not a universal takedown API. The practical workflow is:

```text
BitTorrent peer evidence
  -> IP/provider lookup
  -> abuse contact resolution
  -> notice draft
  -> human or policy-controlled send
  -> audit trail
```

This PR implements that flow as a small agent-friendly service that other tools can call over HTTP or from the command line.

## What changed

### Added Bun.sh service

Adds a Bun-native TypeScript entrypoint at:

```text
src/index.ts
```

The app exposes:

```text
GET  /health
POST /resolve
POST /draft
POST /send
```

### Added IP/contact resolution

The resolver takes a BitTorrent peer IP and enriches it with:

- RDAP IP registration lookup
- RIPEstat abuse-contact lookup
- reverse DNS PTR lookup
- optional reverse-IP hosted-domain enrichment
- recommended provider/network abuse contacts
- warning messages when data is incomplete or only suitable as enrichment

Reverse-IP domains are intentionally treated as enrichment only. They are not used as notice recipients because domains on the same IP may be stale, shared-hosted, unrelated, or owned by someone other than the seedbox user.

### Added DMCA draft generation

The `/draft` endpoint and CLI draft mode create:

```text
dmca_out/
  reports/<ip>.json
  drafts/<ip>_<recipient>.eml
```

The notice draft includes:

- copyrighted work title
- optional work URL
- peer IP address
- port
- UTC timestamp
- BitTorrent info hash
- torrent name
- evidence reference URL
- rightsholder
- authorized agent name
- contact email / phone / address
- good-faith statement
- accuracy and authorization statement under penalty of perjury
- signature block

### Added guarded SMTP sending

The `/send` endpoint is locked down by default.

Real email sending requires all three conditions:

```text
certify: true
dryRun: false
DMCA_ENABLE_SEND=true
```

Without those, the endpoint stays in dry-run mode and returns the would-send payload.

### Added CLI helpers

The same functionality is available through Bun CLI commands:

```bash
bun run cli resolve --ip 198.51.100.25
```

```bash
bun run cli draft \
  --ip 198.51.100.25 \
  --port 51413 \
  --timestamp-utc '2026-07-09T18:22:00Z' \
  --info-hash 'abcdef1234567890abcdef1234567890abcdef12' \
  --torrent-name 'Example.Torrent.Name' \
  --work-title 'Example Copyrighted Work' \
  --work-url 'https://example.com/work' \
  --evidence-url 'https://example.com/evidence/log-001' \
  --rights-owner 'Your Company LLC' \
  --agent-name 'Your Name' \
  --contact-email 'dmca@example.com' \
  --contact-phone '+1-555-555-5555' \
  --contact-address '123 Example St, City, ST 00000' \
  --persist
```

### Added configuration

Adds `.env.example` with service, rightsholder, SMTP, reverse-IP, and safety settings:

```text
PORT=8787
DMCA_API_TOKEN=change-me
DMCA_RIGHTS_OWNER=Your Company LLC
DMCA_AGENT_NAME=Your Name
DMCA_CONTACT_EMAIL=dmca@example.com
DMCA_FROM_EMAIL=dmca@example.com
HACKERTARGET_API_KEY=
DISABLE_REVERSE_IP=true
DMCA_ENABLE_SEND=false
SMTP_HOST=smtp.example.com
SMTP_USER=dmca@example.com
SMTP_PASS=replace-me
```

### Added README

Adds usage documentation covering:

- install
- API startup
- auth token usage
- endpoint examples
- CLI examples
- environment variables
- evidence recommendations
- safety guardrails

## API examples

### Health check

```bash
curl http://localhost:8787/health
```

### Resolve an IP

```bash
curl -s http://localhost:8787/resolve \
  -H 'content-type: application/json' \
  -d '{
    "ip": "198.51.100.25",
    "includeReverseIp": true,
    "maxDomains": 50
  }'
```

### Draft a notice

```bash
curl -s http://localhost:8787/draft \
  -H 'content-type: application/json' \
  -d '{
    "evidence": {
      "ip": "198.51.100.25",
      "port": 51413,
      "timestampUtc": "2026-07-09T18:22:00Z",
      "infoHash": "abcdef1234567890abcdef1234567890abcdef12",
      "torrentName": "Example.Torrent.Name",
      "workTitle": "Example Copyrighted Work",
      "workUrl": "https://example.com/work",
      "evidenceUrl": "https://example.com/evidence/log-001"
    },
    "actor": {
      "rightsOwner": "Your Company LLC",
      "agentName": "Your Name",
      "contactEmail": "dmca@example.com",
      "contactPhone": "+1-555-555-5555",
      "contactAddress": "123 Example St, City, ST 00000",
      "fromEmail": "dmca@example.com"
    },
    "persist": true
  }'
```

### Dry-run send

```bash
curl -s http://localhost:8787/send \
  -H 'content-type: application/json' \
  -d '{
    "dryRun": true,
    "certify": false,
    "persist": true,
    "evidence": {
      "ip": "198.51.100.25",
      "port": 51413,
      "timestampUtc": "2026-07-09T18:22:00Z",
      "infoHash": "abcdef1234567890abcdef1234567890abcdef12",
      "torrentName": "Example.Torrent.Name",
      "workTitle": "Example Copyrighted Work"
    },
    "actor": {
      "rightsOwner": "Your Company LLC",
      "agentName": "Your Name",
      "contactEmail": "dmca@example.com",
      "fromEmail": "dmca@example.com"
    }
  }'
```

## Safety / legal guardrails

This PR intentionally avoids fully automatic takedown sending by default.

Built-in guardrails:

- API can be protected with `DMCA_API_TOKEN`.
- SMTP sending is disabled unless `DMCA_ENABLE_SEND=true`.
- `/send` requires `certify: true` for real sending.
- `/send` remains dry-run unless `dryRun: false` is provided.
- Reverse-IP hosted domains are not used as recipients.
- JSON reports and `.eml` drafts are persisted for review/audit.
- Notices include evidence fields needed for provider review.

Operational recommendation: use the generated `.eml` drafts for human or policy-based review before enabling SMTP send mode.

## Testing

The following checks were performed in the build environment:

```bash
# TypeScript source was generated and reviewed.
# Project structure was created successfully.
# Package includes README, package.json, .env.example, and src/index.ts.
```

Known limitation: Bun itself was not installed in the sandbox used to generate this PR, so the service was not executed end-to-end in that environment.

Recommended local validation before merge:

```bash
bun install
bun run check
bun run start
curl http://localhost:8787/health
```

Then test the API endpoints with sample payloads:

```bash
curl -s http://localhost:8787/resolve \
  -H 'content-type: application/json' \
  -d '{"ip":"1.1.1.1","includeReverseIp":false}'
```

```bash
bun run cli resolve --ip 1.1.1.1
```

## Risk

### Low risk

- Default mode is dry-run.
- Sending is gated behind both request-level and environment-level flags.
- Generated notices are written as drafts for review.

### Medium risk

- External lookup APIs can return incomplete, stale, or incorrect contact data.
- Abuse contacts may refer to the network/provider, not the individual seedbox user.
- Reverse-IP enrichment can produce unrelated domains on shared hosting or recycled IPs.

### Mitigation

- Keep reverse-IP data as enrichment only.
- Prefer RDAP / abuse-contact results for recipients.
- Require evidence validation and authorization before sending.
- Keep audit reports for every generated draft/send attempt.

## Rollout plan

1. Merge with `DMCA_ENABLE_SEND=false`.
2. Deploy internally behind an API token.
3. Use `/resolve` and `/draft` only for initial testing.
4. Review generated `.eml` notices manually.
5. Enable SMTP only after notice templates and evidence quality are approved.
6. Add provider-specific connectors later for hosts with dedicated abuse APIs or webform automation.

## Follow-up work

Suggested future improvements:

- Add provider-specific routers for common seedbox/VPS hosts.
- Add queueing and retry logic.
- Add CSV/batch upload endpoint.
- Add dashboard for reviewing drafts before send.
- Add signed webhook callbacks for agent workflows.
- Add persistent database storage instead of filesystem-only audit output.
- Add rate limiting per provider/contact.
- Add tests with mocked RDAP, RIPEstat, DNS, and SMTP calls.

## Checklist

- [x] Bun.sh HTTP API added
- [x] CLI helpers added
- [x] RDAP lookup added
- [x] RIPEstat abuse-contact lookup added
- [x] reverse DNS lookup added
- [x] optional reverse-IP enrichment added
- [x] DMCA `.eml` draft generation added
- [x] JSON audit report generation added
- [x] SMTP send path added behind safety gates
- [x] README added
- [x] `.env.example` added
- [ ] Run `bun install` locally
- [ ] Run `bun run check` locally
- [ ] Run API smoke test locally
- [ ] Review legal copy with counsel or authorized rightsholder representative before real sending

# Plan: OpenPRD spec for open-source Thunderbolt-like messenger

## Stage 1 — Load applicable writing guidance
- Load `report-writing` skill because the deliverable is a structured product/spec document.
- Scope: use only the parts relevant to producing a concise, decision-oriented PRD/spec in Markdown.

## Stage 2 — Source the OpenPRD template
- Fetch `https://github.com/profullstack/logicsrc/blob/master/docs/openprd/0000-template.md`.
- Preserve the template's section structure and intent while replacing example content with this project.

## Stage 3 — Draft the OpenPRD
- Define an open-source, passwordless, domain-identity messenger inspired by Thunderbolt.
- Required scope from user:
  - CLI client
  - TUI client
  - Web app / PWA
- Include architecture, identity model, crypto, sync, storage, federation/interop, security model, threat model, APIs, data schemas, UX flows, MVP, milestones, and open questions.
- Avoid copying proprietary claims; design an implementable open protocol.

## Stage 4 — Validate and deliver
- Self-review for completeness, internal consistency, and security realism.
- Write final Markdown deliverable to `/mnt/agents/output/openprd-domain-messenger.md`.
- Provide a short summary and file reference in the final response.

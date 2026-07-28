---
openprd: "0.2"
id: "0003"
title: Moshpit Chat — Decentralized Real-Time Chat (IRC on Steroids)
status: Draft
authors:
  - anthony@profullstack.com
created: 2026-07-28
updated: 2026-07-28
tags: [irc, chat, messaging, p2p, real-time, cli, tui, moshpit]
---

## Problem

IRC is dead because it relied on central servers, NickServ drama, and bouncers from 2003. Modern chat (Slack, Discord, X DMs, LinkedIn) is centralized, surveilled, and ban-happy. There is no real-time communication layer that is decentralized, domain-sovereign, and terminal-native. We need IRC's speed and simplicity with modern identity, persistence, and P2P routing.

## Goals

- Replace Slack, Discord, X DMs, email threads, and LinkedIn InMail with a real-time chat protocol tied to `.anything` domains.
- Make your domain your nick. `anthony@scrambled.eggs` is your handle everywhere. No accounts, no passwords, no platform lock-in.
- Run channels like IRC (`#general@eggs`, `#dev@scrambled`) but with persistence, encryption, and no central server to kill.
- Keep it terminal-first. The CLI/TUI is the canonical client. GUI is secondary.

## Non-Goals

- Video/voice in V1 (text, files, and voice notes only — IRC didn't have video and neither do we, yet).
- Blockchain or tokens for messaging (no gas fees to send a message).
- Backwards compatibility with legacy IRC (clean break, new protocol).
- Mobile-native apps in V1 (terminal via Termius or mosh from phone is enough).

## Users

**Old-School Hackers** — People who still run irssi/weechat and want something modern without leaving the terminal.

**Banned Platform Refugees** — Users kicked off Reddit/Discord/X who want a channel they actually own.

**Dev Teams** — Teams who want `#deploys@company` without paying Slack $15/seat and without Slack logging everything.

## Requirements

- R1 [P0] **Domain-as-Nick**: Your identity is your domain. `anthony@scrambled.eggs` joins `#general@eggs`. No registration, no NickServ, no password resets. If you own the domain, you own the nick.
- R2 [P0] **P2P Channel Mesh**: Channels exist as distributed state across participant nodes. `#general@eggs` is not hosted on a single server — it is replicated across every member's `scrambled.eggs` box. If half the network drops, the channel keeps going.
- R3 [P0] **CLI/TUI Client**: The canonical client is `moshpit` in your terminal. `moshpit join #general@eggs`, `moshpit msg anthony@preshy "sup"`, `moshpit tui` for a weechat-style interface. No Electron, no RAM hog.
- R4 [P0] **Persistent History**: Unlike IRC, messages persist. Your `scrambled.eggs` node stores channel history encrypted and syncs it to your other devices. No bouncer needed.
- R5 [P1] **Direct P2P DMs**: `/msg anthony@preshy` routes directly between your node and theirs, encrypted, no server in the middle.
- R6 [P1] **P2P File Transfer**: `/dcc send anthony@preshy backup.tar.gz` transfers directly between nodes over the hosting grid. No file size limits but metered by bandwidth plan.
- R7 [P1] **Channel Ops by Domain**: Channel operators are determined by domain ownership. Owner of `.eggs` ops `#general@eggs`. Owner of `scrambled.eggs` ops `#private@scrambled`. No drama, no takeovers.
- R8 [P2] **Web/PWA Fallback**: A lightweight web client at `chat.scrambled.eggs` for when you are on a machine without the CLI. Boots via the browser extension.
- R9 [P2] **TLD-Wide Broadcasts**: TLD operators can send network-wide notices (e.g., `.eggs` owner announces a policy change to all subdomain holders).

## UX Notes

**Joining a Channel**: `moshpit join #dev@eggs`. Your terminal splits. You see history synced from the mesh. You type, it floods to all peers. You `/quit`, your node stays in the channel as a ghost (optional) to buffer messages until you return.

**Starting a Channel**: `moshpit create #random@scrambled`. It exists because your node says it does. Others join by name. No server to apply for, no rate limits.

**Direct Message**: `moshpit msg anthony@preshy "wanna buy .toast?"`. It routes P2P. If `preshy` is offline, it queues on your node and retries.

**File Drop**: `moshpit send anthony@preshy ./designs.zip`. Progress bar in terminal. Direct pipe, no cloud storage intermediary.

**The Vibe**: It is IRC. You are in channels. You have ops. You /msg people. But your nick is permanent, your history survives, and no company can kill the server because there is no server.

## Success Metrics

- **M1**: 100 active channels across the Moshpit network within 60 days.
- **M2**: 1,000 daily messages routed P2P within 60 days.
- **M3**: 50% of active `.anything` domains running a `moshpit` node within 90 days.
- **M4**: Zero project team communication happening over Slack/Discord by month 3 for early adopters.

## Risks & Open Questions

- **Netsplit Behavior**: If the mesh fragments, how do channels reconcile divergent history? CRDTs? Last-write-wins? Do we need a minimal consensus?
- **Spam / Channel Flooding**: Without a central server to ban IPs, how do we prevent `#general@eggs` from being ruined? Domain reputation? Channel-level invite-only?
- **Storage Growth**: Persistent history on every node means storage grows forever. Do we cap it? Archive old messages to cold storage?
- **Offline Queuing**: If `anthony@preshy` is offline for a week, do you queue messages on your node the whole time? What is the TTL?
- **Moderation at Scale**: IRC had channel ops. That works for 50 people. What about 5,000? Do we need delegated moderation or is that a non-goal?

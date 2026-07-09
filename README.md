# #MOSHCODING

**Code hard. Mosh harder.** A Spotify playlist — and a brand — for developers who ship to a wall of distortion.

> **moshcoding** is the brand. **Profullstack, Inc.** (an S-corp) remains the legal entity — `profullstack.com` stays registered; `moshcoding.com` is the face.

```
while (alive) {
  code();
  mosh();
  repeat();
}
// no bugs, only features
```

## Brand kit

Everything in `images/` and `videos/` is the visual identity.

| Asset | File |
|-------|------|
| Square logo panel (mascot lockup) | `images/moshcoding_original_01_square_logo_panel.png` |
| Playlist cover (square) | `images/moshcoding_01_playlist_cover_panel_square.png` |
| Wide banner | `images/moshcoding_02_wide_banner_main.png` |
| Coder workstation card | `images/moshcoding_03_coder_workstation_card.png` |
| "Turn code into chaos" | `images/moshcoding_04_turn_code_into_chaos.png` |
| Terminal playlist card | `images/moshcoding_05_terminal_playlist_card.png` |
| Badge — Code Hard | `images/moshcoding_06_badge_code_hard.png` |
| Badge — No Bugs, Just Features | `images/moshcoding_07_badge_no_bugs.png` |
| Badge — Push Code, Start Pits | `images/moshcoding_08_badge_push_code_start_pits.png` |
| Bottom banner — Build / Break / Mosh | `images/moshcoding_09_bottom_banner_build_break_mosh.png` |
| Promo video 16×9 | `videos/Moshcoding Video 16x9.mp4` |
| Promo video 9×16 | `videos/Moshcoding Video 9x16.mp4` |

Square variants (`*_square.png`) are packaged for social avatars/tiles. Individual layered assets: `images/moshcoding_individual_assets.zip`.

## Identity

- **Mascot** — mohawked skeleton coder in headphones, bony hands on a laptop tagged `</>` and `SHIP IT`.
- **Palette** — pure black ground, **poison / acid green** accent, Spotify green for the playlist tie-in.
- **Type** — torn brush-stroke metal lettering; the wordmark is always `#MOSHCODING`.
- **Voice** — `code(); mosh(); repeat();` · Code Hard, Mosh Harder · Build. Break. Repeat. · No Bugs, Just Features · Push Code, Start Pits · Deadlines Are For The Weak.
- **Domain** — MOSHCODING.COM · always paired with the Spotify mark.

## The app

**Next.js (App Router) on Bun.** A killer `#MOSHCODING` landing page **plus** a one-liner
product: point any domain at moshcoding and it renders a blacked-out, poison-green
coming-soon page with a working email waitlist.

```
moshcoding.com/?dn=yourdomain.com
```

- **Tenant mode** — `?dn=<domain>` is server-rendered as a focused launch page for that
  domain. Copy/accent auto-derive from the domain name, or drop a
  `configs/<domain>.json` override (`brand`, `headline`, `tagline`, `sub`, `accent`, `cta`,
  plus `hashtag` and a linktree via `socials`/`links`). Every tenant page carries a
  **"© 2026 powered by moshcoding.com"** link.
- **Waitlist** — `POST /api/waitlist { email, dn? }`, stored in **libSQL / Turso**
  (`signups` table, unique per email+domain) via `@libsql/client`.
- **Login** — "Log in with CoinPayPortal" (OAuth2 Auth Code + PKCE); email captured to a
  `users` table. Self-disables until the `COINPAY_*` + `SESSION_SECRET` env vars are set.
- **www → apex** redirect handled in `middleware.ts` (308 to `https://moshcoding.com`).

### Run it (Bun)

```bash
cp .env.example .env      # fill in TURSO + COINPAY + SESSION vars
bun install
bun run dev               # http://localhost:8080
# tenant demo:            http://localhost:8080/?dn=killer-startup.io
```

Env: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (required) · `COINPAY_ISSUER`,
`COINPAY_CLIENT_ID`, `COINPAY_CLIENT_SECRET`, `SESSION_SECRET`, `APP_BASE_URL` (for login) ·
`PORT` (default 8080). Turso tables are created automatically on first request.

### Deploy (Railway)

Builds from the **Dockerfile** (`oven/bun` → `bun run build` → `bun run start`);
`railway.json` sets the start command + `/api/me` health check. Set the env vars above in
the service variables — no volume needed, Turso is the database.

## Links

- 🎧 Spotify playlist — _TODO: add link_
- 🌐 moshcoding.com — landing page + `?dn=` waitlist (this repo)
- 𝕏 / TikTok — @moshcoding (fallback @moshcoder)

## License

Brand assets © 2026 Profullstack, Inc. (dba moshcoding), all rights reserved.
Code in this repo is MIT (see `LICENSE`).

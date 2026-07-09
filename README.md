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

A killer `#MOSHCODING` landing page **plus** a one-liner product: point any domain at
moshcoding and it renders a blacked-out, poison-green coming-soon page with a working
email waitlist.

```
moshcoding.com/?dn=yourdomain.com
```

- **Tenant mode** — `?dn=<domain>` swaps the site for a focused launch page for that
  domain. Copy/accent auto-derive from the domain name, or drop a
  `configs/<domain>.json` override (`brand`, `headline`, `tagline`, `sub`, `accent`, `cta`).
  Every tenant page carries a **"© 2026 powered by moshcoding.com"** link.
- **Waitlist** — `POST /api/waitlist { email, dn? }`, stored append-only in
  `$DATA_DIR/waitlist.jsonl` (deduped per email+domain). No database, no native deps.

### Run it

```bash
npm install
npm start            # http://localhost:8080
# tenant demo:       http://localhost:8080/?dn=killer-startup.io
```

Env: `PORT` (default 8080) · `DATA_DIR` (default `./data`; point at a mounted volume in prod).

### Deploy (Railway)

Nixpacks auto-builds (`railway.json` sets the start command + `/healthz`). For persistent
signups, mount a volume and set `DATA_DIR` to it (e.g. `/data`). No other config required.

## Links

- 🎧 Spotify playlist — _TODO: add link_
- 🌐 moshcoding.com — landing page + `?dn=` waitlist (this repo)
- 𝕏 / TikTok — @moshcoding (fallback @moshcoder)

## License

Brand assets © 2026 Profullstack, Inc. (dba moshcoding), all rights reserved.
Code in this repo is MIT (see `LICENSE`).

# NdoxWatch: report the flood water, get sats

*"Ndox" means water in Wolof.* Satellites tell us where to look; you show us what they missed.

> Built for Dakar Bitcoin Hack 2026. MIT licensed. **Demo: test sats, sample data.** See
> [What's simulated](#constraints--whats-simulated) before you trust any number on screen.

## Problem & primary user
When floods hit, emergency teams can't see which streets are under water, and satellite radar misses flooding in
dense cities and vegetated plains.

- **Nigeria, 2026 season:** NEMA reported 673,350 people affected in 134 LGAs across 28 states, 214,997 of them
  displaced, and 245 deaths, as of Oct 20, 2026
  ([Daily Trust](https://dailytrust.com/nema-flood-disaster-has-caused-245-deaths-displaced-214997-in-2026/),
  [The Gazette](https://gazettengr.com/nigerias-floods-killed-245-people-displaced-over-200000-says-nema/)).
  These are season totals; the displaced are counted within the affected.
- **Senegal, Oct 2–5, 2026:** ANACIM recorded 142 mm in 24 h at Rufisque and 138 mm at Dakar-Yoff (peak on Oct 4).
  The Interior Minister cited five deaths, and press counts go up to seven across Dakar, Kaolack, Touba and Matam
  ([US News/Reuters](https://www.usnews.com/news/world/articles/2026-10-05/heavy-rains-lead-to-senegal-floods-government-reports-several-deaths),
  [Œil d'Afrique](https://oeildafrique.com/2026/10/05/inondations-dakar-senegal-pluies-morts/)).
  The International Charter "Space and Major Disasters" was activated on Oct 8, 2026 (Activation 1053, requested by
  UNOSAT on behalf of UNOCHA) ([Disasters Charter](https://disasterscharter.org/activations/flood-in-senegal-activation-1053-)).
- **Satellites miss water:** a 2025 study in *Earth Systems and Environment* compared Sentinel-1, Sentinel-2 and
  Landsat flood maps with UNOSAT reference maps. In Matam's rural floodplain, Sentinel-1 had about 54–60% error,
  mostly missed flooding ([Springer](https://link.springer.com/article/10.1007/s41748-025-00796-8)). *We have read
  the abstract only and have not confirmed exactly how the paper defines "error".* Radar also struggles between
  buildings.

**Primary user:** a young resident or an okada/taxi driver with a mid-range Android, outside, in the rain, on a weak
signal. **Funder:** an emergency desk (NEMA/SEMA, the Red Cross, a municipal crisis committee, an insurer) that
posts a sat bounty over a zone.

## Demo
- 3-minute script: [DEMO.md](DEMO.md). Video: *HUMAN TODO: add link*
- Live MVP: *HUMAN TODO: add the Vercel URL*

## How it works
```
 phone (PWA)                                   server (Next.js on Vercel)                Postgres + PostGIS (Neon)
 ───────────                                   ─────────────────────────                 ─────────────────────────
 camera → ≤1024px JPEG (EXIF stripped)          POST /api/reports (multipart)             zones, flood_mask
 GPS fix                                        1 verify sig, window, replay, sha256,     reports (precise point,
 tap depth                                        loc_commit                                server-only)
 sign kind-30078 event with the phone's   ───►  2 zone      ST_Contains                   report_photos (bytea,
   Nostr key: {zone, depth, photo_sha256,       3 caps      per key / geohash7             purged after 7 days)
   loc_commit}, tag g = geohash5 only           4 dHash     Hamming ≤ 6                   rewards / claims ledger
 offline? queue in IndexedDB, retry ≤ 6 h       5 satellite ST_DWithin(mask, 300 m)
                                                6 AI        Gemini photo check (zod)  ──► Gemini (proposes only)
                                                7 score     code, first rule wins
                                                8 reward    accrue(zone.reward_sats)
                                                9 publish   signed event → Nostr relays (geohash5 only)

 /wallet: phone's own NWC wallet  ◄── invoice ──  POST /api/claim (signed claim event)
          (string never leaves the phone)          funder wallet pays via NWC (SPONSOR_NWC_URL, server env only)
 /map:    geohash5 cells only (~5 km)              /funder: ADMIN_TOKEN, review queue, budget, pause, export
```

**The GIS edge.** A Sentinel-1 change-detection flood mask from Google Earth Engine ([GEE_FLOOD_MASK.md](GEE_FLOOD_MASK.md)):
VV backscatter, median pre (dry) and post (event) composites, 50 m focal median for speckle, flood where the drop is
more than 3 dB *and* post VV is below −16 dB, permanent water (JRC GSW ≥ 80%) and slopes over 5° removed. The mask
is a **prior worth one point, never a judge**: water reported outside it goes to a human as **"Satellite missed?"**,
which are exactly the reports a funder wants to see. Zones without a mask (the live demo zone) score out of 5
instead of 6, so they can still auto-approve.

## Why Bitcoin / Lightning / Nostr
- **Lightning:** accountless, cross-border micro-payouts (100 sats) to unbanked strangers in seconds, with a spending
  cap the funder enforces in their own wallet (NWC budget). Cards and mobile money can't pay 10,000 strangers ₦100
  each without onboarding every one of them. NdoxWatch never holds funds: the funder's wallet pays the reporter's
  wallet directly.
- **Nostr:** every report is signed by the reporter's key, so it can't be quietly edited or deleted, and anyone can
  re-count the public (coarse) reports. The signature also covers the photo hash and a commitment to the precise
  location (`loc_commit = sha256(geohash9:created_at)`), so the server can verify both while only geohash5 is ever
  published. The same key signs reward claims: no accounts, no phone numbers.

## Where AI is used and how it's evaluated
- **What it does:** one vision call per photo (`@sats/ai.extractJson`, zod-validated): `water_visible`, `est_depth`,
  `outdoor`, `screen_or_print`, `confidence`, `flags`.
- **What it can't do:** set amounts, pick recipients, approve payouts. Code scores the report; the amount comes
  from the zone. If the AI call fails, the report goes to a human, never auto-paid.
- **Eval:** `pnpm eval` runs the check on 29 labelled photos (see [Seed data](#seed-data)) and writes
  `eval/RESULTS.md`. **No Gemini key was available before the deadline**, so the committed file is
  [`eval/RESULTS.mock.md`](eval/RESULTS.mock.md): it was run with `AI_MOCK` fixtures and measures the harness, not
  the model. Its 55% precision is the fixture answering "water, knee" for every photo, dry streets included.
- **Rules:** [`eval/ATTACKS.md`](eval/ATTACKS.md): 20/20 attack cases behave as designed (real pipeline and claim
  code against in-process PostGIS; AI verdicts injected per case).

## Security by design
Full table in [THREAT_MODEL.md](THREAT_MODEL.md). In short:
- The funder's NWC string is server env only (`pay_invoice`-only, with a budget, in production; boot warning
  otherwise). The reporter's wallet string stays in their phone's IndexedDB.
- Precise coordinates and photos are server-only and need `ADMIN_TOKEN` (constant-time compare, lockout). The public
  map and Nostr events carry geohash5 (~5 km) only. Photos are purged after 7 days (daily Vercel cron).
- No names, phones or emails. EXIF is stripped on the phone and again on the server.
- zod on every input, 400 KB photo cap, rate limits per opaque client key, per-request nonce CSP (MapLibre origins
  allowed on `/map` and `/funder` only), allowlisted logger with an audit test that scans every attack path.
- GPS spoofing is **reduced, not prevented**. The worst-case loss is bounded by the funder's NWC budget and
  `MAX_DAILY_PAYOUT_SATS`.

## Low-bandwidth UX
- **Three taps:** photo → depth → send. The depth picker is a staff gauge: tap a band and the water rises to it.
- **Offline:** if the POST fails, the signed report is queued in IndexedDB and retried on reconnect and every 30 s
  for up to 6 hours (the server accepts events signed up to 6 h ago; `event_id` uniqueness stops replays). A hazard
  strip says when you're offline.
- **Photos:** downscaled on the phone to ≤1024 px JPEG (~100–150 KB) before upload.
- **First-load JS (gzip), production build, measured by fetching each route's `<script>` files and gzipping them**
  (excludes Next's 38 KB `nomodule` polyfill, which modern browsers skip):
  `/` ≈ 145 KB, `/report` ≈ 166 KB, `/map` ≈ 146 KB before the map chunk loads, `/wallet` ≈ 245 KB.
  About 130 KB of that is the Next.js + React runtime. MapLibre (~250 KB) loads lazily on `/map` and `/funder`
  only. The Lightning SDK and QR code are kept out of the shell (`@sats/ui/light`).
- Two self-hosted fonts (Atkinson Hyperlegible for legibility, Big Shoulders for big labels), high contrast in light
  and dark mode, ≥ 56 px tap targets, EN / FR / Nigerian Pidgin.
- Wallet connect retries once with a longer timeout, because the first NWC relay connection is often slow.
- Not done: a throttled Slow 3G run on a real device. *HUMAN TODO before the video.*

## Setup
```bash
pnpm install
cp .env.example .env.local                      # then set the values below
docker compose --profile db up -d db             # local PostGIS (or point DATABASE_URL at Neon/Supabase)
pnpm db:migrate                                  # creates the postgis extension + tables (idempotent)
pnpm seed                                        # Rufisque replay zone, flood mask, live demo zone (DEMO_ZONE_CENTER)
pnpm personas --from-eval                        # synthetic reports in the replay zone (see below)
pnpm dev
```
Needed in `.env.local`: `DATABASE_URL`, `SPONSOR_NWC_URL` (funder wallet), `NWC_RELAY_ORIGINS`, `ADMIN_TOKEN`,
`DEMO_ZONE_CENTER=lat,lon`, and either `AI_MOCK=1` or `GEMINI_API_KEY`. On Vercel: Root Directory `apps/web`, the
same variables, plus `CRON_SECRET` for the photo purge.

Other scripts: `pnpm attack` (→ `eval/ATTACKS.md`), `pnpm eval` (→ `eval/RESULTS.md`), `pnpm checkpoint`
(end-to-end money path with real test wallets), `pnpm typecheck && pnpm lint && pnpm test`.

## Seed data
- **Zones:** `seed/zones.geojson`, a Pikine – Keur Massar – Rufisque replay zone (100 sats per report, active Nov 1 – Dec 31, 2026),
  plus a 2 km live demo zone around `DEMO_ZONE_CENTER` (`is_demo`, never shown on the public map).
- **Flood mask:** right now a **placeholder** polygon (`seed/flood_mask_placeholder.geojson`, labelled
  "placeholder" on the map). The real Sentinel-1 mask for Oct 2026 comes from the GEE script in
  [GEE_FLOOD_MASK.md](GEE_FLOOD_MASK.md); *HUMAN TODO: export it, then `pnpm seed` replaces the placeholder.*
- **Photos:** `eval/photos/` holds 25 **stock photos from Wikimedia Commons** under open licences (CC0, public domain,
  CC BY, CC BY-SA; per-file credits in [eval/photos/CREDITS.md](eval/photos/CREDITS.md)) plus 4 dark/blurry
  variants derived from them. They are **not field reports from NdoxWatch users**. Some show floods in Nigeria and
  Senegal; some are from elsewhere. The depth labels in `eval/photos/labels.json` are a visual judgement made while
  building this, not measured ground truth.
- **Personas:** `pnpm personas --from-eval` submits the 14 original water photos as synthetic reports at random
  points in the replay zone (60% inside the mask), signed by three persona keys plus one-off keys, through the real
  pipeline. On our Neon database: 8 `auto_ok`, 6 "Satellite missed?" in review.

## Metrics
| Metric | Value | How measured |
|---|---|---|
| Attack cases handled as designed | 20 / 20 | `pnpm attack` → [eval/ATTACKS.md](eval/ATTACKS.md) |
| Unit + integration tests | 116 passing (22 files) | `pnpm test` (PGlite + PostGIS in-process) |
| End-to-end payout | report → `auto_ok` +100 sats → claim `paid`; live-reporter balance 10,000 → 10,100 sats | `pnpm checkpoint` against Neon with faucet wallets (Nov 19, 2026) |
| AI photo check accuracy | **not measured yet** (mock only) | `pnpm eval` needs `GEMINI_API_KEY`; mock harness run in [eval/RESULTS.mock.md](eval/RESULTS.mock.md) |
| `/report` first-load JS | ≈ 166 KB gzip | production build, see [Low-bandwidth UX](#low-bandwidth-ux) |
| Public location precision | geohash5 (~4.9 km × 4.9 km) | `/api/cells`, Nostr `g` tag; `admin.test.ts` |
| Photo retention | 7 days | `/api/cron/purge` (daily), `admin.test.ts` |

## Constraints & what's simulated
- **Money:** faucet test sats between test wallets, not mainnet.
- **The Dakar/Rufisque zone replays the Oct 2–5, 2026 event.** Its reports are synthetic personas using stock
  photos, and its flood mask is currently a placeholder, not the Sentinel-1 product.
- **The live demo zone** is a 2 km circle around the presenter (FUTA, Akure) so a live report can work during the
  demo. Real reports there use the phone's real GPS; we never fake GPS in the app. `pnpm checkpoint` is a
  server-side script that submits a report near the zone centre, and it says so.
- **AI:** the deployed demo runs with `AI_MOCK=1` (fixed "water, knee, 0.9" answer) until a Gemini key is set, so
  the AI check on the demo is not real. The pipeline, scoring, review and attack handling are.
- Rate limits are in memory, per serverless instance.

## Next steps
Flood season 2027 pilots with an NGO or a SEMA; the real Sentinel-1 mask per event; measured AI accuracy on field
photos; Banxaas-style cash-out to mobile money; USSD/SMS reporting for feature phones; NIP-44 encrypted precise
reports to funders; a data API for emergency desks. Out of scope for now: live Sentinel processing, reputation
scores, Cashu/offline payouts, other hazards.

## License
MIT. Photo credits: [eval/photos/CREDITS.md](eval/photos/CREDITS.md).

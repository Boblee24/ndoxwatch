# NdoxWatch: "Report the flood water, get sats. Satellites tell us where to look; you show us what they missed."

*("Ndox" means water in Wolof.)* This repo was created from `sats-starter`. **The starter rules (`STARTER_RULES.md`) still apply** (units, logging allowlist, secrets, zod, AI never moves money, no custody, HUMAN TODO blocks). Work through `BUILD_ORDER.md` in order.

## The pitch (10-second version)
When floods hit, emergency teams can't see which streets are under water, and satellite radar misses flooding in dense cities and vegetated plains. NdoxWatch lets residents snap the water, tap how deep it is, and earn sats once the report passes a satellite-map, location and AI photo check.

- **Primary user:** the reporter, a young resident or an okada/taxi driver with a mid-range Android. The **funder** is an emergency desk (NEMA/SEMA, the Red Cross, a municipal crisis committee, an insurer) that posts sat bounties over a zone.
- **Why now (cite in the README; verify each source while writing it):**
  - Nigeria: NEMA reported 673,350 people affected, 214,997 displaced and 245 deaths across 28 states as of Oct 20, 2026.
  - Senegal: the Oct 2–5, 2026 rains (peaking Oct 4) brought 142 mm in 24 h at Rufisque and 138 mm at Dakar-Yoff (ANACIM). The Interior Minister cited five deaths, and press counts go up to seven across Dakar, Kaolack, Touba and Matam. The International Charter "Space and Major Disasters" was activated on Oct 8, 2026 (Activation 1053, requested by UNOSAT on behalf of UNOCHA).
  - Satellites miss water: a 2025 study (*Earth Systems and Environment*) found Sentinel-1 flood maps had about 54–60% error in Matam's rural floodplain, mostly missed flooding, when checked against UNOSAT reference maps. Radar also struggles in dense cities. **Confirm what "error" means in the paper's methods before quoting it.**
  - Sources: see the claims table in `00_MASTER_PLAN.md`. Use that wording.
- **Why Bitcoin:** accountless, cross-border micro-payouts (100 sats) to unbanked strangers within seconds, with a spending cap the funder enforces. Cards and mobile money can't pay 10,000 strangers ₦100 each without onboarding every one of them.
- **Why Nostr:** every report is signed by the reporter's key, so it can't be quietly edited or deleted, and anyone can re-count the public (coarse) reports.
- **Why AI:** a vision check of each photo (is water visible? does the depth make sense? is it a photo of a screen?) makes verification possible at scale. **AI proposes, rules decide.**
- **The hidden GIS edge:** a Sentinel-1 change-detection flood mask (Google Earth Engine) plus PostGIS geofencing and geohash privacy.

## Architecture
- Next.js app + Postgres **with PostGIS** (Supabase project "ndoxwatch" with the PostGIS extension enabled; locally `postgis/postgis` under the `db` profile). Drizzle for tables, **raw SQL for `ST_*` queries**.
- `@sats/payouts` provides the rewards ledger and claims. The funder wallet is `SPONSOR_NWC_URL` (server env only).
- Photos are downscaled on the phone (≤1024px JPEG, about 100–150 KB, EXIF stripped by canvas re-encode). The server re-encodes with `sharp` and stores them as `bytea` in a separate table, **deleted after 7 days**. No extra storage service needed.

### Data model
- `zones(id, name, geom geometry(MultiPolygon,4326), reward_sats, active, starts_at, ends_at, is_demo bool)`
- `flood_mask(id, source, pre_window, post_window, geom geometry(MultiPolygon,4326))`
- `reports(id uuid, reporter_pubkey, event_id, event jsonb, created_at, geom geometry(Point,4326) /* precise, server-only */, accuracy_m, geohash5, geohash7, depth ['ankle','knee','waist','impassable'], photo_sha256, photo_dhash bigint, checks jsonb, ai jsonb, score int, status ['auto_ok','review','rejected'], reject_code, zone_id)`
- `report_photos(report_id, jpeg bytea, created_at)`, purged after 7 days
- Plus the `@sats/payouts` tables

### Pages
| Route | Purpose |
|---|---|
| `/` | What it is + "Report water" (huge) + wallet status |
| `/report` | Camera → depth chips → submit (3 taps). Offline queue. Result card with each check ✓/✗ |
| `/wallet` | WalletPanel + claimable rewards + **auto-claim** |
| `/map` | Public map: **geohash5 cells only** (about 5 km), coloured by max depth, with counts. Flood-mask layer toggle. Lazy-loaded. |
| `/funder` | Admin (ADMIN_TOKEN): zones + mask + precise reports, **review queue** (incl. "Satellite missed?"), budget meter, pause, GeoJSON/CSV export |

## Report signing (location and photo committed without publishing them)
The client signs a kind 30078 event (`d` = report uuid):
- `content`: `{ v:1, zone_id, depth, photo_sha256, loc_commit }`, where `loc_commit = sha256(geohash9 + ":" + created_at)`
- `tags`: `[["g", geohash5], ["t","ndoxwatch"]]`

`POST /api/reports` (multipart) carries `{ event, lat, lon, accuracy_m, photo }`. The server checks that the photo's sha256 matches and recomputes `loc_commit` from lat/lon, so the signature covers the photo and the precise location even though only geohash5 is ever public.

## Verification pipeline (server, in order)
1. **Verify:** signature valid; `created_at` between **now − 6 h and now + 5 min** and inside the zone's `starts_at`/`ends_at` (the offline queue sends signed reports late, so a ±15 min window would reject exactly the reports from places with no signal); `event_id` not seen before (**UNIQUE `reports.event_id`**: this, not the time window, is the replay defence); zod (lat/lon ranges, accuracy ≤ 5000, depth enum); photo MIME/size (≤ 400 KB) and sha256 match; `loc_commit` match.
2. **Zone:** `ST_Contains(zone.geom, point)` for an active zone, else reject `OUTSIDE_ZONE`.
3. **Caps:** ≤3 paid reports per pubkey per zone per day; no two paid reports by the same pubkey in the same geohash7 within 60 min → `CAP` (reject).
4. **Duplicate photo:** `dHash` (sharp → 9×8 grayscale) with Hamming distance ≤ 6 against all stored hashes → reject `DUPLICATE`.
5. **Satellite prior:** `in_mask: true | false | null`.
   - `null` when **no mask intersects the zone** (the live demo zone in Akure, or any zone without a satellite product). There's no satellite opinion, so it's neither a point nor a "Satellite missed?" flag.
   - Otherwise `ST_DWithin(mask.geom::geography, point::geography, 300)` → `true | false`. **Outside the mask is not a rejection**; it may be exactly what the satellite missed.
6. **AI photo check** (`@sats/ai.extractJson`, image part):
   ```ts
   z.object({
     water_visible: z.boolean(),
     est_depth: z.enum(["none","ankle","knee","waist","impassable","unclear"]),
     outdoor: z.boolean(),
     screen_or_print: z.boolean(),   // photo of a screen/printout/meme
     confidence: z.number().min(0).max(1),
     flags: z.array(z.enum(["blurry","dark","people_identifiable","text_overlay","none"])).max(4)
   })
   ```
   Hard reject: `screen_or_print`, or (`!water_visible` && confidence ≥ 0.8). If the AI call fails, send the report to `review`; never auto-pay without the AI check.
7. **Score (code):** +2 water_visible, +1 depth consistent (within one class), +1 outdoor, +1 accuracy ≤ 50 m, +1 `in_mask === true`. Max = 6 with a mask, 5 when `in_mask === null`. Apply these rules **in this order; the first match wins**:
   1. `in_mask === false && water_visible` → `review`, labelled **"Satellite missed?"** in the funder console (even if the score would pass: these are the reports funders most want a human to see)
   2. score ≥ max − 1 (≥ 5 with a mask, ≥ 4 without) → `auto_ok`
   3. score ≥ max − 3 (3–4 with a mask, 2–3 without) → `review`
   4. else → `rejected (LOW_SCORE)`

   Without the `null` case, the live demo zone (no mask) could never reach `auto_ok`, contradicting the Phase 2 checkpoint and demo step 3. Unit-test all four rules for both mask states.
8. **Reward:** `auto_ok` (or approved in review) → `accrue({ pubkey, sats: zone.reward_sats, sourceId: report.id })`. The amount comes from the zone, never from the client or the AI.
9. **Publish:** best-effort publish of the signed event (geohash5 only) to `NOSTR_RELAYS`.

## Security (THREAT_MODEL.md)
- **Fake reports / GPS spoofing:** zone + time window + caps + dHash + AI + review. Say plainly that spoofing is **reduced, not prevented**, and that the NWC budget plus `MAX_DAILY_PAYOUT_SATS` bound the worst-case loss.
- **Sybil keys:** per-key caps, geohash spacing, the daily payout cap, and the review queue for low scores.
- **Funder treasury:** `SPONSOR_NWC_URL` lives in server env only, with `pay_invoice`-only in production (boot warning), a budget and an expiry.
- **Reporter safety and privacy:**
  - No names, phones or emails
  - EXIF stripped on the device and again on the server
  - Precise coordinates are server-only; the public map and the Nostr event carry only geohash5
  - Photos are purged after 7 days, and flagged `people_identifiable` photos are never shown publicly
  - Logs hold ids, codes and latency only
- **Inputs:** zod everywhere, image limits, rate limits per opaque client key, constant-time `ADMIN_TOKEN` compare.
- **Satellite overclaiming:** the mask is a **prior**, never the judge. Label it with the source and the date windows.

## Demo reality (be honest in the README)
- The Dakar/Rufisque zone **replays the Oct 3–5, 2026 event** with a real Sentinel-1 mask and synthetic seed reports.
- A **demo zone** around the presenter's location (`DEMO_ZONE_CENTER=lat,lon`, 2 km radius, `is_demo=true`, labelled "Live demo zone") lets the live report work from Akure. Never fake GPS.
- Faucet test sats; scripted personas for density.

## Demo script (3 min)
1. 0:00–0:30 Problem: NEMA numbers; Dakar's 142 mm; "satellites under-map floods".
2. 0:30–1:00 Funder: zone over Rufisque, the Sentinel-1 mask appears, budget 5,000 sats, 100 sats per report.
3. 1:00–1:50 Reporter (phone on Slow 3G): Report water → photo → "knee" → ✓ signature ✓ in zone ✓ new photo ✓ AI water 0.9 → +100 sats in the wallet.
4. 1:50–2:20 Attacks: the same photo again → `DUPLICATE`; a photo of a screen → rejected; a report outside the mask with water → "Satellite missed?" review → approve; the budget hits its cap → `BUDGET_REACHED`.
5. 2:20–2:45 Public map: depth by area, coarse cells only (privacy).
6. 2:45–3:00 Next: flood season 2027, NGO-run deployments, Banxaas-style cash-out, USSD reporting, data API.

## Out of scope (Next steps)
Live Sentinel processing, reputation scores, USSD/SMS reporting, NIP-44 encrypted reports to funders, Cashu/offline payouts, other hazard types (fire, potholes).

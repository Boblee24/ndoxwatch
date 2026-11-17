# NdoxWatch: BUILD_ORDER

Session C. Start: **Tue 12:30 WAT**. Tick the boxes as you go and keep every time box.

## Phase 1: Geo data + reporter flow (Tue 12:30–17:00)
- [x] Rename to `ndoxwatch`; Drizzle schema (CLAUDE.md) + raw SQL migration enabling `postgis`, with GIST indexes on `zones.geom`, `flood_mask.geom` and `reports.geom`
- [x] `docker compose --profile db up` works locally (PostGIS image)
- [x] Loaders: `pnpm seed:geo` loads `seed/zones.geojson` and `seed/flood_mask_*.geojson` (use `ST_GeomFromGeoJSON`, then `ST_Multi`, `ST_MakeValid`, and `ST_SimplifyPreserveTopology` if large)
  - Until the human delivers the GEE export, generate a **placeholder** mask polygon around Rufisque and mark it `source: "placeholder"`
  - Demo zone from `DEMO_ZONE_CENTER` (2 km buffer via `ST_Buffer(geography)`)
- [ ] HUMAN TODO: GEE flood mask per `GEE_FLOOD_MASK.md` → drop the GeoJSON into `seed/`
- [ ] `/report` (mobile-first, 3 taps):
  - [x] `<input type="file" accept="image/*" capture="environment">` → canvas downscale ≤1024px, JPEG q0.7 → sha256
  - [x] `navigator.geolocation` (high accuracy, 15 s timeout) → show accuracy; warn if > 100 m
  - [x] Depth chips with icons (ankle / knee / waist / impassable), big and labelled
  - [x] Sign the event (CLAUDE.md "Report signing") with `ngeohash` for geohash5/7/9
  - [x] `POST /api/reports` multipart
- [x] Server: steps 1–2 of the pipeline (verify + zone), store the report + photo
- [x] **Checkpoint:** a phone report inside the demo zone is stored, and one outside is rejected with `OUTSIDE_ZONE` (verified in tests + over HTTP with `scripts/smoke-report.ts`; on a real phone still HUMAN TODO, needs `DEMO_ZONE_CENTER`)

## Phase 2: Pipeline + payouts + offline (Tue 17:00–23:00)
- [x] `lib/dhash.ts` (sharp 9×8 grayscale → 64-bit) + Hamming + tests (same image re-encoded → ≤ 6; different image → > 6)
- [x] Pipeline steps 3–5 (caps, duplicate, satellite prior) + step 7 scoring (until Phase 3, treat a missing AI result as `review`) + tests
- [x] Rewards: `accrue` on `auto_ok`; `/wallet` WalletPanel + claimable + **auto-claim** (client invoice for the exact claimable amount → `POST /api/claim`)
- [x] Result card on the phone: each check ✓/✗ with a plain-language reason (EN/FR/Pidgin)
- [x] Offline queue: if the network fails, store the signed report + photo in IndexedDB → retry with backoff → "Saved, will send when you have signal". Drop queued items older than 6 h with a "too old to send" message (the server's time window). Test: a report signed 2 h ago is accepted; the same event sent twice → second one rejected as a replay.
- [ ] `scripts/personas.ts`: 3 personas submit about 20 synthetic reports in the Rufisque replay zone (seed photos: HUMAN TODO, 10 of your own photos of standing water, gutters and dry streets; no faces)
- [ ] HUMAN TODO: faucet wallets `funder` (`SPONSOR_NWC_URL`), `persona1–3`, `live-reporter`
- [ ] **Checkpoint (23:00):** a live report from your phone in the demo zone → `auto_ok` (AI mocked) → sats land in the reporter wallet

## Phase 3: AI + attack tests + eval (Wed 08:00–12:00)
- [ ] AI photo check (schema in CLAUDE.md) as step 6; `AI_MOCK` fixtures; on failure → `review`
- [ ] `eval/photos/` + `labels.json`. HUMAN TODO: about 30 of your own photos: water (ankle/knee depth), dry streets, a photo of a screen showing a flood, a printout, a dark/blurry shot; no faces
- [ ] `pnpm eval` → `eval/RESULTS.md`: water_visible precision/recall, depth agreement rate, `screen_or_print` detection, p50/p95 latency, estimated cost per report
- [ ] `pnpm attack` → `eval/ATTACKS.md`, a table of expected vs actual for: duplicate photo, re-encoded duplicate, out of zone, cap exceeded, replayed event, tampered signature, photo hash mismatch, `loc_commit` mismatch, invoice amount ≠ claimable, claim when the budget is reached

## Phase 4: Funder console, public map, security, deploy (Wed 12:00–20:00)
- [ ] Map stack: MapLibre GL JS + OpenFreeMap vector style (verify the style URL), **lazy-loaded** on `/map` and `/funder` only. Add the style, tile, glyph and sprite origins to `connect-src`/`img-src` and `worker-src blob:` via the starter's `buildCsp`, **for those two routes only** (`/report` keeps the strict starter CSP). Open the map on a phone and check the console for CSP errors.
- [ ] `/funder` (ADMIN_TOKEN): zones + mask layers, precise reports, review queue with photo + AI output + checks, **approve/reject**, a "Satellite missed?" filter, budget meter (`spendToday` + `wallet.budget()`), pause payouts, export GeoJSON/CSV (precise data is admin-only)
- [ ] `/map` (public): `GET /api/cells` → `{ geohash5, count, max_depth }` only, cached 60 s; mask toggle; legend in EN/FR
- [ ] Photo purge job (on request or a daily route hit by Vercel Cron) deleting `report_photos` older than 7 days
- [ ] THREAT_MODEL.md (CLAUDE.md "Security"); log audit + a test (no coordinates/photos in logs); rate limits
- [ ] Docker: `docker compose --profile db up` → migrate → seed geo + personas → app. `pnpm demo` wraps it.
- [ ] Deploy: Vercel + Supabase project `ndoxwatch` (enable PostGIS); env vars; run the seeds

## Phase 5: Polish + docs (Wed 20:00–Thu 10:00)
- [ ] Slow 3G pass: first-load JS for `/report` < 150 KB (the map is never loaded on `/report`); measure and record
- [ ] UI strings `en`, `fr`, `pcm`; 48px+ targets; high contrast
- [ ] README from the template: problem + sources, why Bitcoin/Nostr/AI, the GIS method (pre/post windows, thresholds, limits), eval + attack tables, security, setup, **what's simulated** (replayed event, demo zone, personas, faucet sats), next steps
- [ ] Final: fresh clone in Codespaces → one command works

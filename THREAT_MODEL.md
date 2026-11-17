# Threat model: NdoxWatch

NdoxWatch pays residents small amounts of sats for geotagged flood photos. That makes three things worth attacking: the funder's money, the reporters' safety and privacy, and the integrity of the flood data emergency teams act on.

## Assets
| Asset | Where it lives | Why it matters |
|---|---|---|
| Funder NWC string (`SPONSOR_NWC_URL`) | Server env only | Pays every reward |
| `ADMIN_TOKEN` | Server env; typed into the funder console, kept in that tab's sessionStorage | Sees precise locations and photos, approves payouts, pauses payouts |
| `CRON_SECRET` | Server env (Vercel) | Triggers the photo purge |
| Reporter Nostr key | Phone IndexedDB only (backup shown once) | Signs reports; it *is* the reporter's account and claim authority |
| Reporter wallet NWC string | Phone IndexedDB only, never sent to the server | Receives payouts |
| Precise location of each report | `reports.geom`, server only | Shows where a person was standing |
| Report photos | `report_photos` (bytea), server only, deleted after 7 days | May show homes, plates or faces |
| Flood data integrity | `reports` + signed Nostr events | Emergency teams decide where to send help |

## Actors
- Honest reporter (mid-range Android, patchy network), funder (emergency desk), admin/reviewer.
- Attackers: **sats farmer** (fake or recycled photos, many keys, spoofed GPS), **thief** (claims someone else's rewards), **replayer** (re-sends signed reports), **prompt injector** (text in the photo aimed at the AI), **curious public** (wants to locate a reporter), **stolen admin token**, **network attacker**.

## Trust boundaries
```
phone (key, wallet, photo) ⇄ app server ⇄ Postgres/PostGIS, Gemini API
app server ⇄ funder's wallet (NWC over Nostr relays)
app server → public Nostr relays (signed events, geohash5 only)
anyone ⇄ /map (geohash5 cells only)
```

## Threats → mitigations
| Threat | Mitigation | Test / evidence |
|---|---|---|
| Recycled photo (same or re-encoded/resized) | dHash (9×8) with Hamming distance ≤ 6 against every stored hash | `dhash.test.ts`, `eval/ATTACKS.md` |
| Photo of a screen / printout / meme | AI `screen_or_print` → hard reject; AI never sets amounts | `score.test.ts`, `eval/ATTACKS.md` |
| Dry street, nothing to see | AI `water_visible=false` with confidence ≥ 0.8 → reject; low scores → review or reject | `score.test.ts` |
| AI unavailable / malformed output | zod-validated; any failure → `review`, never auto-paid | `pipeline.test.ts`, `ai.test.ts` |
| Prompt injection in the photo | image wrapped as `<untrusted_content>`; output is a fixed zod schema with no money or recipient fields; rules decide | `@sats/ai` tests |
| GPS spoofing / reporting from home | zone `ST_Contains`, signed −6 h/+5 min window, per-key caps, dHash, AI check, satellite prior, human review. **Reduced, not prevented.** | `eval/ATTACKS.md` |
| Sybil keys (many fresh keys) | ≤ 3 paid reports per key per zone per day; one per geohash7 per 60 min; app-wide `MAX_DAILY_PAYOUT_SATS`; the funder's NWC budget | `pipeline.test.ts`, `payouts.test.ts` |
| Replay of a signed report | UNIQUE `reports.event_id` (and report id); out-of-zone reports are re-rejected anyway | `pipeline.test.ts` ("REPLAY") |
| Editing a report after signing (depth, photo, location) | Schnorr signature over content; photo sha256 must match; `loc_commit = sha256(geohash9:created_at)` recomputed from the sent lat/lon; public `g` tag must equal geohash5 | `eval/ATTACKS.md` |
| Claiming someone else's rewards | claim requires a fresh event signed by the reporter's key whose content is the bolt11 (±5 min) | `claims.test.ts`, `eval/ATTACKS.md` |
| Over-claim, invoice games, double pay | `@sats/payouts`: exact-amount invoice ≤ claimable, network check, UNIQUE payment_hash, reserve → pay → settle, ambiguous payments stay pending | `payouts.test.ts`, `eval/ATTACKS.md` |
| Funder wallet drained | NWC connection should be `pay_invoice`-only with a budget and expiry (boot warning in production if broader); `MAX_DAILY_PAYOUT_SATS`; funder can pause payouts | `payouts.test.ts`, `/funder` |
| Locating a reporter from public data | public map and Nostr events carry geohash5 (~5 km) only; demo zones (centred on the presenter) are never public; precise data needs `ADMIN_TOKEN` | `admin.test.ts` ("public data is coarse") |
| Photo metadata leaks (EXIF GPS, device) | canvas re-encode on the phone; `sharp` re-encode on the server (drops all metadata) | `pipeline.ts` `reencodeJpeg` |
| Faces in photos | UI asks for water, not people; AI flags `people_identifiable`; photos are never public and are purged after 7 days | `/api/cron/purge`, `admin.test.ts` |
| Admin token guessing / timing | SHA-256 + `timingSafeEqual`; 5 wrong tries then 1/min per client; admin APIs rate-limited | `admin.test.ts` |
| CSV injection in exports | every cell quoted; text cells starting with `= + - @` prefixed | `/api/admin/export` |
| XSS / injected scripts | per-request nonce CSP; map origins added for `/map` and `/funder` only; no `dangerouslySetInnerHTML` | `csp.test.ts` |
| Flooding the API | token-bucket rate limits per hashed client key on reports, claims, public map data, admin; 400 KB photo cap checked before parsing | route code |
| PII in logs | allowlisted logger; audit test runs every attack path and scans the logs | `logaudit.test.ts`, `log.test.ts` |
| Satellite overclaiming | the mask is a prior worth +1 point, never a judge; outside-the-mask water goes to human review ("Satellite missed?"); the map labels the source and date windows | `score.test.ts` |

## Residual risks
- **GPS spoofing** with a rooted phone and a fresh photo of real water can still earn up to the per-key cap. The worst-case loss is bounded by the funder's NWC budget and `MAX_DAILY_PAYOUT_SATS`; the review queue and the public, signed record make patterns visible.
- **Sybil farming** with many keys and many real photos is bounded by the daily cap, not prevented. Reputation scores are out of scope.
- **In-memory rate limits** reset on deploy and are per instance on serverless. Good enough for a pilot; use a shared store (e.g. Postgres or Redis) before scale.
- **AI false negatives/positives**: measured in `eval/RESULTS.md`; humans review the uncertain middle.
- **Admin token in a browser tab**: a compromised funder laptop exposes precise locations and photos from the last 7 days. Rotate the token after each deployment window.
- **Dev mode CSP** blocks some inline styles (starter issue); production CSP is unchanged.

## What we log / never log
- **Log:** event name, id (report/claim uuid), paymentHash, latencyMs, status, code, count.
- **Never log:** request bodies, IPs, coordinates, geohashes, photos, pubkeys, signatures, invoices, NWC strings, tokens.

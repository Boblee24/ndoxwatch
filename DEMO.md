# NdoxWatch: 3-minute demo script

**Setup before recording**
- Laptop: `/funder` open and logged in (ADMIN_TOKEN), on the "Satellite missed?" tab. Second tab: `/map`.
- Phone: the deployed URL, inside the live demo zone (FUTA, Akure). `/wallet` already connected to the
  **live-reporter** test wallet (paste once; connect retries by itself if the relay is slow). Chrome DevTools remote
  or the phone's own throttling set to Slow 3G if you can.
- Have ready: a **fresh** photo of standing water (a bucket or a puddle near the venue is fine: say so), the same
  photo again, and a phone/TV screen showing a flood photo.
- Check `AI_MOCK`. If it's still `1` (no Gemini key), the AI check always says "water": **don't** claim live AI
  rejections, and use the `eval/ATTACKS.md` table for the screen attack (step 4).
- Run `pnpm checkpoint` once beforehand if you need proof the payout path works with these exact wallets.

| Time | On screen | Say (roughly) |
|---|---|---|
| **0:00–0:30** Problem | Landing page on the phone ("See water? Show us.") | "This flood season NEMA counts 673,350 people affected and 245 deaths in Nigeria. On Oct 4, Rufisque got 142 mm of rain in a day. Emergency teams can't see which streets are under water, and satellite radar under-maps floods between buildings and under vegetation." |
| **0:30–1:00** Funder | `/funder`: zone over Pikine–Rufisque, the flood-mask layer, budget meter | "An emergency desk posts a bounty over a zone: 100 sats per verified report, capped by their own wallet's budget. The red layer is the satellite flood map. Today it's a **placeholder**; the Sentinel-1 change-detection script is in the repo. It's a prior, not a judge." |
| **1:00–1:50** Reporter | Phone: Report → photo → tap **Knee** (water rises on the gauge) → Send → result card: ✓ signed ✓ in zone ✓ new photo ✓ water → **+100 sats** stamp → Wallet: auto-claim, balance goes up | "Three taps. The phone signs the report with its own key; the signature covers the photo hash and a commitment to the exact location, but only a 5 km cell is ever public. Code checks it, the funder's wallet pays mine directly over Lightning. No account, no phone number." |
| **1:50–2:20** Attacks | Send the same photo again → **"This photo was already sent"** (DUPLICATE). Then `/funder` → "Satellite missed?" → a report outside the mask → photo → **Approve & pay**. Then `eval/ATTACKS.md` (20/20): screen photo → SCREEN_OR_PRINT, budget used up → BUDGET_REACHED | "Recycled photos are caught even resized. Water the satellite missed isn't rejected: it goes to a human, because those are the reports a funder most wants. Screen photos, over-claims, replays, stolen claims: all 20 attack cases behave as designed." *(If the Gemini key is live, do the screen photo on the phone instead.)* |
| **2:20–2:45** Public map | `/map`: geohash5 cells coloured by max depth, the mask toggle | "Anyone can see depth by area, never a person's location: 5 km cells only. Every report is a signed Nostr event anyone can re-count." |
| **2:45–3:00** Next | Landing page | "Next: pilots in the 2027 flood season with an NGO, the real Sentinel-1 mask per event, mobile-money cash-out, USSD reporting for feature phones, and a data API for emergency desks." |

**Be honest on camera:** test sats; the Rufisque reports are synthetic personas using Wikimedia Commons stock photos;
the mask is a placeholder until the GEE export lands; the live demo zone exists so a real report can work from Akure.

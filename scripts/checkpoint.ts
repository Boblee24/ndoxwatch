/**
 * pnpm checkpoint: end-to-end money path in-process against DATABASE_URL, with REAL test wallets.
 *
 *   1. A scripted report at the centre of the live demo zone (DEMO_ZONE_CENTER), signed by the LIVE_REPORTER key,
 *      with a synthetic photo, through the real pipeline (signature, zone, caps, dHash, prior, AI, score, reward).
 *      This is a server-side script, not a phone: it does not pretend to be a GPS fix, and the README says so.
 *   2. If auto_ok: the NWC_LIVE_REPORTER wallet makes an invoice for the claimable amount, and the funder wallet
 *      (SPONSOR_NWC_URL) pays it through @sats/payouts claim() (same code path as POST /api/claim).
 *   3. Prints the live-reporter balance before and after. Never prints secrets.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { loadEnvLocal, ENV_LOCAL, withTimeout } from "./_env";
import { createWallet } from "../packages/lightning/src/index";
import { claim, claimableSats } from "../packages/payouts/src/index";
import { setLogSink } from "../packages/core/src/log";
import { createScriptDb } from "../apps/web/lib/db";
import { parseCenter } from "../apps/web/lib/geo/seed";
import { checkPhotoWithAi } from "../apps/web/lib/reports/ai";
import { submitReport } from "../apps/web/lib/reports/pipeline";
import { makeJpeg, signedReport } from "../apps/web/lib/reports/testkit";
import { getSponsor } from "../apps/web/lib/sponsor";

loadEnvLocal();
setLogSink(() => {});
const url = process.env.DATABASE_URL;
const center = parseCenter(process.env.DEMO_ZONE_CENTER);
const liveNwc = process.env.NWC_LIVE_REPORTER;
if (!url) throw new Error("DATABASE_URL is not set");
if (!center) throw new Error("DEMO_ZONE_CENTER is not set (lat,lon)");
if (!liveNwc) throw new Error("NWC_LIVE_REPORTER is not set (HUMAN TODO: the live reporter's test wallet)");

let hex = process.env.LIVE_REPORTER_NSEC;
if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
  hex = randomBytes(32).toString("hex");
  appendFileSync(ENV_LOCAL, `\n# Live reporter Nostr key (pnpm checkpoint). Local only, never commit.\nLIVE_REPORTER_NSEC=${hex}\n`);
  console.log("✓ created LIVE_REPORTER_NSEC in .env.local");
}
const sk = new Uint8Array(Buffer.from(hex, "hex"));

const live = createWallet(liveNwc);
const before = await withTimeout(live.balanceSats(), 30_000, "live-reporter balance");
console.log(`live-reporter balance before: ${before} sats`);

const { db, end } = await createScriptDb(url);
// ~120 m from the centre, inside the 2 km zone; random direction so repeated runs land in different geohash7 cells.
const a = Math.random() * 2 * Math.PI;
const lat = Number((center.lat + 0.0011 * Math.cos(a)).toFixed(6));
const lon = Number((center.lon + 0.0011 * Math.sin(a)).toFixed(6));
const s = await signedReport({ sk, lat, lon, depth: "knee", accuracyM: 9, photo: await makeJpeg(Math.floor(Math.random() * 1e9)) });
const r = await submitReport(db, s, { checkPhoto: checkPhotoWithAi });
console.log(`report → ${r.status}${r.status === "rejected" ? ` (${r.code})` : ""}${"rewardSats" in r && r.rewardSats ? ` +${r.rewardSats} sats` : ""}`);

const pubkey = s.event.pubkey;
const owed = await claimableSats(db, pubkey);
console.log(`claimable for live-reporter: ${owed} sats`);
if (owed > 0) {
  const inv = await withTimeout(live.makeInvoice({ sats: owed, memo: "NdoxWatch checkpoint reward", expirySec: 600 }), 30_000, "invoice");
  const sponsor = await getSponsor();
  const c = await claim(db, sponsor.wallet, { pubkey, bolt11: inv.bolt11, limits: sponsor.limits });
  console.log(`claim → ${c.status}${"code" in c && c.code ? ` (${c.code})` : ""}`);
  await new Promise((res) => setTimeout(res, 3000));
  const after = await withTimeout(live.balanceSats(), 30_000, "live-reporter balance");
  console.log(`live-reporter balance after: ${after} sats (Δ ${after - before})`);
  sponsor.wallet.close();
}
live.close();
await end();
process.exit(0);

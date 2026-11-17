/**
 * Attack suite (BUILD_ORDER Phase 3): each case runs the REAL pipeline / claim code against an in-process
 * PostGIS and records expected vs actual. `pnpm attack` writes eval/ATTACKS.md; attacks.test.ts asserts it.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { signWithKey } from "@sats/nostr";
import { createFakeWallet } from "@sats/lightning/fake";
import { makeTestInvoice } from "@sats/lightning/testInvoice";
import { accrue, claim, type ClaimLimits } from "@sats/payouts";
import type { Db } from "./db";
import { claimEventInput, verifyClaimEvent } from "./claims";
import { upsertCircleZone, upsertMask, upsertZone } from "./geo/seed";
import { submitReport, type PipelineDeps } from "./reports/pipeline";
import type { AiPhotoCheck } from "./reports/score";
import { makeJpeg, newReporter, signedReport } from "./reports/testkit";

export type AttackRow = { attack: string; expected: string; actual: string; pass: boolean };

const DEMO = { lat: 7.25, lon: 5.2 };
const ZONE = { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.2, 14.68], [-17.2, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] };
const MASK = { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.27, 14.68], [-17.27, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] };
const GOOD_AI: AiPhotoCheck = { water_visible: true, est_depth: "knee", outdoor: true, screen_or_print: false, confidence: 0.9, flags: ["none"] };
const hash = () => randomBytes(32).toString("hex");

export async function runAttacks(db: Db): Promise<AttackRow[]> {
  let ai: AiPhotoCheck | null = GOOD_AI;
  const deps: PipelineDeps = { checkPhoto: async () => ai };
  let seed = 9000;
  const photo = () => makeJpeg(seed++);
  await upsertCircleZone(db, { id: "atk-demo", name: "Attack demo zone", rewardSats: 100, isDemo: true, ...DEMO, radiusM: 2000 });
  await upsertZone(db, { id: "atk-masked", name: "Attack masked zone", rewardSats: 100, geometry: ZONE });
  await upsertMask(db, { id: "atk-mask", source: "test", preWindow: "-", postWindow: "-", geometry: MASK });

  const rows: AttackRow[] = [];
  const row = (attack: string, expected: string, actual: string | undefined) =>
    rows.push({ attack, expected, actual: actual ?? "(none)", pass: expected === actual });
  type Signed = Awaited<ReturnType<typeof signedReport>>;
  const submit = async (s: Signed) => {
    const r = await submitReport(db, s, deps);
    return r.status === "rejected" ? r.code : r.label ? `${r.status}:${r.label}` : r.status;
  };
  const at = (dLat: number, dLon: number) => ({ lat: DEMO.lat + dLat, lon: DEMO.lon + dLon });

  // Baseline
  const img = await photo();
  row("Honest report in the demo zone (baseline)", "auto_ok", await submit(await signedReport({ sk: newReporter(), ...DEMO, photo: img })));

  // Photo reuse
  row("Same photo again, another key", "DUPLICATE", await submit(await signedReport({ sk: newReporter(), ...at(0.004, 0), photo: img })));
  const reenc = await sharp(img).resize(240).jpeg({ quality: 45 }).toBuffer();
  row("Same photo re-encoded + resized", "DUPLICATE", await submit(await signedReport({ sk: newReporter(), ...at(-0.004, 0), photo: reenc })));

  // Location
  row("Report from outside every zone", "OUTSIDE_ZONE", await submit(await signedReport({ sk: newReporter(), lat: 6.5, lon: 3.4, photo: await photo() })));

  // Caps
  const sk = newReporter();
  for (let i = 0; i < 3; i++) await submit(await signedReport({ sk, ...at(0.003 * (i + 1), 0.003), photo: await photo() }));
  row("4th paid report by one key in one zone today", "CAP", await submit(await signedReport({ sk, ...at(-0.008, 0), photo: await photo() })));
  const sk2 = newReporter();
  await submit(await signedReport({ sk: sk2, ...at(0.01, -0.01), photo: await photo() }));
  row("Same key, same street (geohash7) within 60 min", "CAP", await submit(await signedReport({ sk: sk2, ...at(0.0101, -0.01), photo: await photo() })));

  // Event integrity
  const s = await signedReport({ sk: newReporter(), ...at(-0.012, 0), photo: await photo() });
  const firstSend = await submit(s);
  row("Replayed event (same signed report twice)", "auto_ok → REPLAY", `${firstSend} → ${await submit(s)}`);
  const t = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo(), depth: "ankle" });
  const tampered: Signed = { ...t, fields: { ...t.fields, event: JSON.stringify({ ...t.event, content: t.event.content.replace("ankle", "impassable") }) } };
  row("Tampered signature (depth edited after signing)", "BAD_SIGNATURE", await submit(tampered));
  row("Photo swapped after signing (hash mismatch)", "PHOTO_MISMATCH", await submit({ ...t, photo: { bytes: new Uint8Array(await photo()), mime: "image/jpeg" } }));
  row("Location moved after signing (loc_commit mismatch)", "LOC_MISMATCH", await submit({ ...t, fields: { ...t.fields, lon: String(DEMO.lon + 0.002) } }));
  const old = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo(), createdAt: Math.floor(Date.now() / 1000) - 7 * 3600 });
  row("Event signed 7 h ago (outside the offline window)", "TIME_WINDOW", await submit(old));

  // AI verdicts (injected)
  ai = { ...GOOD_AI, screen_or_print: true };
  row("Photo of a screen / printout (AI flags it)", "SCREEN_OR_PRINT", await submit(await signedReport({ sk: newReporter(), ...at(0, 0.012), photo: await photo() })));
  ai = { ...GOOD_AI, water_visible: false, est_depth: "none", confidence: 0.95 };
  row("Dry street photo (AI: no water, confident)", "NO_WATER", await submit(await signedReport({ sk: newReporter(), ...at(0, -0.012), photo: await photo() })));
  ai = null;
  row("AI unavailable", "review", await submit(await signedReport({ sk: newReporter(), ...at(0.014, 0), photo: await photo() })));
  ai = GOOD_AI;
  row("Water outside the satellite mask", "review:SATELLITE_MISSED", await submit(await signedReport({ sk: newReporter(), lat: 14.72, lon: -17.22, photo: await photo() })));

  // Claims
  const csk = newReporter();
  const cpub = signWithKey(claimEventInput("lnbc1xxxxxxxxxxxxxxxx"), csk).pubkey;
  await accrue(db, { pubkey: cpub, sats: 100, sourceId: "atk:claim", reason: "test" });
  const limits: ClaimLimits = { maxClaimSats: 1000, maxDailySats: 1_000_000, network: "bitcoin" };
  const wallet = createFakeWallet();
  const code = (r: Awaited<ReturnType<typeof claim>>) => (r.status === "rejected" ? r.code : r.status);
  row("Invoice amount > claimable", "OVER_CLAIM", code(await claim(db, wallet, { pubkey: cpub, bolt11: makeTestInvoice({ sats: 150, paymentHash: hash() }), limits })));
  const thief = signWithKey(claimEventInput(makeTestInvoice({ sats: 100, paymentHash: hash() })), newReporter());
  const forged = verifyClaimEvent({ ...thief, pubkey: cpub });
  row("Claim another reporter's rewards (pubkey swapped)", "BAD_SIGNATURE", forged.ok ? "accepted" : forged.code);
  wallet.payBehavior = "quota";
  row("Claim when the funder's NWC budget is used up", "BUDGET_REACHED", code(await claim(db, wallet, { pubkey: cpub, bolt11: makeTestInvoice({ sats: 100, paymentHash: hash() }), limits })));
  wallet.payBehavior = "ok";
  row("Claim over MAX_DAILY_PAYOUT_SATS", "DAILY_CAP", code(await claim(db, wallet, { pubkey: cpub, bolt11: makeTestInvoice({ sats: 100, paymentHash: hash() }), limits: { ...limits, maxDailySats: 50 } })));
  const bolt = makeTestInvoice({ sats: 100, paymentHash: hash() });
  const first = code(await claim(db, wallet, { pubkey: cpub, bolt11: bolt, limits }));
  row("Same invoice claimed twice", "paid → DUPLICATE_INVOICE", `${first} → ${code(await claim(db, wallet, { pubkey: cpub, bolt11: bolt, limits }))}`);
  return rows;
}

export function attacksMarkdown(rows: AttackRow[], when = new Date()): string {
  const ok = rows.filter((r) => r.pass).length;
  return [
    "# NdoxWatch attack results",
    "",
    `Generated by \`pnpm attack\` on ${when.toISOString()}. Each row runs the real verification pipeline and claim code`,
    "against an in-process PostGIS. The AI verdict is injected per case (no model call), so these rows test the rules;",
    "eval/RESULTS.md measures the model itself.",
    "",
    `**${ok}/${rows.length} as expected.**`,
    "",
    "| Attack | Expected | Actual | |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.attack} | \`${r.expected}\` | \`${r.actual}\` | ${r.pass ? "✅" : "❌"} |`),
    "",
    "Limits: GPS spoofing is reduced (zone, time window, caps, duplicates, AI, review), not prevented.",
    "The worst-case loss is bounded by the funder's NWC budget and MAX_DAILY_PAYOUT_SATS.",
    "",
  ].join("\n");
}

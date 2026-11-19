/**
 * pnpm personas [--placeholder] [--force]
 *
 * Synthetic seed reports in the Rufisque replay zone, run through the REAL pipeline (signature, zone, caps,
 * dHash, satellite prior, AI, score, reward). Clearly synthetic: the README says so.
 *  - Photos: seed/photos/*.jpg (HUMAN TODO: ~10–20 of your own photos of standing water / gutters / dry streets,
 *    no faces). Each photo is used once (reusing one would be a DUPLICATE, as it should be).
 *    --from-eval: use the original water_*.jpg photos from eval/photos (Wikimedia Commons stock, see CREDITS.md),
 *    with the depth from their label. Stock photos, not field reports: the README says so.
 *    --placeholder: generate abstract images instead (only meaningful with AI_MOCK=1).
 *  - Keys: persona1–3 keys live in .env.local (PERSONA1_NSEC…), created on first run; their wallets
 *    (HUMAN TODO) can then claim. Extra photos go to one-off "crowd" keys (1 report each).
 *  - Idempotent-ish: skips when the zone already has ≥ 20 non-rejected reports, unless --force.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadEnvLocal, ENV_LOCAL } from "./_env";
import { createScriptDb } from "../apps/web/lib/db";
import { activeReportCount, samplePoints } from "../apps/web/lib/geo/seed";
import { checkPhotoWithAi } from "../apps/web/lib/reports/ai";
import { reencodeJpeg, submitReport } from "../apps/web/lib/reports/pipeline";
import { makeJpeg, signedReport } from "../apps/web/lib/reports/testkit";
import type { Depth } from "../apps/web/lib/depths";

loadEnvLocal();
const args = new Set(process.argv.slice(2));
const ZONE = "dakar-rufisque-2026-10";
const TARGET = 20;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// --- photos
const PHOTO_DIR = join(process.cwd(), "seed", "photos");
const files = existsSync(PHOTO_DIR) ? readdirSync(PHOTO_DIR).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort() : [];
let photos: Buffer[];
let photoDepths: Depth[] | null = null;
const EVAL_DIR = join(process.cwd(), "eval", "photos");
if (files.length > 0) {
  photos = await Promise.all(files.map((f) => reencodeJpeg(readFileSync(join(PHOTO_DIR, f)))));
} else if (args.has("--from-eval") && existsSync(join(EVAL_DIR, "labels.json"))) {
  // Originals only (dark_/blurry_ variants are derived from these and would be DUPLICATEs, correctly).
  const labels = JSON.parse(readFileSync(join(EVAL_DIR, "labels.json"), "utf8")) as Array<{ file: string; water_visible: boolean; depth: string }>;
  const wet = labels.filter((l) => /^water_\d+\.jpg$/.test(l.file) && l.water_visible && l.depth !== "none");
  photos = await Promise.all(wet.map((l) => reencodeJpeg(readFileSync(join(EVAL_DIR, l.file)))));
  photoDepths = wet.map((l) => l.depth as Depth);
} else if (args.has("--placeholder")) {
  if (process.env.AI_MOCK !== "1") console.warn("! --placeholder images are abstract patterns; a real AI check will reject them. Use AI_MOCK=1.");
  photos = await Promise.all(Array.from({ length: TARGET }, (_, i) => makeJpeg(70_000 + i)));
} else {
  console.log(`
===== HUMAN TODO =====
Put ~10–20 of your own photos in seed/photos/ (standing water at ankle/knee depth, gutters, a couple of
dry streets; no faces, no plates), then run: pnpm personas
(or use the labelled stock photos: pnpm personas --from-eval;
 or abstract placeholder images: AI_MOCK=1 pnpm personas --placeholder)
======================`);
  process.exit(0);
}

// --- keys
const personaKeys: Uint8Array[] = [];
for (let i = 1; i <= 3; i++) {
  const name = `PERSONA${i}_NSEC`;
  let hex = process.env[name];
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
    hex = randomBytes(32).toString("hex");
    appendFileSync(ENV_LOCAL, `\n# Demo persona ${i} Nostr key (claims its rewards). Local only, never commit.\n${name}=${hex}\n`);
    console.log(`✓ created ${name} in .env.local`);
  }
  personaKeys.push(new Uint8Array(Buffer.from(hex, "hex")));
}

const { db, end } = await createScriptDb(url);
const existing = await activeReportCount(db, ZONE);
if (existing >= TARGET && !args.has("--force")) {
  console.log(`✓ personas: zone already has ${existing} reports, skipping (use --force to add more)`);
  await end();
  process.exit(0);
}

const points = await samplePoints(db, ZONE, photos.length, 0.6);
if (points.length < photos.length) throw new Error(`zone ${ZONE} not found or empty: run pnpm seed first`);

const DEPTHS: Depth[] = ["ankle", "knee", "knee", "knee", "waist", "waist", "impassable"];
const now = Math.floor(Date.now() / 1000);
const tally: Record<string, number> = {};
for (let i = 0; i < photos.length; i++) {
  // persona1–3 take 3 reports each (the per-key daily cap), then one-off crowd keys.
  const sk = i < 9 ? personaKeys[i % 3]! : new Uint8Array(randomBytes(32));
  const s = await signedReport({
    sk,
    ...points[i]!,
    photo: photos[i]!,
    depth: photoDepths?.[i] ?? DEPTHS[i % DEPTHS.length]!,
    accuracyM: 8 + (i % 5) * 9,
    createdAt: now - 600 - Math.floor(Math.random() * 4 * 3600), // spread over the last ~4 h
  });
  const r = await submitReport(db, s, { checkPhoto: checkPhotoWithAi });
  const key = r.status === "rejected" ? `rejected:${r.code}` : r.label ? `${r.status}:${r.label}` : r.status;
  tally[key] = (tally[key] ?? 0) + 1;
}
console.log(`✓ personas: ${photos.length} synthetic reports →`, tally);
await end();
process.exit(0);

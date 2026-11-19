/**
 * pnpm eval → eval/RESULTS.md: measures the AI photo check on your own labelled photos.
 *
 *   eval/photos/*.jpg          (HUMAN TODO: ~30 photos: water at ankle/knee depth, dry streets, a photo of a screen
 *                               showing a flood, a printout, a dark/blurry shot; no faces)
 *   eval/labels.json            [{ "file": "a.jpg", "water_visible": true, "depth": "knee", "screen_or_print": false }, …]
 *                               depth: none | ankle | knee | waist | impassable
 *
 * Needs GEMINI_API_KEY and AI_MOCK=0 (mock fixtures would measure nothing). Photos are downscaled exactly like the
 * phone does (≤1024 px JPEG) before the call. Optional: EVAL_USD_PER_CALL=<price> to estimate cost per report
 * (check current Gemini Flash-Lite pricing in AI Studio; we don't hard-code a price).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadEnvLocal } from "./_env";
import { checkPhotoWithAi } from "../apps/web/lib/reports/ai";
import { aiTokenUsage } from "../packages/ai/src/index";
import { serverEnv } from "../packages/core/src/env";
import { depthConsistent } from "../apps/web/lib/reports/score";
import { reencodeJpeg } from "../apps/web/lib/reports/pipeline";

loadEnvLocal();
const DIR = join(process.cwd(), "eval");
// eval/labels.json, or eval/photos/labels.json (committed next to the photos and CREDITS.md).
const labelsPath = [join(DIR, "labels.json"), join(DIR, "photos", "labels.json")].find((p) => existsSync(p)) ?? join(DIR, "labels.json");
const labelSchema = z.array(
  z.object({
    file: z.string().regex(/^[\w.-]+$/),
    water_visible: z.boolean(),
    depth: z.enum(["none", "ankle", "knee", "waist", "impassable"]),
    screen_or_print: z.boolean().default(false),
  }),
);

if (!existsSync(labelsPath)) {
  console.log(`
===== HUMAN TODO =====
1. Put ~30 of your own photos in eval/photos/ (water at ankle/knee depth, dry streets, a phone/TV screen showing
   a flood, a printout, a dark or blurry shot; no faces).
2. Copy eval/labels.example.json to eval/labels.json and label every photo.
3. Set GEMINI_API_KEY in .env.local (AI_MOCK=0), then run: pnpm eval
======================`);
  process.exit(0);
}
// EVAL_ALLOW_MOCK=1: smoke-test this script with fixtures; writes eval/RESULTS.mock.md, never RESULTS.md.
const MOCK = process.env.AI_MOCK === "1";
if (MOCK && process.env.EVAL_ALLOW_MOCK !== "1") throw new Error("pnpm eval measures the real model: set AI_MOCK=0 and GEMINI_API_KEY");

const labels = labelSchema.parse(JSON.parse(readFileSync(labelsPath, "utf8")));
type Row = (typeof labels)[number] & { ok: boolean; pred?: Awaited<ReturnType<typeof checkPhotoWithAi>>; ms: number };
const rows: Row[] = [];
for (const l of labels) {
  const jpeg = await reencodeJpeg(readFileSync(join(DIR, "photos", l.file)));
  const t0 = Date.now();
  const pred = await checkPhotoWithAi(jpeg);
  rows.push({ ...l, ok: pred !== null, pred, ms: Date.now() - t0 });
  process.stdout.write(pred ? "." : "x");
}
console.log();

const done = rows.filter((r) => r.pred);
const tp = done.filter((r) => r.water_visible && r.pred!.water_visible).length;
const fp = done.filter((r) => !r.water_visible && r.pred!.water_visible).length;
const fn = done.filter((r) => r.water_visible && !r.pred!.water_visible).length;
const wet = done.filter((r) => r.water_visible && r.depth !== "none");
const depthAgree = wet.filter((r) => r.depth !== "none" && depthConsistent(r.depth, r.pred!.est_depth)).length;
const depthExact = wet.filter((r) => r.pred!.est_depth === r.depth).length;
const screens = done.filter((r) => r.screen_or_print);
const screensCaught = screens.filter((r) => r.pred!.screen_or_print).length;
const realFlagged = done.filter((r) => !r.screen_or_print && r.pred!.screen_or_print).length;
const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? 0;
const ratio = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}% (${a}/${b})` : "n/a");
const price = Number(process.env.EVAL_USD_PER_CALL);
// Cost from measured tokens × list price (USD per 1M tokens). Override with EVAL_USD_IN_PER_MTOK / EVAL_USD_OUT_PER_MTOK.
const tok = aiTokenUsage();
const inRate = Number(process.env.EVAL_USD_IN_PER_MTOK ?? 0.3);
const outRate = Number(process.env.EVAL_USD_OUT_PER_MTOK ?? 2.5);
const perCallUsd = tok.calls ? (tok.input * inRate + tok.output * outRate) / 1e6 / rows.length : NaN;
const costCell =
  Number.isFinite(price) && price > 0
    ? `$${price.toFixed(5)} (EVAL_USD_PER_CALL)`
    : Number.isFinite(perCallUsd)
      ? `$${perCallUsd.toFixed(6)} (≈ $${(perCallUsd * 1000).toFixed(3)} per 1,000 reports): ${Math.round(tok.input / rows.length)} input + ${Math.round(tok.output / rows.length)} output tokens per report (measured, incl. retries) at $${inRate} / $${outRate} per 1M tokens (Gemini API standard price for gemini-3.5-flash-lite, ai.google.dev/gemini-api/docs/pricing, Nov 2026)`
      : "set EVAL_USD_PER_CALL from current pricing";
const model = MOCK ? "mock fixtures" : serverEnv().GEMINI_MODEL;

const md = [
  MOCK ? "# MOCK RUN (AI_MOCK fixtures): these numbers measure nothing" : "# NdoxWatch AI photo check: eval results",
  "",
  `Generated by \`pnpm eval\` on ${new Date().toISOString()} with model \`${model}\`, ${rows.length} labelled photos (stock images from Wikimedia Commons, see eval/photos/CREDITS.md; depth labels are Claude's visual judgement, not measured ground truth).`,
  "Photos are downscaled to ≤1024 px JPEG first, as on the phone. AI proposes; the scoring rules decide (see README).",
  "",
  "| Metric | Result |",
  "|---|---|",
  `| AI call success | ${ratio(done.length, rows.length)} |`,
  `| water_visible precision | ${ratio(tp, tp + fp)} |`,
  `| water_visible recall | ${ratio(tp, tp + fn)} |`,
  `| Depth within one class (photos with water) | ${ratio(depthAgree, wet.length)} |`,
  `| Depth exact | ${ratio(depthExact, wet.length)} |`,
  `| screen_or_print caught | ${ratio(screensCaught, screens.length)} |`,
  `| Real scenes wrongly flagged as screen/print | ${ratio(realFlagged, done.length - screens.length)} |`,
  `| Latency p50 / p95 | ${pct(50)} ms / ${pct(95)} ms |`,
  `| Estimated cost per report | ${costCell} |`,
  "",
  "## Per photo",
  "",
  "| File | Label (water / depth / screen) | AI (water / depth / screen / conf) | ms |",
  "|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.file} | ${r.water_visible ? "yes" : "no"} / ${r.depth} / ${r.screen_or_print ? "yes" : "no"} | ${
        r.pred ? `${r.pred.water_visible ? "yes" : "no"} / ${r.pred.est_depth} / ${r.pred.screen_or_print ? "yes" : "no"} / ${r.pred.confidence}` : "call failed → review"
      } | ${r.ms} |`,
  ),
  "",
].join("\n");
mkdirSync(DIR, { recursive: true });
const out = MOCK ? "RESULTS.mock.md" : "RESULTS.md";
writeFileSync(join(DIR, out), md);
console.log(`→ eval/${out}`);
process.exit(0);

/**
 * pnpm seed: idempotent demo data. `pnpm demo` runs it on every start.
 *  - migrate
 *  - seed/zones.geojson → zones (one feature per zone; properties id, name, reward_sats, starts_at, ends_at)
 *  - seed/flood_mask_*.geojson → flood_mask (one row per file; optional <file>.meta.json with source/pre_window/post_window).
 *    The placeholder mask is used only until a real GEE export is present.
 *  - DEMO_ZONE_CENTER=lat,lon → "Live demo zone" (2 km). Never a faked location: no value, no demo zone.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./_env";
import { createScriptDb, migrateNdox } from "../apps/web/lib/db";
import { deletePlaceholderMasks, geometryOf, parseCenter, upsertCircleZone, upsertMask, upsertZone } from "../apps/web/lib/geo/seed";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
const { db, end } = await createScriptDb(url);
const SEED = resolve(process.cwd(), "seed");
const readJson = (f: string) => JSON.parse(readFileSync(resolve(SEED, f), "utf8"));

await migrateNdox(db);

type ZoneProps = { id: string; name: string; reward_sats: number; starts_at?: string; ends_at?: string; active?: boolean };
const zones = readJson("zones.geojson") as { features: Array<{ properties: ZoneProps; geometry: unknown }> };
for (const f of zones.features) {
  const p = f.properties;
  await upsertZone(db, {
    id: p.id,
    name: p.name,
    rewardSats: p.reward_sats,
    active: p.active ?? true,
    startsAt: p.starts_at ? new Date(p.starts_at) : null,
    endsAt: p.ends_at ? new Date(p.ends_at) : null,
    geometry: f.geometry,
  });
}
console.log(`✓ seed: ${zones.features.length} zone(s) from seed/zones.geojson`);

const maskFiles = readdirSync(SEED).filter((f) => /^flood_mask_.+\.geojson$/.test(f));
const real = maskFiles.filter((f) => f !== "flood_mask_placeholder.geojson");
const use = real.length > 0 ? real : maskFiles;
if (real.length > 0) await deletePlaceholderMasks(db);
for (const f of use) {
  const metaFile = f.replace(/\.geojson$/, ".meta.json");
  const meta = existsSync(resolve(SEED, metaFile))
    ? (readJson(metaFile) as { source: string; pre_window: string; post_window: string })
    : { source: "Sentinel-1 GRD change detection (GEE)", pre_window: "see seed/MASK_METADATA.md", post_window: "see seed/MASK_METADATA.md" };
  await upsertMask(db, {
    id: f.replace(/\.geojson$/, ""),
    source: meta.source,
    preWindow: meta.pre_window,
    postWindow: meta.post_window,
    geometry: geometryOf(readJson(f)),
  });
  console.log(`✓ seed: mask ${f} (source: ${meta.source})`);
}
if (real.length === 0) {
  console.log(`
===== HUMAN TODO =====
Flood mask is a PLACEHOLDER. Follow GEE_FLOOD_MASK.md, then put flood_mask_dakar_2026_10.geojson in seed/
(optionally flood_mask_dakar_2026_10.meta.json: {"source":"Sentinel-1 GRD (GEE)","pre_window":"YYYY-MM-DD/YYYY-MM-DD","post_window":"..."})
and run: pnpm seed
======================`);
}

const center = parseCenter(process.env.DEMO_ZONE_CENTER);
if (center) {
  await upsertCircleZone(db, { id: "live-demo", name: "Live demo zone", rewardSats: 100, isDemo: true, radiusM: 2000, ...center });
  console.log("✓ seed: live demo zone (2 km) from DEMO_ZONE_CENTER");
} else {
  console.log(`
===== HUMAN TODO =====
Set DEMO_ZONE_CENTER=lat,lon in .env.local to the presenter's real location (e.g. read it from your phone's map app
where you'll demo in Akure), then run: pnpm seed
Without it there is no live demo zone, and live reports are rejected OUTSIDE_ZONE.
======================`);
}
await end();
process.exit(0);

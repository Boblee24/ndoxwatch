import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { setLogSink } from "@sats/core/log";
import { claimableSats } from "@sats/payouts";
import { migrateNdox, q, type Db } from "../db";
import { upsertCircleZone, upsertMask, upsertZone } from "../geo/seed";
import { submitReport, type PipelineDeps } from "./pipeline";
import type { AiPhotoCheck } from "./score";
import { makeJpeg, newReporter, signedReport } from "./testkit";

// Akure-like demo zone (no mask) and a Rufisque-like replay zone with a mask over its west half.
const DEMO = { lat: 7.25, lon: 5.2 };
const RUF_ZONE = { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.2, 14.68], [-17.2, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] };
const RUF_MASK = { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.27, 14.68], [-17.27, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] };
const IN_MASK = { lat: 14.72, lon: -17.3 };
const OUT_MASK = { lat: 14.72, lon: -17.22 };

const goodAi: AiPhotoCheck = { water_visible: true, est_depth: "knee", outdoor: true, screen_or_print: false, confidence: 0.9, flags: ["none"] };
let aiResult: AiPhotoCheck | null = goodAi;
const deps: PipelineDeps = { checkPhoto: async () => aiResult };

let pg: PGlite;
let db: Db;
let seed = 100;
const photo = () => makeJpeg(seed++);
// PGlite + PostGIS is slow under a parallel full-suite run; each test does several sharp + SQL round trips.
vi.setConfig({ testTimeout: 30_000 });
const restoreLog = setLogSink(() => {});

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { postgis } });
  db = drizzle(pg) as unknown as Db;
  await migrateNdox(db);
  await migrateNdox(db); // idempotent
}, 120_000);
afterAll(async () => {
  restoreLog();
  await pg.close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE report_photos, reports, zones, flood_mask, rewards, claims CASCADE`);
  await upsertCircleZone(db, { id: "demo", name: "Live demo zone", rewardSats: 100, isDemo: true, ...DEMO, radiusM: 2000 });
  await upsertZone(db, { id: "rufisque", name: "Rufisque", rewardSats: 100, geometry: RUF_ZONE });
  await upsertMask(db, { id: "m1", source: "placeholder", preWindow: "2026-09-20/2026-10-01", postWindow: "2026-10-04/2026-10-08", geometry: RUF_MASK });
  aiResult = goodAi;
});

describe("Phase 1 checkpoint", () => {
  it("stores a report inside the demo zone (no mask → in_mask null → auto_ok) and accrues the zone reward", async () => {
    const sk = newReporter();
    const s = await signedReport({ sk, ...DEMO, photo: await photo() });
    const r = await submitReport(db, s, deps);
    expect(r).toMatchObject({ status: "auto_ok", zoneId: "demo", score: 5, max: 5, rewardSats: 100 });
    expect(r.checks).toMatchObject({ signature: true, zone: true, cap: true, new_photo: true, in_mask: null });
    const [row] = await q<{ status: string; geohash5: string; photos: number }>(
      db,
      sql`SELECT status, geohash5, (SELECT count(*)::int FROM report_photos) AS photos FROM reports`,
    );
    expect(row).toMatchObject({ status: "auto_ok", photos: 1 });
    expect(await claimableSats(db, s.event.pubkey)).toBe(100);
  });

  it("rejects a report outside every zone with OUTSIDE_ZONE and stores nothing", async () => {
    const s = await signedReport({ sk: newReporter(), lat: 6.5, lon: 3.4, photo: await photo() });
    const r = await submitReport(db, s, deps);
    expect(r).toMatchObject({ status: "rejected", code: "OUTSIDE_ZONE" });
    expect(await q(db, sql`SELECT 1 FROM reports`)).toHaveLength(0);
  });

  it("an inactive or expired zone does not count", async () => {
    await db.execute(sql`UPDATE zones SET ends_at = now() - interval '1 day' WHERE id = 'demo'`);
    const r = await submitReport(db, await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() }), deps);
    expect(r.code).toBe("OUTSIDE_ZONE");
  });

  it("a signed zone_id must contain the point", async () => {
    const r = await submitReport(db, await signedReport({ sk: newReporter(), ...DEMO, zoneId: "rufisque", photo: await photo() }), deps);
    expect(r.code).toBe("OUTSIDE_ZONE");
  });
});

describe("step 1: verify", () => {
  it("replay: the same event twice → second is REPLAY", async () => {
    const s = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() });
    expect((await submitReport(db, s, deps)).status).toBe("auto_ok");
    expect(await submitReport(db, s, deps)).toMatchObject({ status: "rejected", code: "REPLAY" });
  });

  it("offline queue: signed 2 h ago is accepted; 7 h ago or 10 min in the future is TIME_WINDOW", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ok = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo(), createdAt: now - 2 * 3600 });
    expect((await submitReport(db, ok, deps)).status).toBe("auto_ok");
    const old = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo(), createdAt: now - 7 * 3600 });
    expect((await submitReport(db, old, deps)).code).toBe("TIME_WINDOW");
    const future = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo(), createdAt: now + 600 });
    expect((await submitReport(db, future, deps)).code).toBe("TIME_WINDOW");
  });

  it("tampering: signature, photo hash, location commit, oversized photo", async () => {
    const s = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() });
    const badSig = { ...s, fields: { ...s.fields, event: JSON.stringify({ ...s.event, content: s.event.content.replace("knee", "waist") }) } };
    expect((await submitReport(db, badSig, deps)).code).toBe("BAD_SIGNATURE");
    const otherPhoto = { ...s, photo: { bytes: new Uint8Array(await photo()), mime: "image/jpeg" } };
    expect((await submitReport(db, otherPhoto, deps)).code).toBe("PHOTO_MISMATCH");
    const moved = { ...s, fields: { ...s.fields, lat: String(DEMO.lat + 0.001) } };
    expect((await submitReport(db, moved, deps)).code).toBe("LOC_MISMATCH");
    const big = { ...s, photo: { bytes: new Uint8Array(401 * 1024), mime: "image/jpeg" } };
    expect((await submitReport(db, big, deps)).code).toBe("BAD_INPUT");
    const badAcc = { ...s, fields: { ...s.fields, accuracy_m: "6000" } };
    expect((await submitReport(db, badAcc, deps)).code).toBe("BAD_INPUT");
    expect(await q(db, sql`SELECT 1 FROM reports`)).toHaveLength(0);
  });
});

describe("steps 3–4: caps and duplicates", () => {
  it("same photo again (even from another key) → DUPLICATE", async () => {
    const img = await photo();
    expect((await submitReport(db, await signedReport({ sk: newReporter(), ...DEMO, photo: img }), deps)).status).toBe("auto_ok");
    const again = await signedReport({ sk: newReporter(), lat: DEMO.lat + 0.005, lon: DEMO.lon, photo: img });
    expect(await submitReport(db, again, deps)).toMatchObject({ status: "rejected", code: "DUPLICATE" });
  });

  it("same key, same geohash7 within 60 min → CAP", async () => {
    const sk = newReporter();
    expect((await submitReport(db, await signedReport({ sk, ...DEMO, photo: await photo() }), deps)).status).toBe("auto_ok");
    const near = await signedReport({ sk, lat: DEMO.lat + 0.0001, lon: DEMO.lon, photo: await photo() });
    expect((await submitReport(db, near, deps)).code).toBe("CAP");
  });

  it("4th paid report per key per zone per day → CAP", async () => {
    const sk = newReporter();
    for (let i = 0; i < 3; i++) {
      const r = await submitReport(db, await signedReport({ sk, lat: DEMO.lat + i * 0.004, lon: DEMO.lon, photo: await photo() }), deps);
      expect(r.status).toBe("auto_ok");
    }
    const r = await submitReport(db, await signedReport({ sk, lat: DEMO.lat - 0.006, lon: DEMO.lon, photo: await photo() }), deps);
    expect(r.code).toBe("CAP");
    expect(await claimableSats(db, (await signedReport({ sk, ...DEMO, photo: await photo() })).event.pubkey)).toBe(300);
  });
});

describe("steps 5–7: satellite prior, AI, score", () => {
  it("inside the mask → in_mask true → auto_ok (6/6)", async () => {
    const r = await submitReport(db, await signedReport({ sk: newReporter(), ...IN_MASK, photo: await photo() }), deps);
    expect(r).toMatchObject({ status: "auto_ok", score: 6, max: 6 });
    expect(r.checks.in_mask).toBe(true);
  });

  it("in a masked zone but outside the mask, with water → review 'Satellite missed?' (not rejected, not paid)", async () => {
    const s = await signedReport({ sk: newReporter(), ...OUT_MASK, photo: await photo() });
    const r = await submitReport(db, s, deps);
    expect(r).toMatchObject({ status: "review", label: "SATELLITE_MISSED" });
    expect(r.checks.in_mask).toBe(false);
    expect(await claimableSats(db, s.event.pubkey)).toBe(0);
  });

  it("AI call throwing → review (never auto-paid)", async () => {
    const throwing: PipelineDeps = { checkPhoto: async () => { throw new Error("api down"); } };
    const s = await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() });
    expect(await submitReport(db, s, throwing)).toMatchObject({ status: "review", score: null });
    expect(await claimableSats(db, s.event.pubkey)).toBe(0);
  });

  it("AI failure → review; screen photo → rejected", async () => {
    aiResult = null;
    expect((await submitReport(db, await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() }), deps)).status).toBe("review");
    aiResult = { ...goodAi, screen_or_print: true };
    expect(await submitReport(db, await signedReport({ sk: newReporter(), ...DEMO, photo: await photo() }), deps)).toMatchObject({
      status: "rejected",
      code: "SCREEN_OR_PRINT",
    });
  });
});

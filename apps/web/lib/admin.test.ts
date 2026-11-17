import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { setLogSink } from "@sats/core/log";
import { claimableSats } from "@sats/payouts";
import { decideReport, isPaused, listReports, purgeOldPhotos, setPaused, tokenMatches } from "./admin";
import { q, type Db } from "./db";
import { upsertCircleZone, upsertMask, upsertZone } from "./geo/seed";
import { maskGeoJson, publicCells, zonesGeoJson } from "./geo/public";
import { submitReport, type PipelineDeps } from "./reports/pipeline";
import type { AiPhotoCheck } from "./reports/score";
import { makeJpeg, newReporter, signedReport } from "./reports/testkit";
import { createTestDb } from "./testDb";

vi.setConfig({ testTimeout: 30_000 });
const restore = setLogSink(() => {});
let db: Db;
let close: () => Promise<void>;
let ai: AiPhotoCheck | null;
const deps: PipelineDeps = { checkPhoto: async () => ai };
const GOOD: AiPhotoCheck = { water_visible: true, est_depth: "knee", outdoor: true, screen_or_print: false, confidence: 0.9, flags: ["none"] };
let seed = 500;
const DEMO = { lat: 7.25, lon: 5.2 };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 120_000);
afterAll(async () => {
  restore();
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE report_photos, reports, zones, flood_mask, rewards, claims, app_settings CASCADE`);
  await upsertCircleZone(db, { id: "demo", name: "Live demo zone", rewardSats: 100, isDemo: true, ...DEMO, radiusM: 2000 });
  await upsertZone(db, {
    id: "ruf",
    name: "Rufisque",
    rewardSats: 120,
    geometry: { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.2, 14.68], [-17.2, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] },
  });
  await upsertMask(db, {
    id: "m",
    source: "placeholder",
    preWindow: "a",
    postWindow: "b",
    geometry: { type: "Polygon", coordinates: [[[-17.33, 14.68], [-17.27, 14.68], [-17.27, 14.78], [-17.33, 14.78], [-17.33, 14.68]]] },
  });
  ai = GOOD;
});

const report = async (lat: number, lon: number) => {
  const s = await signedReport({ sk: newReporter(), lat, lon, photo: await makeJpeg(seed++) });
  return { s, r: await submitReport(db, s, deps) };
};

describe("tokenMatches", () => {
  it("is exact and rejects missing values", () => {
    expect(tokenMatches("a".repeat(30), "a".repeat(30))).toBe(true);
    expect(tokenMatches("a".repeat(29), "a".repeat(30))).toBe(false);
    expect(tokenMatches(null, "x")).toBe(false);
    expect(tokenMatches("x", undefined)).toBe(false);
  });
});

describe("review decisions", () => {
  it("'Satellite missed?' → approve pays the zone reward once; listed under sat_missed", async () => {
    const { s, r } = await report(14.72, -17.22);
    expect(r).toMatchObject({ status: "review", label: "SATELLITE_MISSED" });
    expect((await listReports(db, "sat_missed")).map((x) => x.id)).toEqual([r.reportId]);
    expect(await decideReport(db, r.reportId!, "approve")).toEqual({ ok: true, status: "auto_ok", rewardSats: 120 });
    expect(await decideReport(db, r.reportId!, "approve")).toEqual({ ok: false, code: "NOT_IN_REVIEW" });
    expect(await claimableSats(db, s.event.pubkey)).toBe(120);
  });

  it("reject deletes the photo and pays nothing", async () => {
    ai = null;
    const { s, r } = await report(DEMO.lat, DEMO.lon);
    expect(r.status).toBe("review");
    expect(await decideReport(db, r.reportId!, "reject")).toEqual({ ok: true, status: "rejected" });
    expect(await q(db, sql`SELECT 1 FROM report_photos`)).toHaveLength(0);
    expect(await claimableSats(db, s.event.pubkey)).toBe(0);
    expect(await decideReport(db, "00000000-0000-4000-8000-000000000000", "approve")).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("photo purge", () => {
  it("deletes photos older than 7 days only", async () => {
    await report(DEMO.lat, DEMO.lon);
    await report(DEMO.lat + 0.005, DEMO.lon);
    await db.execute(sql`UPDATE report_photos SET created_at = now() - interval '8 days' WHERE report_id = (SELECT report_id FROM report_photos LIMIT 1)`);
    expect(await purgeOldPhotos(db)).toBe(1);
    expect(await q(db, sql`SELECT 1 FROM report_photos`)).toHaveLength(1);
  });
});

describe("pause", () => {
  it("toggles", async () => {
    expect(await isPaused(db)).toBe(false);
    await setPaused(db, true);
    expect(await isPaused(db)).toBe(true);
    await setPaused(db, false);
    expect(await isPaused(db)).toBe(false);
  });
});

describe("public data is coarse", () => {
  it("cells: geohash5 only, accepted reports only, max depth", async () => {
    await report(DEMO.lat, DEMO.lon);
    ai = null;
    await report(DEMO.lat + 0.004, DEMO.lon); // review: not public
    const cells = await publicCells(db);
    expect(cells).toHaveLength(1);
    expect(Object.keys(cells[0]!).sort()).toEqual(["count", "geohash5", "max_depth"]);
    expect(cells[0]).toMatchObject({ count: 1, max_depth: "knee" });
    expect(cells[0]!.geohash5).toHaveLength(5);
  });

  it("zones: the demo zone (presenter's location) is never public; mask carries its source", async () => {
    expect((await zonesGeoJson(db, { includeDemo: false })).features.map((f) => f.properties.id)).toEqual(["ruf"]);
    expect((await zonesGeoJson(db, { includeDemo: true })).features).toHaveLength(2);
    expect((await maskGeoJson(db)).features[0]!.properties).toMatchObject({ source: "placeholder", pre_window: "a", post_window: "b" });
  });
});

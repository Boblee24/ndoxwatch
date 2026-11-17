/** Idempotent geo loaders (used by `pnpm seed:geo` and the tests). Raw SQL for every ST_* call. */
import { sql } from "drizzle-orm";
import type { Db } from "../db";

type ZoneMeta = { id: string; name: string; rewardSats: number; active?: boolean; startsAt?: Date | null; endsAt?: Date | null; isDemo?: boolean };

const ON_CONFLICT_ZONE = sql`ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom, reward_sats = EXCLUDED.reward_sats,
  active = EXCLUDED.active, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, is_demo = EXCLUDED.is_demo`;

/** GeoJSON geometry → valid MultiPolygon in 4326. Simplifies (≈ 10 m) only very large inputs. */
const multiFromGeoJson = (geojson: unknown) => sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(
  CASE WHEN ST_NPoints(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})) > 5000
       THEN ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326), 0.0001)
       ELSE ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326) END), 3))`;

export async function upsertZone(db: Db, z: ZoneMeta & { geometry: unknown }): Promise<void> {
  await db.execute(sql`INSERT INTO zones (id, name, geom, reward_sats, active, starts_at, ends_at, is_demo)
    VALUES (${z.id}, ${z.name}, ${multiFromGeoJson(z.geometry)}, ${z.rewardSats}, ${z.active ?? true},
            ${z.startsAt?.toISOString() ?? null}::timestamptz, ${z.endsAt?.toISOString() ?? null}::timestamptz, ${z.isDemo ?? false})
    ${ON_CONFLICT_ZONE}`);
}

/** Circle zone: a geography buffer, so the radius is in metres anywhere on Earth. */
export async function upsertCircleZone(db: Db, z: ZoneMeta & { lat: number; lon: number; radiusM: number }): Promise<void> {
  await db.execute(sql`INSERT INTO zones (id, name, geom, reward_sats, active, starts_at, ends_at, is_demo)
    VALUES (${z.id}, ${z.name},
            ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(${z.lon}, ${z.lat}), 4326)::geography, ${z.radiusM})::geometry),
            ${z.rewardSats}, ${z.active ?? true},
            ${z.startsAt?.toISOString() ?? null}::timestamptz, ${z.endsAt?.toISOString() ?? null}::timestamptz, ${z.isDemo ?? false})
    ${ON_CONFLICT_ZONE}`);
}

export async function upsertMask(db: Db, m: { id: string; source: string; preWindow: string; postWindow: string; geometry: unknown }): Promise<void> {
  await db.execute(sql`INSERT INTO flood_mask (id, source, pre_window, post_window, geom)
    VALUES (${m.id}, ${m.source}, ${m.preWindow}, ${m.postWindow}, ${multiFromGeoJson(m.geometry)})
    ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, pre_window = EXCLUDED.pre_window,
      post_window = EXCLUDED.post_window, geom = EXCLUDED.geom`);
}

/** Merge all features of a FeatureCollection (or a bare geometry) into one geometry for loading. */
export function geometryOf(geojson: unknown): unknown {
  const g = geojson as { type?: string; features?: Array<{ geometry: { type: string; coordinates: unknown } }> };
  if (g?.type !== "FeatureCollection") return (geojson as { geometry?: unknown })?.geometry ?? geojson;
  const polys: unknown[] = [];
  for (const f of g.features ?? []) {
    if (f.geometry?.type === "Polygon") polys.push(f.geometry.coordinates);
    else if (f.geometry?.type === "MultiPolygon") polys.push(...(f.geometry.coordinates as unknown[]));
  }
  return { type: "MultiPolygon", coordinates: polys };
}

/** "lat,lon" → numbers, or null if missing/invalid. Never invent a location. */
export function parseCenter(v: string | undefined): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Random points inside a zone for synthetic personas: `inMaskShare` of them inside the flood mask
 * (where a satellite saw water), the rest anywhere in the zone (some will be "Satellite missed?").
 */
export async function samplePoints(db: Db, zoneId: string, n: number, inMaskShare = 0.6): Promise<Array<{ lat: number; lon: number }>> {
  const k = Math.round(n * inMaskShare);
  const { q } = await import("../db");
  const inMask = k
    ? await q<{ lat: number; lon: number }>(
        db,
        sql`SELECT ST_Y(d.geom) AS lat, ST_X(d.geom) AS lon FROM (
              SELECT (ST_Dump(ST_GeneratePoints(ST_Intersection(z.geom, ST_Union(m.geom)), ${k}))).geom
              FROM zones z, flood_mask m WHERE z.id = ${zoneId} AND ST_Intersects(z.geom, m.geom) GROUP BY z.geom) d`,
      )
    : [];
  const rest = await q<{ lat: number; lon: number }>(
    db,
    sql`SELECT ST_Y(d.geom) AS lat, ST_X(d.geom) AS lon FROM (
          SELECT (ST_Dump(ST_GeneratePoints(geom, ${n - inMask.length}))).geom FROM zones WHERE id = ${zoneId}) d`,
  );
  return [...inMask, ...rest].map((p) => ({ lat: Number(Number(p.lat).toFixed(6)), lon: Number(Number(p.lon).toFixed(6)) }));
}

export async function deletePlaceholderMasks(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM flood_mask WHERE source = 'placeholder'`);
}

export async function activeReportCount(db: Db, zoneId: string): Promise<number> {
  const { q } = await import("../db");
  const [r] = await q<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM reports WHERE zone_id = ${zoneId} AND status <> 'rejected'`);
  return Number(r?.n ?? 0);
}

/**
 * Public geo reads. Only coarse data: geohash5 cells (~5 km) for reports, the satellite mask, and
 * non-demo zone outlines (a demo zone's centre is the presenter's location, so it's never public).
 */
import { sql } from "drizzle-orm";
import { q, type Db } from "../db";

export type Cell = { geohash5: string; count: number; max_depth: "ankle" | "knee" | "waist" | "impassable" };

/** Counts accepted reports only (auto_ok, including approved reviews). */
export async function publicCells(db: Db): Promise<Cell[]> {
  const rows = await q<{ geohash5: string; count: number; max_rank: number }>(
    db,
    sql`SELECT geohash5, count(*)::int AS count,
               max(CASE depth WHEN 'ankle' THEN 1 WHEN 'knee' THEN 2 WHEN 'waist' THEN 3 ELSE 4 END)::int AS max_rank
        FROM reports WHERE status = 'auto_ok' GROUP BY geohash5`,
  );
  const names = ["ankle", "knee", "waist", "impassable"] as const;
  return rows.map((r) => ({ geohash5: r.geohash5, count: Number(r.count), max_depth: names[Number(r.max_rank) - 1] ?? "ankle" }));
}

type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: unknown }> };

export async function maskGeoJson(db: Db): Promise<FC> {
  const rows = await q<{ id: string; source: string; pre_window: string; post_window: string; g: string }>(
    db,
    sql`SELECT id, source, pre_window, post_window, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0002), 5) AS g FROM flood_mask`,
  );
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({ type: "Feature", properties: { id: r.id, source: r.source, pre_window: r.pre_window, post_window: r.post_window }, geometry: JSON.parse(r.g) })),
  };
}

export async function zonesGeoJson(db: Db, o: { includeDemo: boolean }): Promise<FC> {
  const rows = await q<{ id: string; name: string; reward_sats: number; active: boolean; is_demo: boolean; g: string }>(
    db,
    sql`SELECT id, name, reward_sats, active, is_demo, ST_AsGeoJSON(geom, 5) AS g FROM zones
        WHERE active AND (${o.includeDemo} OR NOT is_demo)`,
  );
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({ type: "Feature", properties: { id: r.id, name: r.name, reward_sats: r.reward_sats, is_demo: r.is_demo }, geometry: JSON.parse(r.g) })),
  };
}

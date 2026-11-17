/** Funder console: ADMIN_TOKEN auth (constant time), review decisions, pause, purge, exports. SERVER ONLY. */
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { accrue, spendToday } from "@sats/payouts";
import { q, type Db } from "./db";

/** Compare SHA-256 digests so length differences don't leak through timing either. */
export function tokenMatches(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

// ---- settings ------------------------------------------------------------------------------------
export async function isPaused(db: Db): Promise<boolean> {
  const [r] = await q<{ value: unknown }>(db, sql`SELECT value FROM app_settings WHERE key = 'payouts_paused'`);
  return r?.value === true;
}

export async function setPaused(db: Db, paused: boolean): Promise<void> {
  await db.execute(sql`INSERT INTO app_settings (key, value) VALUES ('payouts_paused', ${JSON.stringify(paused)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
}

// ---- review --------------------------------------------------------------------------------------
export type ReviewOutcome = { ok: true; status: "auto_ok" | "rejected"; rewardSats?: number } | { ok: false; code: "NOT_FOUND" | "NOT_IN_REVIEW" };

/** Approve pays the ZONE's reward (never a client/AI amount); idempotent via accrue's sourceId. */
export async function decideReport(db: Db, id: string, action: "approve" | "reject"): Promise<ReviewOutcome> {
  const [r] = await q<{ status: string; reporter_pubkey: string; reward_sats: number | null }>(
    db,
    sql`SELECT r.status, r.reporter_pubkey, z.reward_sats FROM reports r LEFT JOIN zones z ON z.id = r.zone_id WHERE r.id = ${id}::uuid`,
  );
  if (!r) return { ok: false, code: "NOT_FOUND" };
  if (r.status !== "review") return { ok: false, code: "NOT_IN_REVIEW" };
  if (action === "reject") {
    await db.execute(sql`UPDATE reports SET status = 'rejected', reject_code = 'REVIEW_REJECTED', reviewed_at = now(), review_decision = 'reject'
      WHERE id = ${id}::uuid AND status = 'review'`);
    await db.execute(sql`DELETE FROM report_photos WHERE report_id = ${id}::uuid`);
    return { ok: true, status: "rejected" };
  }
  const updated = await q(db, sql`UPDATE reports SET status = 'auto_ok', reviewed_at = now(), review_decision = 'approve'
    WHERE id = ${id}::uuid AND status = 'review' RETURNING id`);
  if (updated.length === 0) return { ok: false, code: "NOT_IN_REVIEW" };
  const sats = Number(r.reward_sats ?? 0);
  if (sats > 0) await accrue(db, { pubkey: r.reporter_pubkey, sats, sourceId: `report:${id}`, reason: "flood_report_review" });
  return { ok: true, status: "auto_ok", rewardSats: sats };
}

// ---- purge ---------------------------------------------------------------------------------------
export const PHOTO_RETENTION_DAYS = 7;

export async function purgeOldPhotos(db: Db): Promise<number> {
  const rows = await q(db, sql`DELETE FROM report_photos WHERE created_at < now() - make_interval(days => ${PHOTO_RETENTION_DAYS}) RETURNING report_id`);
  return rows.length;
}

// ---- reads ---------------------------------------------------------------------------------------
export type AdminReport = {
  id: string;
  lat: number;
  lon: number;
  accuracy_m: number;
  depth: string;
  status: string;
  reject_code: string | null;
  score: number | null;
  zone_id: string | null;
  created_at: number;
  checks: Record<string, unknown>;
  ai: Record<string, unknown> | null;
  has_photo: boolean;
  satellite_missed: boolean;
  reporter: string;
};

export async function listReports(db: Db, filter: "review" | "sat_missed" | "all", limit = 200): Promise<AdminReport[]> {
  const where =
    filter === "review"
      ? sql`r.status = 'review'`
      : filter === "sat_missed"
        ? sql`(r.checks->>'in_mask') = 'false' AND (r.ai->>'water_visible') = 'true'`
        : sql`true`;
  const rows = await q<AdminReport & { reporter_pubkey: string }>(
    db,
    sql`SELECT r.id, ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon, r.accuracy_m, r.depth, r.status, r.reject_code, r.score, r.zone_id,
               r.created_at::bigint AS created_at, r.checks, r.ai, (p.report_id IS NOT NULL) AS has_photo, r.reporter_pubkey,
               ((r.checks->>'in_mask') = 'false' AND coalesce((r.ai->>'water_visible') = 'true', false)) AS satellite_missed
        FROM reports r LEFT JOIN report_photos p ON p.report_id = r.id
        WHERE ${where}
        ORDER BY r.received_at DESC
        LIMIT ${limit}`,
  );
  return rows.map(({ reporter_pubkey, ...r }) => ({ ...r, created_at: Number(r.created_at), reporter: reporter_pubkey.slice(0, 12) }));
}

export async function photoOf(db: Db, id: string): Promise<Buffer | null> {
  const [r] = await q<{ jpeg: Buffer | Uint8Array }>(db, sql`SELECT jpeg FROM report_photos WHERE report_id = ${id}::uuid`);
  return r ? Buffer.from(r.jpeg) : null;
}

export async function counts(db: Db) {
  const [r] = await q<{ total: number; auto_ok: number; review: number; rejected: number; sat_missed: number }>(
    db,
    sql`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'auto_ok')::int AS auto_ok,
               count(*) FILTER (WHERE status = 'review')::int AS review,
               count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
               count(*) FILTER (WHERE status = 'review' AND (checks->>'in_mask') = 'false' AND (ai->>'water_visible') = 'true')::int AS sat_missed
        FROM reports`,
  );
  return r ?? { total: 0, auto_ok: 0, review: 0, rejected: 0, sat_missed: 0 };
}

export { spendToday };

/**
 * Server verification pipeline (CLAUDE.md "Verification pipeline"), in order:
 * 1 verify → 2 zone → 3 caps → 4 duplicate photo → 5 satellite prior → 6 AI → 7 score → 8 reward.
 * Step 9 (publish) is the caller's job, best-effort, after the response.
 *
 * Storage: step-1 failures and OUTSIDE_ZONE are never stored (no zone, nothing for a funder; and we
 * don't keep precise locations of people outside any zone). Everything else is stored, so the
 * UNIQUE event_id makes a replay fail. Photos are stored only for auto_ok / review.
 */
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { accrue } from "@sats/payouts";
import { log } from "@sats/core/log";
import type { NostrEvent } from "@sats/nostr";
import { q, type Db } from "../db";
import type { ReportStatus } from "../db/schema";
import { dHash, DUPLICATE_MAX_DISTANCE } from "./dhash";
import { scoreReport, type AiPhotoCheck } from "./score";
import { verifyReport, type RejectCode, type VerifiedReport } from "./verify";
import type { CheckPhotoFn } from "./ai";

export const MAX_PAID_PER_DAY = 3;
export const SPACING_SEC = 3600;
export const MASK_TOLERANCE_M = 300;

export type Checks = {
  signature: boolean;
  zone?: boolean;
  cap?: boolean;
  new_photo?: boolean;
  in_mask?: boolean | null;
  ai?: { water_visible: boolean; est_depth: string; confidence: number } | null;
  accuracy_ok?: boolean;
};

export type SubmitResult = {
  status: ReportStatus;
  code?: RejectCode;
  label?: "SATELLITE_MISSED";
  reportId?: string;
  zoneId?: string;
  score?: number | null;
  max?: number;
  rewardSats?: number;
  checks: Checks;
  /** Signed event to publish (geohash5 only), when the report was stored and not rejected. */
  publish?: NostrEvent;
};

export type PipelineDeps = { checkPhoto: CheckPhotoFn; now?: () => number };

const pointSql = (r: Pick<VerifiedReport, "lat" | "lon">) => sql`ST_SetSRID(ST_MakePoint(${r.lon}, ${r.lat}), 4326)`;

/** Server re-encode: proves it's a real image, strips all metadata (EXIF/GPS), caps the size. */
export async function reencodeJpeg(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
}

export async function findZone(db: Db, r: VerifiedReport): Promise<{ id: string; rewardSats: number } | null> {
  const rows = await q<{ id: string; reward_sats: number }>(
    db,
    sql`SELECT id, reward_sats FROM zones
        WHERE active
          AND ST_Contains(geom, ${pointSql(r)})
          AND (starts_at IS NULL OR starts_at <= to_timestamp(${r.createdAt}))
          AND (ends_at IS NULL OR ends_at >= to_timestamp(${r.createdAt}))
          AND (${r.content.zone_id}::text IS NULL OR id = ${r.content.zone_id})
        ORDER BY ST_Area(geom) ASC
        LIMIT 1`,
  );
  const z = rows[0];
  return z ? { id: z.id, rewardSats: Number(z.reward_sats) } : null;
}

/** Step 3. Counts reports that are paid or may still be paid (auto_ok + review). */
export async function capExceeded(db: Db, r: VerifiedReport, zoneId: string): Promise<boolean> {
  const [row] = await q<{ today: number; near: number }>(
    db,
    sql`SELECT
          count(*) FILTER (WHERE received_at >= date_trunc('day', now()))::int AS today,
          count(*) FILTER (WHERE geohash7 = ${r.geohash7} AND abs(created_at - ${r.createdAt}) < ${SPACING_SEC})::int AS near
        FROM reports
        WHERE reporter_pubkey = ${r.pubkey} AND zone_id = ${zoneId} AND status IN ('auto_ok', 'review')`,
  );
  return Number(row?.today ?? 0) >= MAX_PAID_PER_DAY || Number(row?.near ?? 0) > 0;
}

/** Step 4. Any stored photo within Hamming distance ≤ 6. */
export async function isDuplicatePhoto(db: Db, hash: bigint): Promise<boolean> {
  const rows = await q<{ one: number }>(
    db,
    sql`SELECT 1 AS one FROM reports
        WHERE photo_dhash IS NOT NULL
          AND bit_count((photo_dhash # ${hash.toString()}::bigint)::bit(64)) <= ${DUPLICATE_MAX_DISTANCE}
        LIMIT 1`,
  );
  return rows.length > 0;
}

/** Step 5. null = no mask covers this zone (no satellite opinion). Outside the mask is NOT a rejection. */
export async function inMask(db: Db, r: VerifiedReport, zoneId: string): Promise<boolean | null> {
  const [row] = await q<{ covered: boolean; near: boolean }>(
    db,
    sql`SELECT
          EXISTS (SELECT 1 FROM flood_mask m, zones z WHERE z.id = ${zoneId} AND ST_Intersects(m.geom, z.geom)) AS covered,
          EXISTS (SELECT 1 FROM flood_mask m WHERE ST_DWithin(m.geom::geography, ${pointSql(r)}::geography, ${MASK_TOLERANCE_M})) AS near`,
  );
  if (!row?.covered) return null;
  return Boolean(row.near);
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function eventSeen(db: Db, eventId: string, reportId: string): Promise<boolean> {
  const rows = await q(db, sql`SELECT 1 FROM reports WHERE event_id = ${eventId} OR id = ${reportId}::uuid LIMIT 1`);
  return rows.length > 0;
}

export async function submitReport(
  db: Db,
  input: { fields: Record<string, unknown>; photo: { bytes: Uint8Array; mime: string } | null },
  deps: PipelineDeps,
): Promise<SubmitResult> {
  const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);

  // 1. Verify
  const v = verifyReport(input, nowSec);
  if (!v.ok) return { status: "rejected", code: v.code, checks: { signature: v.code !== "BAD_SIGNATURE" } };
  const r = v.report;
  const checks: Checks = { signature: true, accuracy_ok: r.accuracyM <= 50 };
  if (await eventSeen(db, r.event.id, r.reportId)) return { status: "rejected", code: "REPLAY", checks };

  let jpeg: Buffer;
  try {
    jpeg = await reencodeJpeg(input.photo!.bytes);
  } catch {
    return { status: "rejected", code: "BAD_INPUT", checks };
  }

  // 2. Zone
  const zone = await findZone(db, r);
  checks.zone = Boolean(zone);
  if (!zone) return { status: "rejected", code: "OUTSIDE_ZONE", checks };

  const base = { reportId: r.reportId, zoneId: zone.id };
  const store = async (o: {
    status: ReportStatus;
    rejectCode?: RejectCode;
    dhash?: bigint | null;
    ai?: AiPhotoCheck | null;
    score?: number | null;
    withPhoto?: boolean;
  }): Promise<"ok" | "replay"> => {
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        // One writer at a time: caps and duplicates are re-checked under the lock (the AI call ran without it).
        await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ndox:reports'))`);
        let status = o.status;
        let rejectCode = o.rejectCode;
        if (status !== "rejected") {
          if (await capExceeded(t, r, zone.id)) {
            status = "rejected";
            rejectCode = "CAP";
            checks.cap = false;
          } else if (o.dhash != null && (await isDuplicatePhoto(t, o.dhash))) {
            status = "rejected";
            rejectCode = "DUPLICATE";
            checks.new_photo = false;
          }
        }
        o.status = status;
        o.rejectCode = rejectCode;
        await t.execute(sql`
          INSERT INTO reports (id, reporter_pubkey, event_id, event, created_at, geom, accuracy_m, geohash5, geohash7,
                               depth, photo_sha256, photo_dhash, checks, ai, score, status, reject_code, zone_id)
          VALUES (${r.reportId}::uuid, ${r.pubkey}, ${r.event.id}, ${JSON.stringify(r.event)}::jsonb, ${r.createdAt},
                  ${pointSql(r)}, ${r.accuracyM}, ${r.geohash5}, ${r.geohash7}, ${r.depth}, ${r.photoSha256},
                  ${o.dhash == null ? null : o.dhash.toString()}::bigint, ${JSON.stringify(checks)}::jsonb,
                  ${o.ai ? JSON.stringify(o.ai) : null}::jsonb, ${o.score ?? null}, ${status}, ${rejectCode ?? null}, ${zone.id})`);
        if (status !== "rejected" && o.withPhoto) {
          await t.execute(sql`INSERT INTO report_photos (report_id, jpeg) VALUES (${r.reportId}::uuid, ${jpeg})`);
        }
      });
      return "ok";
    } catch (err) {
      if (isUniqueViolation(err)) return "replay";
      throw err;
    }
  };

  // 3. Caps (pre-check, re-checked at insert)
  if (await capExceeded(db, r, zone.id)) {
    checks.cap = false;
    return (await store({ status: "rejected", rejectCode: "CAP" })) === "replay"
      ? { status: "rejected", code: "REPLAY", checks }
      : { status: "rejected", code: "CAP", checks, ...base };
  }
  checks.cap = true;

  // 4. Duplicate photo
  const hash = await dHash(jpeg);
  if (await isDuplicatePhoto(db, hash)) {
    checks.new_photo = false;
    return (await store({ status: "rejected", rejectCode: "DUPLICATE", dhash: hash })) === "replay"
      ? { status: "rejected", code: "REPLAY", checks }
      : { status: "rejected", code: "DUPLICATE", checks, ...base };
  }
  checks.new_photo = true;

  // 5. Satellite prior
  const mask = await inMask(db, r, zone.id);
  checks.in_mask = mask;

  // 6. AI photo check (failure → null → review)
  let ai: AiPhotoCheck | null = null;
  try {
    ai = await deps.checkPhoto(jpeg);
  } catch {
    ai = null;
  }
  checks.ai = ai ? { water_visible: ai.water_visible, est_depth: ai.est_depth, confidence: ai.confidence } : null;

  // 7. Score
  const s = scoreReport({ depth: r.depth, accuracyM: r.accuracyM, inMask: mask, ai });
  const o = { status: s.status, rejectCode: s.rejectCode as RejectCode | undefined, dhash: hash, ai, score: s.score, withPhoto: true };
  if ((await store(o)) === "replay") return { status: "rejected", code: "REPLAY", checks };

  const label = o.status === "review" ? s.label : undefined;
  const result: SubmitResult = { status: o.status, code: o.rejectCode, label, score: s.score, max: s.max, checks, ...base };

  // 8. Reward: amount from the zone only (never the client or the AI). Idempotent on the report id.
  if (o.status === "auto_ok") {
    await accrue(db, { pubkey: r.pubkey, sats: zone.rewardSats, sourceId: `report:${r.reportId}`, reason: "flood_report" });
    result.rewardSats = zone.rewardSats;
  }
  if (o.status !== "rejected") result.publish = r.event;
  log.info("report.submitted", { id: r.reportId, status: o.status, code: o.rejectCode ?? "none" });
  return result;
}

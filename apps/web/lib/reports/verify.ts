/**
 * Pipeline step 1 (pure, no DB): signature, time window, zod, photo hash, loc_commit.
 * The replay defence is UNIQUE reports.event_id (checked on insert), not the time window.
 */
import { createHash } from "node:crypto";
import ngeohash from "ngeohash";
import { z } from "zod";
import { verifyEvent, tagValue, type NostrEvent } from "@sats/nostr";
import { DEPTHS, type Depth } from "../db/schema";

export const REPORT_KIND = 30078;
export const MAX_PHOTO_BYTES = 400 * 1024;
/** Offline queue sends late: accept events signed up to 6 h ago, and up to 5 min in the future (clock skew). */
export const MAX_AGE_SEC = 6 * 3600;
export const MAX_SKEW_SEC = 5 * 60;

export type RejectCode =
  | "BAD_INPUT"
  | "BAD_SIGNATURE"
  | "BAD_EVENT"
  | "TIME_WINDOW"
  | "PHOTO_MISMATCH"
  | "LOC_MISMATCH"
  | "REPLAY"
  | "OUTSIDE_ZONE"
  | "CAP"
  | "DUPLICATE"
  | "SCREEN_OR_PRINT"
  | "NO_WATER"
  | "LOW_SCORE";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Multipart text fields (strings), validated before anything else. */
export const reportFieldsSchema = z.object({
  event: z.string().min(2).max(4000),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  accuracy_m: z.coerce.number().min(0).max(5000),
});
export type ReportFields = z.infer<typeof reportFieldsSchema>;

export const reportContentSchema = z.object({
  v: z.literal(1),
  zone_id: z.string().min(1).max(64).nullable(),
  depth: z.enum(DEPTHS),
  photo_sha256: z.string().regex(HEX64),
  loc_commit: z.string().regex(HEX64),
});
export type ReportContent = z.infer<typeof reportContentSchema>;

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export function geohashes(lat: number, lon: number) {
  return { g5: ngeohash.encode(lat, lon, 5), g7: ngeohash.encode(lat, lon, 7), g9: ngeohash.encode(lat, lon, 9) };
}

/** Must match the client: sha256(geohash9 + ":" + created_at). */
export function locCommit(lat: number, lon: number, createdAt: number): string {
  return sha256Hex(`${ngeohash.encode(lat, lon, 9)}:${createdAt}`);
}

export type VerifiedReport = {
  event: NostrEvent;
  reportId: string;
  pubkey: string;
  createdAt: number;
  content: ReportContent;
  depth: Depth;
  lat: number;
  lon: number;
  accuracyM: number;
  geohash5: string;
  geohash7: string;
  photoSha256: string;
};

export type VerifyResult = { ok: true; report: VerifiedReport } | { ok: false; code: RejectCode };

export function verifyReport(
  input: { fields: Record<string, unknown>; photo: { bytes: Uint8Array; mime: string } | null },
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const f = reportFieldsSchema.safeParse(input.fields);
  if (!f.success || !input.photo) return { ok: false, code: "BAD_INPUT" };
  const { photo } = input;
  if (photo.mime !== "image/jpeg" || photo.bytes.byteLength === 0 || photo.bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, code: "BAD_INPUT" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(f.data.event);
  } catch {
    return { ok: false, code: "BAD_INPUT" };
  }
  if (!verifyEvent(raw)) return { ok: false, code: "BAD_SIGNATURE" };
  const event = raw;
  if (event.kind !== REPORT_KIND) return { ok: false, code: "BAD_EVENT" };

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(event.content);
  } catch {
    return { ok: false, code: "BAD_EVENT" };
  }
  const c = reportContentSchema.safeParse(parsedContent);
  const reportId = tagValue(event, "d");
  if (!c.success || !reportId || !UUID.test(reportId) || tagValue(event, "t") !== "ndoxwatch") {
    return { ok: false, code: "BAD_EVENT" };
  }

  if (event.created_at < nowSec - MAX_AGE_SEC || event.created_at > nowSec + MAX_SKEW_SEC) {
    return { ok: false, code: "TIME_WINDOW" };
  }

  const { lat, lon, accuracy_m } = f.data;
  const gh = geohashes(lat, lon);
  // The public tag must be the coarse cell of the committed location, nothing finer.
  if (tagValue(event, "g") !== gh.g5) return { ok: false, code: "LOC_MISMATCH" };
  if (locCommit(lat, lon, event.created_at) !== c.data.loc_commit) return { ok: false, code: "LOC_MISMATCH" };

  const photoSha256 = sha256Hex(photo.bytes);
  if (photoSha256 !== c.data.photo_sha256) return { ok: false, code: "PHOTO_MISMATCH" };

  return {
    ok: true,
    report: {
      event,
      reportId,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      content: c.data,
      depth: c.data.depth,
      lat,
      lon,
      accuracyM: accuracy_m,
      geohash5: gh.g5,
      geohash7: gh.g7,
      photoSha256,
    },
  };
}

/**
 * NdoxWatch tables. Drizzle describes the plain columns; geometry columns are declared as an opaque
 * custom type and every ST_* query is raw SQL (see lib/reports/*). NDOX_SQL is the source of truth
 * for the DDL and is what migrate runs (PostGIS, GIST indexes, CHECKs, UNIQUE event_id).
 */
import { bigint, boolean, customType, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const geometry = customType<{ data: string }>({ dataType: () => "geometry" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

import { DEPTHS, type Depth } from "../depths";
export { DEPTHS, type Depth };
export const STATUSES = ["auto_ok", "review", "rejected"] as const;
export type ReportStatus = (typeof STATUSES)[number];

export const zones = pgTable("zones", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  geom: geometry("geom").notNull(),
  rewardSats: integer("reward_sats").notNull(),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const floodMask = pgTable("flood_mask", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  preWindow: text("pre_window").notNull(),
  postWindow: text("post_window").notNull(),
  geom: geometry("geom").notNull(),
});

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey(),
    reporterPubkey: text("reporter_pubkey").notNull(),
    eventId: text("event_id").notNull().unique(),
    event: jsonb("event").notNull(),
    /** Signed event created_at (unix seconds). */
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    geom: geometry("geom").notNull(),
    accuracyM: doublePrecision("accuracy_m").notNull(),
    geohash5: text("geohash5").notNull(),
    geohash7: text("geohash7").notNull(),
    depth: text("depth").notNull(),
    photoSha256: text("photo_sha256").notNull(),
    photoDhash: bigint("photo_dhash", { mode: "bigint" }),
    checks: jsonb("checks").notNull(),
    ai: jsonb("ai"),
    score: integer("score"),
    status: text("status").notNull(),
    rejectCode: text("reject_code"),
    zoneId: text("zone_id"),
  },
  (t) => [index("reports_pubkey_zone_idx").on(t.reporterPubkey, t.zoneId)],
);

export const reportPhotos = pgTable("report_photos", {
  reportId: uuid("report_id").primaryKey(),
  jpeg: bytea("jpeg").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const NDOX_SQL = `
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS zones (
  id text PRIMARY KEY,
  name text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  reward_sats integer NOT NULL CHECK (reward_sats > 0),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS zones_geom_gist ON zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS flood_mask (
  id text PRIMARY KEY,
  source text NOT NULL,
  pre_window text NOT NULL,
  post_window text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS flood_mask_geom_gist ON flood_mask USING GIST (geom);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  reporter_pubkey text NOT NULL,
  event_id text NOT NULL UNIQUE,
  event jsonb NOT NULL,
  created_at bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  geom geometry(Point, 4326) NOT NULL,
  accuracy_m double precision NOT NULL,
  geohash5 text NOT NULL,
  geohash7 text NOT NULL,
  depth text NOT NULL CHECK (depth IN ('ankle', 'knee', 'waist', 'impassable')),
  photo_sha256 text NOT NULL,
  photo_dhash bigint,
  checks jsonb NOT NULL,
  ai jsonb,
  score integer,
  status text NOT NULL CHECK (status IN ('auto_ok', 'review', 'rejected')),
  reject_code text,
  zone_id text REFERENCES zones(id)
);
CREATE INDEX IF NOT EXISTS reports_geom_gist ON reports USING GIST (geom);
CREATE INDEX IF NOT EXISTS reports_pubkey_zone_idx ON reports (reporter_pubkey, zone_id);
CREATE INDEX IF NOT EXISTS reports_geohash5_idx ON reports (geohash5);

CREATE TABLE IF NOT EXISTS report_photos (
  report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  jpeg bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_photos_created_idx ON report_photos (created_at);
`;

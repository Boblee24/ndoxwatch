import { sql, type SQL } from "drizzle-orm";
import { migratePayouts, type Db } from "@sats/payouts";
import { NDOX_SQL } from "./schema";

export type { Db };

/** Rows from db.execute(): postgres-js returns an array, PGlite returns { rows }. */
export async function q<T = Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const r = (await db.execute(query)) as unknown;
  if (Array.isArray(r)) return r as T[];
  return ((r as { rows?: T[] }).rows ?? []) as T[];
}

/** Idempotent: PostGIS + NdoxWatch tables + the @sats/payouts tables. */
export async function migrateNdox(db: Db): Promise<void> {
  for (const stmt of NDOX_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
  await migratePayouts(db);
}

/** For CLI scripts: one connection, Postgres NOTICEs ("already exists, skipping") silenced. */
export async function createScriptDb(url: string): Promise<{ db: Db; end: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  return { db: drizzle(client) as unknown as Db, end: () => client.end() };
}

let cached: Db | undefined;

/** App database (server only). Lazily created from DATABASE_URL. */
export async function getDb(): Promise<Db> {
  if (cached) return cached;
  const { requireEnv } = await import("@sats/core/env");
  const { createDb } = await import("@sats/payouts/db");
  cached = createDb(requireEnv("DATABASE_URL")) as unknown as Db;
  return cached;
}

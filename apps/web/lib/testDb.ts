/** In-process Postgres + PostGIS (PGlite) for tests, attacks and offline evals. Not used by the app. */
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";
import { migrateNdox, type Db } from "./db";

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pg = await PGlite.create({ extensions: { postgis } });
  const db = drizzle(pg) as unknown as Db;
  await migrateNdox(db);
  return { db, close: () => pg.close() };
}

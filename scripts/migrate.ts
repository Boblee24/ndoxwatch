/** pnpm db:migrate: PostGIS + NdoxWatch tables + payouts tables. Idempotent. */
import { loadEnvLocal } from "./_env";
import { createDb } from "../packages/payouts/src/db";
import { migrateNdox, type Db } from "../apps/web/lib/db";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
const db = createDb(url, { max: 1 }) as unknown as Db;
await migrateNdox(db);
console.log("✓ migrate: postgis + ndoxwatch + payouts tables");
process.exit(0);

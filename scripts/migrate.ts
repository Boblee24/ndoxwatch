/** pnpm db:migrate: PostGIS + NdoxWatch tables + payouts tables. Idempotent. */
import { loadEnvLocal } from "./_env";
import { createScriptDb, migrateNdox } from "../apps/web/lib/db";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
const { db, end } = await createScriptDb(url);
await migrateNdox(db);
console.log("✓ migrate: postgis + ndoxwatch + payouts tables");
await end();
process.exit(0);

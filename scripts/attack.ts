/** pnpm attack → eval/ATTACKS.md (runs in-process; no server, wallet or API key needed). */
import { mkdirSync, writeFileSync } from "node:fs";
import { setLogSink } from "../packages/core/src/log";
import { attacksMarkdown, runAttacks } from "../apps/web/lib/attacks";
import { createTestDb } from "../apps/web/lib/testDb";

setLogSink(() => {});
const { db, close } = await createTestDb();
const rows = await runAttacks(db);
await close();
mkdirSync("eval", { recursive: true });
writeFileSync("eval/ATTACKS.md", attacksMarkdown(rows));
for (const r of rows) console.log(`${r.pass ? "✓" : "✗"} ${r.attack}: expected ${r.expected}, got ${r.actual}`);
console.log(`→ eval/ATTACKS.md (${rows.filter((r) => r.pass).length}/${rows.length})`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);

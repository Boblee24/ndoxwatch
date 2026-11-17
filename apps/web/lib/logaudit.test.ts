/**
 * Log audit (CLAUDE.md "Security": logs hold ids, codes and latency only). Runs the whole attack suite,
 * which exercises every pipeline branch, review and claim path, and checks nothing sensitive was logged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLogSink, type LogRecord } from "@sats/core/log";
import { runAttacks } from "./attacks";
import { createTestDb } from "./testDb";

const records: LogRecord[] = [];
const restore = setLogSink((r) => records.push(r));
let close: () => Promise<void> = async () => {};
beforeAll(async () => {
  const t = await createTestDb();
  close = t.close;
  await runAttacks(t.db);
}, 180_000);
afterAll(async () => {
  restore();
  await close();
});

describe("log audit", () => {
  it("logs something (the sink is wired)", () => {
    expect(records.length).toBeGreaterThan(5);
  });

  it("never logs coordinates, geohashes, pubkeys, invoices, signatures or photos", () => {
    const text = JSON.stringify(records.map(({ ts: _ts, ...r }) => r));
    expect(text).not.toMatch(/-?\d{1,3}\.\d{3,}/); // lat/lon-like decimals
    expect(text).not.toMatch(/\b[0-9a-f]{64}\b/); // pubkeys, event ids, hashes
    expect(text).not.toMatch(/\b[0-9a-f]{128}\b/); // signatures
    expect(text).not.toMatch(/ln(bc|tb|bcrt|tbs)1/i); // invoices
    expect(text).not.toMatch(/\/9j\/|base64/i); // JPEG data
    expect(text).not.toMatch(/"(lat|lon|geohash\w*|pubkey|photo|bolt11)"\s*:/); // field names outside the allowlist
    for (const r of records) {
      expect(Object.keys(r).every((k) => ["level", "ts", "event", "id", "paymentHash", "latencyMs", "status", "code", "count"].includes(k))).toBe(true);
    }
  });

  it("app code never calls console.* directly (only @sats/core/log)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", "public"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && /console\.(log|error|warn|info|debug)/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(join(__dirname, ".."));
    expect(offenders).toEqual([]);
  });
});

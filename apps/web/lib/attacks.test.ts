import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLogSink } from "@sats/core/log";
import { runAttacks, type AttackRow } from "./attacks";
import { createTestDb } from "./testDb";

let rows: AttackRow[] = [];
let close: () => Promise<void> = async () => {};
const restore = setLogSink(() => {});
beforeAll(async () => {
  const t = await createTestDb();
  close = t.close;
  rows = await runAttacks(t.db);
}, 180_000);
afterAll(async () => {
  restore();
  await close();
});

describe("attack suite", () => {
  it("every attack gets the expected outcome", () => {
    expect(rows.length).toBeGreaterThanOrEqual(18);
    expect(rows.filter((r) => !r.pass)).toEqual([]);
  });
});

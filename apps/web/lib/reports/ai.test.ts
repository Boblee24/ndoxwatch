import { describe, expect, it } from "vitest";
import { aiPhotoSchema, checkPhotoWithAi } from "./ai";
import { makeJpeg } from "./testkit";

describe("AI photo check (AI_MOCK=1)", () => {
  it("returns the schema-valid fixture", async () => {
    const r = await checkPhotoWithAi(await makeJpeg(1));
    expect(r).not.toBeNull();
    expect(aiPhotoSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ water_visible: true, screen_or_print: false });
  });
  it("schema rejects out-of-range or unknown values (model output is untrusted)", () => {
    const base = { water_visible: true, est_depth: "knee", outdoor: true, screen_or_print: false, confidence: 0.9, flags: ["none"] };
    expect(aiPhotoSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
    expect(aiPhotoSchema.safeParse({ ...base, est_depth: "chest" }).success).toBe(false);
    expect(aiPhotoSchema.safeParse({ ...base, flags: ["a", "b", "c", "d", "e"] }).success).toBe(false);
  });
});

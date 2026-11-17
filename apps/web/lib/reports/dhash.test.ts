import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dHash, hamming, DUPLICATE_MAX_DISTANCE } from "./dhash";
import { makeJpeg } from "./testkit";

describe("dHash", () => {
  it("same image re-encoded / resized stays within the duplicate distance", async () => {
    const a = await makeJpeg(3, { quality: 90, size: 640 });
    const reencoded = await sharp(a).jpeg({ quality: 40 }).toBuffer();
    const resized = await sharp(a).resize(300).jpeg({ quality: 60 }).toBuffer();
    const ha = await dHash(a);
    expect(hamming(ha, await dHash(reencoded))).toBeLessThanOrEqual(DUPLICATE_MAX_DISTANCE);
    expect(hamming(ha, await dHash(resized))).toBeLessThanOrEqual(DUPLICATE_MAX_DISTANCE);
  });

  it("different images are far apart", async () => {
    const seeds = [1, 2, 5, 8];
    const hashes = await Promise.all(seeds.map(async (s) => dHash(await makeJpeg(s))));
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) expect(hamming(hashes[i]!, hashes[j]!)).toBeGreaterThan(DUPLICATE_MAX_DISTANCE);
    }
  });

  it("fits a signed 64-bit column and hamming is symmetric", async () => {
    const h = await dHash(await makeJpeg(4));
    expect(h).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(h).toBeLessThan(2n ** 63n);
    expect(hamming(0n, -1n)).toBe(64);
    expect(hamming(5n, 3n)).toBe(hamming(3n, 5n));
    expect(hamming(h, h)).toBe(0);
  });
});

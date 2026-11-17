/**
 * Perceptual difference hash: 9×8 grayscale, each pixel compared with its right neighbour → 64 bits.
 * Survives re-encoding and resizing; a different scene lands far away. Returned as a SIGNED 64-bit
 * bigint so it fits a Postgres `bigint` column.
 */
import sharp from "sharp";

export const DUPLICATE_MAX_DISTANCE = 6;

export async function dHash(image: Uint8Array): Promise<bigint> {
  const px = await sharp(image).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, h);
}

export function hamming(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

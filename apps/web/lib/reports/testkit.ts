/** Test helpers: synthetic JPEGs and signed report submissions. Not imported by app code. */
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { signWithKey } from "@sats/nostr";
import type { Depth } from "../db/schema";
import { buildReportEventInput } from "./event";
import { sha256Hex } from "./verify";

/** A deterministic synthetic scene; different seeds give visually different images. */
export async function makeJpeg(seed: number, o: { quality?: number; size?: number } = {}): Promise<Buffer> {
  const w = o.size ?? 320;
  const h = Math.round(w * 0.75);
  // Smooth scene for ANY seed: 3 low-frequency waves (0.5–3 cycles across the frame) with seeded
  // directions and phases. High frequencies would alias when resized, which real photos don't.
  let st = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const waves = [0, 1, 2].map(() => ({ fx: (rnd() - 0.5) * 6, fy: (rnd() - 0.5) * 6, ph: rnd() * 6.283, a: 0.5 + rnd() }));
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const t = y / h;
      const s = waves.reduce((acc, k) => acc + k.a * Math.sin(6.283 * (k.fx * u + k.fy * t) + k.ph), 0);
      const v = Math.max(0, Math.min(255, Math.floor(127 + 55 * s)));
      const i = (y * w + x) * 3;
      px[i] = v;
      px[i + 1] = (v + 60) & 255;
      px[i + 2] = 255 - v;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: o.quality ?? 80 }).toBuffer();
}

export function newReporter() {
  return new Uint8Array(randomBytes(32));
}

export async function signedReport(o: {
  sk: Uint8Array;
  lat: number;
  lon: number;
  photo: Uint8Array;
  depth?: Depth;
  zoneId?: string | null;
  createdAt?: number;
  accuracyM?: number;
  reportId?: string;
}) {
  const createdAt = o.createdAt ?? Math.floor(Date.now() / 1000);
  const input = await buildReportEventInput({
    reportId: o.reportId ?? randomUUID(),
    zoneId: o.zoneId ?? null,
    depth: o.depth ?? "knee",
    photoSha256: sha256Hex(o.photo),
    lat: o.lat,
    lon: o.lon,
    createdAt,
  });
  const event = signWithKey(input, o.sk);
  return {
    event,
    fields: { event: JSON.stringify(event), lat: String(o.lat), lon: String(o.lon), accuracy_m: String(o.accuracyM ?? 12) },
    photo: { bytes: new Uint8Array(o.photo), mime: "image/jpeg" },
  };
}

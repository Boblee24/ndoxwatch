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
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const t = y / h;
      const v = Math.floor(127 + 120 * Math.sin(u * (seed + 1) * 3.1 + seed) * Math.cos(t * (seed + 2) * 2.3 - seed * 1.7));
      const i = (y * w + x) * 3;
      px[i] = v;
      px[i + 1] = (v + seed * 40) & 255;
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

/**
 * Builds the unsigned report event. Isomorphic (browser + Node 20+): uses WebCrypto, no node: imports.
 * The server re-derives the same values in verify.ts; a test keeps the two in sync.
 */
import ngeohash from "ngeohash";
import type { Depth } from "../depths";

export const REPORT_KIND = 30078;

export async function sha256HexWeb(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildReportEventInput(o: {
  reportId: string;
  zoneId: string | null;
  depth: Depth;
  photoSha256: string;
  lat: number;
  lon: number;
  createdAt: number;
}): Promise<{ kind: number; content: string; tags: string[][]; created_at: number }> {
  const locCommit = await sha256HexWeb(`${ngeohash.encode(o.lat, o.lon, 9)}:${o.createdAt}`);
  return {
    kind: REPORT_KIND,
    created_at: o.createdAt,
    content: JSON.stringify({ v: 1, zone_id: o.zoneId, depth: o.depth, photo_sha256: o.photoSha256, loc_commit: locCommit }),
    tags: [
      ["d", o.reportId],
      ["g", ngeohash.encode(o.lat, o.lon, 5)],
      ["t", "ndoxwatch"],
    ],
  };
}

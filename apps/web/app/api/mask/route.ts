import { NextResponse } from "next/server";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { maskGeoJson, zonesGeoJson } from "@/lib/geo/public";
import { publicRateLimit } from "@/lib/http";

export const runtime = "nodejs";

/** Public: satellite flood mask (with source + date windows) and non-demo zone outlines. */
export async function GET(req: Request) {
  const limited = publicRateLimit(req, "mask");
  if (limited) return limited;
  try {
    const db = await getDb();
    const [mask, zones] = await Promise.all([maskGeoJson(db), zonesGeoJson(db, { includeDemo: false })]);
    return NextResponse.json({ mask, zones }, { headers: { "cache-control": "public, max-age=300, s-maxage=300" } });
  } catch (err) {
    log.error("mask.api_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

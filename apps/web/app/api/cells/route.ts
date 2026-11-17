import { NextResponse } from "next/server";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { publicCells, type Cell } from "@/lib/geo/public";
import { publicRateLimit } from "@/lib/http";

export const runtime = "nodejs";
let cache: { at: number; cells: Cell[] } | null = null;

/** Public map data: geohash5 cells only (~5 km), never points. Cached 60 s. */
export async function GET(req: Request) {
  const limited = publicRateLimit(req, "cells");
  if (limited) return limited;
  try {
    if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), cells: await publicCells(await getDb()) };
    return NextResponse.json({ cells: cache.cells }, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
  } catch (err) {
    log.error("cells.api_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { serverEnv } from "@sats/core/env";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { counts, isPaused, spendToday } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { maskGeoJson, zonesGeoJson } from "@/lib/geo/public";
import { requireAdmin } from "@/lib/http";
import { getSponsor } from "@/lib/sponsor";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const db = await getDb();
    const env = serverEnv();
    const [c, spent, paused, mask, zones] = await Promise.all([
      counts(db),
      spendToday(db),
      isPaused(db),
      maskGeoJson(db),
      zonesGeoJson(db, { includeDemo: true }),
    ]);
    let budget: { usedSats: number; totalSats: number; renewsAt?: number } | null = null;
    if (env.SPONSOR_NWC_URL) budget = await getSponsor().then((s) => s.wallet.budget()).catch(() => null);
    return NextResponse.json(
      { counts: c, spendTodaySats: spent, maxDailySats: env.MAX_DAILY_PAYOUT_SATS, budget, paused, mask, zones, sponsorConfigured: Boolean(env.SPONSOR_NWC_URL) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    log.error("admin.overview_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { serverEnv } from "@sats/core/env";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { bearer, purgeOldPhotos, tokenMatches } from "@/lib/admin";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Deletes report photos older than 7 days. Vercel Cron (vercel.json) calls it daily with
 * `Authorization: Bearer $CRON_SECRET`; the admin token also works for a manual run.
 */
export async function GET(req: Request) {
  const token = bearer(req);
  if (!tokenMatches(token, process.env.CRON_SECRET) && !tokenMatches(token, serverEnv().ADMIN_TOKEN)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const n = await purgeOldPhotos(await getDb());
    log.info("photos.purged", { count: n });
    return NextResponse.json({ purged: n });
  } catch (err) {
    log.error("photos.purge_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

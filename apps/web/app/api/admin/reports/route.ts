import { NextResponse } from "next/server";
import { z } from "zod";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { listReports } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
const query = z.object({ filter: z.enum(["review", "sat_missed", "all"]).default("review") });

/** Precise report data: admin only. */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const p = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  try {
    return NextResponse.json({ reports: await listReports(await getDb(), p.data.filter) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error("admin.reports_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

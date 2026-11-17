import { NextResponse } from "next/server";
import { z } from "zod";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { decideReport } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { requireAdmin, UUID_RE } from "@/lib/http";

export const runtime = "nodejs";
const body = z.object({ action: z.enum(["approve", "reject"]) });

/** Review decision. Approve accrues the zone's reward; reject deletes the photo. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!UUID_RE.test(id) || !b.success) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  try {
    const r = await decideReport(await getDb(), id, b.data.action);
    log.info("admin.review", { id, status: r.ok ? r.status : "error", code: r.ok ? "none" : r.code });
    return NextResponse.json(r, { status: r.ok ? 200 : r.code === "NOT_FOUND" ? 404 : 409 });
  } catch (err) {
    log.error("admin.review_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

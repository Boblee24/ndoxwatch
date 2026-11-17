import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@sats/core/log";
import { setPaused } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
const body = z.object({ paused: z.boolean() });

/** Pause / resume payouts (claims). Rewards still accrue while paused. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  await setPaused(await getDb(), b.data.paused);
  log.info("admin.paused", { status: b.data.paused ? "paused" : "running" });
  return NextResponse.json({ paused: b.data.paused });
}

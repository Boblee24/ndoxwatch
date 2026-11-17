import { NextResponse } from "next/server";
import { photoOf } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { requireAdmin, UUID_RE } from "@/lib/http";

export const runtime = "nodejs";

/** Report photo for reviewers only (never public; deleted after 7 days). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  const jpeg = await photoOf(await getDb(), id);
  if (!jpeg) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  return new NextResponse(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
}

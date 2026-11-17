import { NextResponse } from "next/server";
import { z } from "zod";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { claimableSats } from "@sats/payouts";
import { getDb } from "@/lib/db";
import { publicRateLimit } from "@/lib/http";

export const runtime = "nodejs";
const query = z.object({ pubkey: z.string().regex(/^[0-9a-f]{64}$/) });

/** GET /api/rewards?pubkey=<hex> → { claimable } (integer sats). */
export async function GET(req: Request) {
  const limited = publicRateLimit(req, "rewards");
  if (limited) return limited;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  try {
    return NextResponse.json({ claimable: await claimableSats(await getDb(), q.data.pubkey) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error("rewards.api_error", { code: errorCode(err) });
    return NextResponse.json({ code: "SERVER_ERROR" }, { status: 500 });
  }
}

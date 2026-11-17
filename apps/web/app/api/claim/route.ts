import { NextResponse } from "next/server";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { clientKey, createRateLimiter } from "@sats/core/rateLimit";
import { claim } from "@sats/payouts";
import { getDb } from "@/lib/db";
import { claimBodySchema, verifyClaimEvent } from "@/lib/claims";
import { getSponsor } from "@/lib/sponsor";

export const runtime = "nodejs";
const limiter = createRateLimiter({ capacity: 5, refillPerSec: 1 / 30 });

/** Body: { event } — a signed claim event whose content is the reporter's bolt11 for the exact claimable amount. */
export async function POST(req: Request) {
  if (!limiter.take(clientKey(req.headers, "claim")).ok) return NextResponse.json({ status: "rejected", code: "RATE_LIMITED" }, { status: 429 });
  const body = claimBodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ status: "rejected", code: "BAD_INPUT" }, { status: 400 });
  const auth = verifyClaimEvent(body.data.event);
  if (!auth.ok) return NextResponse.json({ status: "rejected", code: auth.code }, { status: 400 });
  try {
    const [db, sponsor] = await Promise.all([getDb(), getSponsor()]);
    const r = await claim(db, sponsor.wallet, { pubkey: auth.pubkey, bolt11: auth.bolt11, limits: sponsor.limits });
    return NextResponse.json(r);
  } catch (err) {
    log.error("claim.api_error", { code: errorCode(err) });
    return NextResponse.json({ status: "error", code: "SERVER_ERROR" }, { status: 500 });
  }
}

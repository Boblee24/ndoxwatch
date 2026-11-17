/** Route helpers: admin guard (constant-time token) + per-client rate limits. SERVER ONLY. */
import { NextResponse } from "next/server";
import { serverEnv } from "@sats/core/env";
import { clientKey, createRateLimiter } from "@sats/core/rateLimit";
import { bearer, tokenMatches } from "./admin";

const adminLimiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
const badTokenLimiter = createRateLimiter({ capacity: 5, refillPerSec: 1 / 60 });

/** Returns a response to send back if the request is NOT an authorised admin, else null. */
export function requireAdmin(req: Request): NextResponse | null {
  const key = clientKey(req.headers, "admin");
  if (!adminLimiter.take(key).ok) return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
  const expected = serverEnv().ADMIN_TOKEN;
  if (!expected) return NextResponse.json({ code: "ADMIN_DISABLED" }, { status: 503 });
  if (tokenMatches(bearer(req), expected)) return null;
  // Slow down token guessing: 5 wrong tries, then one a minute.
  if (!badTokenLimiter.take(key).ok) return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
  return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
}

const publicLimiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });
export function publicRateLimit(req: Request, scope: string): NextResponse | null {
  return publicLimiter.take(clientKey(req.headers, scope)).ok ? null : NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

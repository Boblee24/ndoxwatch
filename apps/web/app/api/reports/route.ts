import { after, NextResponse } from "next/server";
import { serverEnv } from "@sats/core/env";
import { errorCode } from "@sats/core/errors";
import { log } from "@sats/core/log";
import { clientKey, createRateLimiter } from "@sats/core/rateLimit";
import { publishBestEffort } from "@sats/nostr";
import { getDb } from "@/lib/db";
import { checkPhotoWithAi } from "@/lib/reports/ai";
import { submitReport } from "@/lib/reports/pipeline";
import { MAX_PHOTO_BYTES } from "@/lib/reports/verify";

export const runtime = "nodejs";
export const maxDuration = 60; // AI photo check can take up to 25 s

// A reporter on a flaky network may retry; a burst of 10 then one every 20 s per client.
const limiter = createRateLimiter({ capacity: 10, refillPerSec: 1 / 20 });
const MAX_BODY = MAX_PHOTO_BYTES + 16 * 1024;

export async function POST(req: Request) {
  const started = Date.now();
  const rl = limiter.take(clientKey(req.headers, "reports"));
  if (!rl.ok) {
    return NextResponse.json({ status: "rejected", code: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } });
  }
  const len = Number(req.headers.get("content-length") ?? "0");
  if (!len || len > MAX_BODY) return NextResponse.json({ status: "rejected", code: "BAD_INPUT" }, { status: 413 });

  try {
    const form = await req.formData();
    const photo = form.get("photo");
    const fields: Record<string, unknown> = {};
    for (const k of ["event", "lat", "lon", "accuracy_m"]) {
      const v = form.get(k);
      if (typeof v === "string") fields[k] = v;
    }
    const photoInput =
      photo instanceof File && photo.size <= MAX_PHOTO_BYTES ? { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type } : null;

    const db = await getDb();
    const result = await submitReport(db, { fields, photo: photoInput }, { checkPhoto: checkPhotoWithAi });
    log.info("report.api", { status: result.status, code: result.code ?? "none", latencyMs: Date.now() - started });

    // 9. Publish the signed event (geohash5 only) after the response; never blocks the reporter.
    const event = result.publish;
    if (event) {
      after(async () => {
        const relays = serverEnv().NOSTR_RELAYS;
        const r = await publishBestEffort(event, relays);
        log.info("report.published", { id: event.id.slice(0, 16), count: r.ok.length });
      });
    }
    const { publish: _publish, ...body } = result;
    void _publish;
    const httpStatus = result.status === "rejected" && ["BAD_INPUT", "BAD_SIGNATURE", "BAD_EVENT"].includes(result.code ?? "") ? 400 : 200;
    return NextResponse.json(body, { status: httpStatus });
  } catch (err) {
    log.error("report.api_error", { code: errorCode(err), latencyMs: Date.now() - started });
    return NextResponse.json({ status: "error", code: "SERVER_ERROR" }, { status: 500 });
  }
}

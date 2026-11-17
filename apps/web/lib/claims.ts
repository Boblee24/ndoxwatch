/**
 * Claims are authorised by the reporter's Nostr key: the client signs a short-lived event whose content
 * is the bolt11 invoice. Without this anyone could drain someone else's rewards by naming their pubkey.
 * Replays are harmless: claim() rejects a payment_hash it has seen (UNIQUE), and the window is ±5 min.
 */
import { z } from "zod";
import { verifyEvent, tagValue } from "@sats/nostr";

export const CLAIM_KIND = 21_000; // ephemeral range: relays don't store it (we never publish it anyway)
export const CLAIM_TAG = "ndoxwatch-claim";
const WINDOW_SEC = 5 * 60;

export const claimBodySchema = z.object({ event: z.unknown() });

export function claimEventInput(bolt11: string) {
  return { kind: CLAIM_KIND, content: bolt11.trim(), tags: [["t", CLAIM_TAG]], created_at: Math.floor(Date.now() / 1000) };
}

export type ClaimAuth = { ok: true; pubkey: string; bolt11: string } | { ok: false; code: "BAD_SIGNATURE" | "BAD_EVENT" | "TIME_WINDOW" };

export function verifyClaimEvent(raw: unknown, nowSec = Math.floor(Date.now() / 1000)): ClaimAuth {
  if (!verifyEvent(raw)) return { ok: false, code: "BAD_SIGNATURE" };
  if (raw.kind !== CLAIM_KIND || tagValue(raw, "t") !== CLAIM_TAG) return { ok: false, code: "BAD_EVENT" };
  if (!/^ln[a-z0-9]{10,2000}$/i.test(raw.content)) return { ok: false, code: "BAD_EVENT" };
  if (Math.abs(raw.created_at - nowSec) > WINDOW_SEC) return { ok: false, code: "TIME_WINDOW" };
  return { ok: true, pubkey: raw.pubkey, bolt11: raw.content };
}

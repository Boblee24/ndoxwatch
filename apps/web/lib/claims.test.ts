import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWithKey } from "@sats/nostr";
import { CLAIM_KIND, claimEventInput, verifyClaimEvent } from "./claims";

const sk = new Uint8Array(randomBytes(32));
const BOLT11 = "lnbc1000n1ptestinvoicexxxxxxxxxxxxxxxx";

describe("verifyClaimEvent", () => {
  it("accepts a fresh signed claim and returns the signer's pubkey", () => {
    const e = signWithKey(claimEventInput(BOLT11), sk);
    expect(verifyClaimEvent(e)).toEqual({ ok: true, pubkey: e.pubkey, bolt11: BOLT11 });
  });
  it("rejects a swapped invoice (signature no longer matches)", () => {
    const e = signWithKey(claimEventInput(BOLT11), sk);
    expect(verifyClaimEvent({ ...e, content: "lnbc1000n1pattackerinvoicexxxxxxxx" })).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });
  it("rejects stale, wrong kind, and garbage content", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyClaimEvent(signWithKey({ ...claimEventInput(BOLT11), created_at: now - 600 }, sk))).toEqual({ ok: false, code: "TIME_WINDOW" });
    expect(verifyClaimEvent(signWithKey({ ...claimEventInput(BOLT11), kind: CLAIM_KIND + 1 }, sk))).toEqual({ ok: false, code: "BAD_EVENT" });
    expect(verifyClaimEvent(signWithKey(claimEventInput("hello"), sk))).toEqual({ ok: false, code: "BAD_EVENT" });
    expect(verifyClaimEvent({})).toEqual({ ok: false, code: "BAD_SIGNATURE" });
  });
});

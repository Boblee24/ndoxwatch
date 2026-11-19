import { describe, expect, it } from "vitest";
import type { Wallet } from "@sats/lightning";
import { connectWithRetry } from "./hooks";

const INFO = { alias: "w", network: "signet", methods: ["get_info"] } as never;

function fakes(behaviours: Array<"hang" | "ok" | "wallet_error">) {
  let n = 0;
  const closed: number[] = [];
  const make = () => {
    const i = n++;
    const b = behaviours[i]!;
    return {
      info: () =>
        b === "ok"
          ? Promise.resolve(INFO)
          : b === "wallet_error"
            ? Promise.reject(Object.assign(new Error("x"), { code: "UNAUTHORIZED", walletResponse: true }))
            : new Promise(() => {}),
      close: () => closed.push(i),
    } as unknown as Wallet;
  };
  return { make, closed, calls: () => n };
}

describe("connectWithRetry (slow first relay connection)", () => {
  it("retries once after a first-attempt timeout and succeeds", async () => {
    const f = fakes(["hang", "ok"]);
    const r = await connectWithRetry("nostr+walletconnect://x", f.make, [20, 200]);
    expect(r.info).toBe(INFO);
    expect(f.calls()).toBe(2);
    expect(f.closed).toEqual([0]);
  });
  it("gives up after the second timeout with TIMEOUT", async () => {
    const f = fakes(["hang", "hang"]);
    await expect(connectWithRetry("nostr+walletconnect://x", f.make, [10, 20])).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(f.closed).toEqual([0, 1]);
  });
  it("does not retry when the wallet itself answered with an error", async () => {
    const f = fakes(["wallet_error", "ok"]);
    await expect(connectWithRetry("nostr+walletconnect://x", f.make, [50, 50])).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.calls()).toBe(1);
  });
});

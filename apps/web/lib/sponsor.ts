/** Funder wallet (SPONSOR_NWC_URL, server env only). Checked once per process; too-broad permissions warn. */
import { requireEnv, serverEnv } from "@sats/core/env";
import { log } from "@sats/core/log";
import { createWallet, type Wallet } from "@sats/lightning";
import { checkSponsor, type ClaimLimits } from "@sats/payouts";

let cached: Promise<{ wallet: Wallet; limits: ClaimLimits }> | undefined;

export function getSponsor(): Promise<{ wallet: Wallet; limits: ClaimLimits }> {
  cached ??= (async () => {
    const env = serverEnv();
    const wallet = createWallet(requireEnv("SPONSOR_NWC_URL"));
    const check = await checkSponsor(wallet).catch(() => ({ ok: false, network: undefined, extra: [] as string[] }));
    if (env.NODE_ENV === "production" && !check.ok) log.warn("sponsor.not_pay_only", { count: check.extra.length });
    return { wallet, limits: { maxClaimSats: env.MAX_CLAIM_SATS, maxDailySats: env.MAX_DAILY_PAYOUT_SATS, network: check.network } };
  })();
  cached.catch(() => (cached = undefined));
  return cached;
}

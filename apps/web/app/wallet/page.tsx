"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@sats/core/i18n";
import type { Wallet } from "@sats/lightning";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { BigButton, SatsAmount, WalletPanel, useRates } from "@sats/ui";
import { useAppLang } from "../shell";
import "@/lib/i18n";
import { claimEventInput } from "@/lib/claims";

export default function WalletPage() {
  const lang = useAppLang();
  const rates = useRates();
  return (
    <>
      <h1 className="sr-only">Wallet</h1>
      <WalletPanel slot="wallet" lang={lang} rates={rates} currency={lang === "fr" ? "XOF" : "NGN"} warnIfCanSpend={false}>
        {({ wallet, refresh }) => <Rewards wallet={wallet} refresh={refresh} lang={lang} />}
      </WalletPanel>
    </>
  );
}

const AUTO_KEY = "ndox:autoclaim";
const readAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
};

/** Claimable report rewards. Auto-claim: invoice for the exact claimable amount → signed claim → funder pays. */
function Rewards({ wallet, refresh, lang }: { wallet: Wallet; refresh: () => void; lang: string }) {
  const [claimable, setClaimable] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    const { pubkey } = await getOrCreateKey();
    const r = await fetch(`/api/rewards?pubkey=${pubkey}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const sats = typeof r?.claimable === "number" ? r.claimable : null;
    setClaimable(sats);
    return sats;
  }, []);

  const doClaim = useCallback(
    async (sats: number) => {
      setBusy(true);
      setMsg(null);
      try {
        const inv = await wallet.makeInvoice({ sats, memo: "NdoxWatch flood report reward", expirySec: 600 });
        const event = await signEvent(claimEventInput(inv.bolt11));
        const r = await fetch("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) })
          .then((x) => x.json())
          .catch(() => ({ status: "error", code: "NETWORK" }));
        if (r.status === "paid") setMsg(t("w.claimed", lang, { sats: r.sats }));
        else if (r.status === "pending") setMsg(t("w.claim_pending", lang));
        else setMsg(t(`w.claim_err.${r.code}`, lang).startsWith("w.") ? t("w.claim_err", lang, { code: r.code ?? "?" }) : t(`w.claim_err.${r.code}`, lang));
      } catch {
        setMsg(t("w.claim_err", lang, { code: "WALLET" }));
      } finally {
        setBusy(false);
        refresh();
        void load();
      }
    },
    [wallet, lang, refresh, load],
  );

  useEffect(() => {
    setAuto(readAuto());
    void (async () => {
      const sats = await load();
      if (!autoTried.current && readAuto() && sats && sats > 0) {
        autoTried.current = true;
        await doClaim(sats);
      }
    })();
  }, [load, doClaim]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
      <h2 className="text-lg font-bold">{t("w.rewards", lang)}</h2>
      <p className="text-2xl font-bold">{claimable === null ? "…" : <SatsAmount sats={claimable} />}</p>
      <BigButton disabled={busy || !claimable} onClick={() => claimable && void doClaim(claimable)}>
        {busy ? t("w.claiming", lang) : t("w.claim", lang)}
      </BigButton>
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            try {
              localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
            } catch {
              /* private mode */
            }
          }}
        />
        {t("w.auto", lang)}
      </label>
      {msg && <p role="status" className="font-medium">{msg}</p>}
    </section>
  );
}

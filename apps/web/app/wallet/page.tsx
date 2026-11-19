"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@sats/core/i18n";
import type { Wallet } from "@sats/lightning";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { BigButton, WalletPanel, useRates } from "@sats/ui";
import { useAppLang } from "../shell";
import "@/lib/i18n";
import { claimEventInput } from "@/lib/claims";

export default function WalletPage() {
  const lang = useAppLang();
  const rates = useRates();
  return (
    <section className="flex w-full max-w-md flex-col gap-4 pt-1">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl leading-none">{t("nav.wallet", lang)}</h1>
        <p className="text-[var(--muted)]">{t("w.lead", lang)}</p>
      </div>
      <WalletPanel slot="wallet" lang={lang} rates={rates} currency={lang === "fr" ? "XOF" : "NGN"} warnIfCanSpend={false}>
        {({ wallet, refresh }) => <Rewards wallet={wallet} refresh={refresh} lang={lang} />}
      </WalletPanel>
    </section>
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
    <section className="relative flex flex-col gap-3 overflow-hidden rounded-md border-2 border-[var(--fg)] bg-[var(--fg)] p-4 text-[var(--bg)]">
      <span aria-hidden className="hazard absolute inset-x-0 top-0 h-1.5" />
      <h2 className="pt-1 text-sm font-bold uppercase tracking-wide">{t("w.rewards", lang)}</h2>
      <p className="font-display text-6xl leading-none tabular-nums">
        {claimable === null ? "…" : claimable.toLocaleString()} <span className="text-2xl text-[var(--accent)]">sats</span>
      </p>
      <BigButton disabled={busy || !claimable} onClick={() => claimable && void doClaim(claimable)} className="font-display text-2xl">
        {busy ? t("w.claiming", lang) : t("w.claim", lang)}
      </BigButton>
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6 accent-[var(--accent)]"
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
      {msg && (
        <p role="status" className="rounded-sm bg-[var(--bg)] p-2 font-bold text-[var(--fg)]">
          {msg}
        </p>
      )}
    </section>
  );
}

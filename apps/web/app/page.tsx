"use client";
import Link from "next/link";
import { t } from "@sats/core/i18n";
import { useAppLang } from "./shell";
import "@/lib/i18n";

export default function Home() {
  const lang = useAppLang();
  return (
    <section className="flex w-full max-w-xl flex-col gap-5 pt-6">
      <h1 className="text-3xl font-bold leading-tight">{t("home.title", lang)}</h1>
      <p className="text-[var(--muted)]">{t("home.lead", lang)}</p>
      <Link
        href="/report"
        className="inline-flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-[var(--accent)] px-6 text-2xl font-bold text-[var(--accent-fg)]"
      >
        <span aria-hidden>📷</span> {t("home.report", lang)}
      </Link>
      <Link href="/wallet" className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4">
        {t("wallet.title", lang)} →
      </Link>
    </section>
  );
}

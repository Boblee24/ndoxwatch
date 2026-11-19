"use client";
import Link from "next/link";
import { t } from "@sats/core/i18n";
import { CameraIcon, useAppLang } from "./shell";
import "@/lib/i18n";

/** Staff gauge illustration: numbered ticks with water standing at the knee mark. CSS + inline SVG only. */
function StaffGauge() {
  const marks = ["2.0", "1.5", "1.0", "0.5", "0"];
  return (
    <div aria-hidden className="relative h-56 w-20 shrink-0 overflow-hidden rounded-sm border-2 border-[var(--fg)] bg-[var(--surface)] shadow-[4px_4px_0_var(--fg)]">
      {marks.map((m, i) => (
        <div key={m} className="absolute inset-x-0 flex items-center gap-1" style={{ top: `${i * 25}%` }}>
          <span className="h-[3px] w-8 bg-[var(--fg)]" />
          <span className="font-display text-sm">{m}</span>
        </div>
      ))}
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className="absolute left-0 h-[2px] w-3 bg-[var(--fg)]" style={{ top: `${i * 5 + 2.5}%` }} />
      ))}
      <div className="water absolute inset-x-0 bottom-0 h-[38%]">
        <span className="wave" />
      </div>
    </div>
  );
}

export default function Home() {
  const lang = useAppLang();
  const steps = [t("home.step1", lang), t("home.step2", lang), t("home.step3", lang)];
  return (
    <section className="flex w-full max-w-xl flex-col gap-7 pt-4">
      <div className="rise flex items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <p className="inline-flex w-fit items-center gap-2 rounded-sm bg-[var(--fg)] px-2 py-0.5 text-sm font-bold text-[var(--bg)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
            {t("home.kicker", lang)}
          </p>
          <h1 className="font-display text-[3.4rem] leading-[0.88] sm:text-7xl">
            {t("home.h1a", lang)}
            <br />
            <span className="text-[var(--water)]">{t("home.h1b", lang)}</span>
          </h1>
        </div>
        <StaffGauge />
      </div>

      <Link
        href="/report"
        className="hivis rise flex min-h-24 w-full items-center justify-between gap-3 rounded-md px-6 font-display text-4xl [animation-delay:80ms]"
      >
        <span>{t("home.report", lang)}</span>
        <CameraIcon className="h-10 w-10" />
      </Link>

      <ol className="rise slab divide-y-2 divide-[var(--fg)] p-0 [animation-delay:160ms]">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-4 px-4 py-3">
            <span className="font-display w-10 text-3xl text-[var(--water)]">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-lg font-bold">{s}</span>
          </li>
        ))}
      </ol>

      <div className="rise flex flex-col gap-3 [animation-delay:240ms]">
        <p className="text-[var(--muted)]">{t("home.why", lang)}</p>
        <p className="flex items-start gap-2 text-sm font-bold">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          </svg>
          {t("home.private", lang)}
        </p>
        <Link href="/map" className="inline-flex min-h-12 w-fit items-center gap-2 font-bold underline decoration-[var(--water)] decoration-4 underline-offset-4">
          {t("home.map", lang)} →
        </Link>
      </div>
    </section>
  );
}

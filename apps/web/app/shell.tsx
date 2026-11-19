"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@sats/core/i18n";
import { LanguageSwitch, useLang, useOnline } from "@sats/ui/light";
import "@/lib/i18n";

const LangCtx = createContext<string>("en");
export const useAppLang = () => useContext(LangCtx);

/** Wordmark: a tiny staff gauge with the waterline at the knee mark. */
export function GaugeMark({ className = "h-7 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 28" className={className} aria-hidden>
      <rect x="1" y="1" width="18" height="26" rx="1" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
      {[5, 9, 13].map((y) => (
        <path key={y} d={`M1 ${y}h${y === 9 ? 10 : 6}`} stroke="currentColor" strokeWidth="2" />
      ))}
      <rect x="2" y="16" width="16" height="10" fill="var(--water)" />
      <path d="M2 16q4 -2 8 0t8 0" stroke="var(--water-deep)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

const NAV = [
  { href: "/map", key: "nav.map", icon: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15" },
  { href: "/report", key: "nav.report", icon: "" },
  { href: "/wallet", key: "nav.wallet", icon: "M3 7h18v13H3z M3 7l3-4h12l3 4 M16 13h2" },
] as const;

export function Shell({ children, demo }: { children: ReactNode; demo: boolean; nonce?: string }) {
  const [lang, setLang] = useLang("en");
  const online = useOnline();
  const path = usePathname();
  const isFunder = path?.startsWith("/funder");

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "pcm" ? "pcm" : lang;
  }, [lang]);

  return (
    <LangCtx.Provider value={lang}>
      {!online && (
        <div role="status" className="sticky top-0 z-30 flex items-stretch border-b-2 border-[var(--fg)] bg-[var(--accent)] text-[#0c1a24]">
          <span aria-hidden className="hazard w-4 shrink-0" />
          <p className="px-3 py-2 text-sm font-bold">{t("offline.banner", lang)}</p>
        </div>
      )}
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-3 pb-2">
        <Link href="/" className="flex items-center gap-2 text-[var(--fg)]" aria-label="NdoxWatch home">
          <GaugeMark />
          <span className="font-display text-2xl leading-none">
            Ndox<span className="text-[var(--water)]">Watch</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {demo && (
            <span className="rounded-sm border-2 border-[var(--fg)] px-1.5 text-xs font-bold uppercase" title={t("demo.banner", lang)}>
              {t("nav.demo", lang)}
            </span>
          )}
          <LanguageSwitch value={lang} onChange={setLang} />
        </div>
      </header>
      <main className={`mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 ${isFunder ? "pb-16" : "pb-32"}`}>{children}</main>

      {!isFunder && (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-[var(--fg)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="mx-auto grid max-w-md grid-cols-3 items-end">
            {NAV.map((n) => {
              const active = path === n.href;
              if (n.href === "/report")
                return (
                  <li key={n.href} className="flex justify-center">
                    <Link
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className="hivis -mt-6 mb-2 flex h-16 w-full max-w-36 flex-col items-center justify-center rounded-md font-display text-xl leading-none"
                    >
                      <CameraIcon />
                      {t("nav.report", lang)}
                    </Link>
                  </li>
                );
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-bold ${
                      active ? "text-[var(--fg)] underline decoration-[var(--water)] decoration-4 underline-offset-4" : "text-[var(--muted)]"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                      <path d={n.icon} />
                    </svg>
                    {t(n.key, lang)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </LangCtx.Provider>
  );
}

export function CameraIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13.5" r="3.75" />
    </svg>
  );
}

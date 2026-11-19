"use client";
/**
 * The light part of @sats/ui (no Lightning SDK, no QR code): safe to import from the app shell, which every page
 * ships. Import as "@sats/ui/light".
 */
import { useCallback, useEffect, useState } from "react";
import { isLang, t, type Lang } from "@sats/core/i18n";

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** UI language remembered per device (a convenience; falls back silently if storage is blocked). */
export function useLang(fallback: string = "en"): [string, (l: string) => void] {
  const [lang, setLangState] = useState(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sats:lang");
      if (saved) setLangState(saved);
      else if (isLang(navigator.language.slice(0, 2))) setLangState(navigator.language.slice(0, 2) as Lang);
    } catch {
      /* storage blocked */
    }
  }, []);
  const setLang = useCallback((l: string) => {
    setLangState(l);
    try {
      localStorage.setItem("sats:lang", l);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") document.documentElement.lang = l === "pcm" ? "en" : l;
  }, []);
  return [lang, setLang];
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  pcm: "Pidgin",
  fr: "Français",
  yo: "Yorùbá",
  ha: "Hausa",
  wo: "Wolof",
};

export function LanguageSwitch({
  value,
  onChange,
  langs = ["en", "pcm", "fr"],
}: {
  value: string;
  onChange: (l: string) => void;
  langs?: string[];
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">{t("lang.label", value)}</span>
      <span aria-hidden>🌐</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 max-w-24 rounded-md border-2 border-[var(--border)] bg-[var(--surface)] px-1 text-sm font-bold"
      >
        {langs.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}


"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "@sats/core/i18n";
import { useAppLang } from "../shell";
import "@/lib/i18n";
import { DEPTH_LEGEND, type MapCell } from "@/components/mapTypes";

// Lazy: MapLibre (~250 KB gz) loads only here and on /funder, never on /report.
const FloodMap = dynamic(() => import("@/components/FloodMap"), {
  ssr: false,
  loading: () => <div className="h-[62vh] w-full animate-pulse rounded-md border-2 border-[var(--fg)] bg-[var(--surface-2)]" />,
});

type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: unknown }> };

export default function MapPage() {
  const lang = useAppLang();
  const [cells, setCells] = useState<MapCell[]>([]);
  const [mask, setMask] = useState<FC | undefined>();
  const [zones, setZones] = useState<FC | undefined>();
  const [showMask, setShowMask] = useState(true);

  useEffect(() => {
    fetch("/api/cells")
      .then((r) => (r.ok ? r.json() : { cells: [] }))
      .then((d) => setCells(d.cells ?? []))
      .catch(() => {});
    fetch("/api/mask")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMask(d.mask);
        setZones(d.zones);
      })
      .catch(() => {});
  }, []);

  const masks = mask?.features.map((f) => f.properties) ?? [];
  const total = cells.reduce((n, c) => n + c.count, 0);

  return (
    <section className="flex w-full flex-col gap-3 pt-1">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-4xl leading-none">{t("m.title", lang)}</h1>
        <p className="font-display text-right text-xl leading-none text-[var(--water)]">
          {total} <span className="text-[var(--fg)]">/ {t("m.cells", lang, { n: cells.length })}</span>
        </p>
      </div>

      <div className="relative">
        <div className="shadow-[4px_4px_0_var(--fg)]">
          <FloodMap cells={cells} mask={mask} zones={zones} showMask={showMask} className="h-[62vh] w-full !rounded-md !border-2 !border-[var(--fg)]" />
        </div>
        {/* Legend as a staff gauge, floating on the map. */}
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border-2 border-[#0c1a24] bg-[#fbf8f1]/95 p-2 text-xs font-bold text-[#0c1a24]">
          {[...DEPTH_LEGEND].reverse().map(([d, c]) => (
            <span key={d} className="flex items-center gap-2 py-0.5">
              <span aria-hidden className="inline-block h-3.5 w-5 border border-[#0c1a24]" style={{ background: c }} />
              {t(`r.depth.${d}`, lang)}
            </span>
          ))}
          {showMask && (
            <span className="flex items-center gap-2 border-t border-[#0c1a24]/30 pt-1">
              <span aria-hidden className="inline-block h-3.5 w-5 border border-[#0c1a24] bg-red-500/40" />
              {t("m.mask", lang)}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={showMask}
        onClick={() => setShowMask((v) => !v)}
        className="flex min-h-14 items-center justify-between gap-3 rounded-md border-2 border-[var(--fg)] bg-[var(--surface)] px-4 font-bold"
      >
        {t("m.toggle", lang)}
        <span aria-hidden className={`relative h-7 w-12 rounded-full border-2 border-[var(--fg)] ${showMask ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--fg)] transition-all ${showMask ? "left-5" : "left-0.5"}`} />
        </span>
      </button>

      <p className="flex items-start gap-2 text-sm text-[var(--muted)]">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
        {t("m.privacy", lang, { n: total })}
      </p>
      {masks.length > 0 && (
        <ul className="text-xs text-[var(--muted)]">
          {masks.map((m) => (
            <li key={String(m.id)}>
              {m.source === "placeholder"
                ? t("m.placeholder", lang)
                : t("m.source", lang, { source: String(m.source), pre: String(m.pre_window), post: String(m.post_window) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

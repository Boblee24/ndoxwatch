"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import "maplibre-gl/dist/maplibre-gl.css";
import { t } from "@sats/core/i18n";
import { useAppLang } from "../shell";
import "@/lib/i18n";
import type { MapCell } from "@/components/FloodMap";

// Lazy: MapLibre (~250 KB gz) loads only here and on /funder, never on /report.
const FloodMap = dynamic(() => import("@/components/FloodMap"), { ssr: false, loading: () => <div className="h-[60vh] w-full animate-pulse rounded-xl bg-[var(--surface-2)]" /> });

const LEGEND = [
  ["ankle", "#7dd3fc"],
  ["knee", "#38bdf8"],
  ["waist", "#0369a1"],
  ["impassable", "#1e1b4b"],
] as const;

type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: unknown }> };

export default function MapPage() {
  const lang = useAppLang();
  const [cells, setCells] = useState<MapCell[]>([]);
  const [mask, setMask] = useState<FC | undefined>();
  const [zones, setZones] = useState<FC | undefined>();
  const [showMask, setShowMask] = useState(true);

  useEffect(() => {
    fetch("/api/cells").then((r) => (r.ok ? r.json() : { cells: [] })).then((d) => setCells(d.cells ?? [])).catch(() => {});
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
    <section className="flex w-full flex-col gap-3 pt-2">
      <h1 className="text-2xl font-bold">{t("m.title", lang)}</h1>
      <p className="text-sm text-[var(--muted)]">{t("m.privacy", lang, { n: total })}</p>
      <FloodMap cells={cells} mask={mask} zones={zones} showMask={showMask} />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {LEGEND.map(([d, c]) => (
          <span key={d} className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-4 w-4 rounded" style={{ background: c }} />
            {t(`r.depth.${d}`, lang)}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-4 rounded bg-red-500/40" />
          {t("m.mask", lang)}
        </span>
      </div>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="h-6 w-6" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} />
        {t("m.toggle", lang)}
      </label>
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

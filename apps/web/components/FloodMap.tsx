"use client";
/**
 * MapLibre + OpenFreeMap. Only ever loaded via next/dynamic from /map and /funder, so /report never ships it.
 * CSP for those two routes allows https://tiles.openfreemap.org and worker-src blob: (proxy.ts).
 */
import { useEffect, useRef } from "react";
import ngeohash from "ngeohash";
import { Map as MlMapCtor, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike, type Map as MlMap } from "maplibre-gl";

// Served from public/ (copied on predev/prebuild); bundling breaks MapLibre's own worker lookup.
setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const DEPTH_COLORS = { ankle: "#7dd3fc", knee: "#38bdf8", waist: "#0369a1", impassable: "#1e1b4b" } as const;

type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: unknown }> };
export type MapCell = { geohash5: string; count: number; max_depth: keyof typeof DEPTH_COLORS };
export type MapPoint = { id: string; lat: number; lon: number; depth: string; status: string; satellite_missed: boolean };

const EMPTY: FC = { type: "FeatureCollection", features: [] };

function cellsToGeoJson(cells: MapCell[]): FC {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => {
      const [s, w, n, e] = ngeohash.decode_bbox(c.geohash5);
      return {
        type: "Feature",
        properties: { count: c.count, depth: c.max_depth, label: String(c.count) },
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
  };
}

function pointsToGeoJson(points: MapPoint[]): FC {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: { id: p.id, depth: p.depth, status: p.status, missed: p.satellite_missed },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

function boundsOf(fcs: FC[]): LngLatBoundsLike | null {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      w = Math.min(w, x!); e = Math.max(e, x!); s = Math.min(s, y!); n = Math.max(n, y!);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const fc of fcs) for (const f of fc.features) visit((f.geometry as { coordinates?: unknown })?.coordinates);
  return w <= e ? [[w, s], [e, n]] : null;
}

export default function FloodMap({
  cells = [],
  mask = EMPTY,
  zones = EMPTY,
  points = [],
  showMask = true,
  onPointClick,
  className = "h-[60vh] w-full",
}: {
  cells?: MapCell[];
  mask?: FC;
  zones?: FC;
  points?: MapPoint[];
  showMask?: boolean;
  onPointClick?: (id: string) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    if (!el.current) return;
    const m = new MlMapCtor({ container: el.current, style: STYLE_URL, center: [-17.27, 14.73], zoom: 10, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("mask", { type: "geojson", data: EMPTY as never });
      m.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": "#ef4444", "fill-opacity": 0.25 } });
      m.addSource("zones", { type: "geojson", data: EMPTY as never });
      m.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1] } });
      m.addSource("cells", { type: "geojson", data: EMPTY as never });
      m.addLayer({
        id: "cells-fill",
        type: "fill",
        source: "cells",
        paint: {
          "fill-color": ["match", ["get", "depth"], "ankle", DEPTH_COLORS.ankle, "knee", DEPTH_COLORS.knee, "waist", DEPTH_COLORS.waist, DEPTH_COLORS.impassable],
          "fill-opacity": 0.55,
          "fill-outline-color": "#0f172a",
        },
      });
      m.addSource("points", { type: "geojson", data: EMPTY as never });
      m.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": 7,
          "circle-color": ["match", ["get", "status"], "auto_ok", "#16a34a", "review", "#f59e0b", "#dc2626"],
          "circle-stroke-width": ["case", ["get", "missed"], 3, 1],
          "circle-stroke-color": ["case", ["get", "missed"], "#7c3aed", "#ffffff"],
        },
      });
      m.on("click", "points", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") clickRef.current?.(id);
      });
      loaded.current = true;
      m.fire("ndox:data");
    });
    return () => {
      loaded.current = false;
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      if (!loaded.current) return;
      (m.getSource("mask") as GeoJSONSource).setData(mask as never);
      (m.getSource("zones") as GeoJSONSource).setData(zones as never);
      (m.getSource("cells") as GeoJSONSource).setData(cellsToGeoJson(cells) as never);
      (m.getSource("points") as GeoJSONSource).setData(pointsToGeoJson(points) as never);
      m.setLayoutProperty("mask-fill", "visibility", showMask ? "visible" : "none");
      if (!fitted.current) {
        const b = boundsOf([zones, cellsToGeoJson(cells), pointsToGeoJson(points)]);
        if (b) {
          m.fitBounds(b, { padding: 30, maxZoom: 13, duration: 0 });
          fitted.current = true;
        }
      }
    };
    apply();
    m.on("ndox:data", apply);
    return () => {
      m.off("ndox:data", apply);
    };
  }, [cells, mask, zones, points, showMask]);

  return <div ref={el} className={`${className} overflow-hidden rounded-xl border border-[var(--border)]`} role="region" aria-label="Flood map" />;
}

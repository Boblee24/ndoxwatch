"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import "maplibre-gl/dist/maplibre-gl.css";
import { BigButton } from "@sats/ui";
import type { MapPoint } from "@/components/FloodMap";

const FloodMap = dynamic(() => import("@/components/FloodMap"), { ssr: false, loading: () => <div className="h-[50vh] w-full animate-pulse rounded-xl bg-[var(--surface-2)]" /> });

type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: unknown }> };
type Overview = {
  counts: { total: number; auto_ok: number; review: number; rejected: number; sat_missed: number };
  spendTodaySats: number;
  maxDailySats: number;
  budget: { usedSats: number; totalSats: number; renewsAt?: number } | null;
  paused: boolean;
  mask: FC;
  zones: FC;
  sponsorConfigured: boolean;
};
type Report = MapPoint & {
  accuracy_m: number;
  reject_code: string | null;
  score: number | null;
  zone_id: string | null;
  created_at: number;
  checks: Record<string, unknown>;
  ai: Record<string, unknown> | null;
  has_photo: boolean;
  reporter: string;
};
type Filter = "review" | "sat_missed" | "all";

const TOKEN_KEY = "ndox:admin";
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};

export default function FunderPage() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => setToken(readToken()), []);

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        setToken("");
        try {
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        throw new Error("Wrong admin token");
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.code ?? `HTTP ${res.status}`);
      return res;
    },
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [o, r] = await Promise.all([api("/api/admin/overview").then((x) => x.json()), api(`/api/admin/reports?filter=${filter}`).then((x) => x.json())]);
      setOv(o);
      setReports(r.reports);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [api, filter, token]);
  useEffect(() => void load(), [load]);

  async function decide(id: string, action: "approve" | "reject") {
    try {
      await api(`/api/admin/reports/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      setSelected(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function togglePause() {
    if (!ov) return;
    await api("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: !ov.paused }) }).catch((e) =>
      setErr((e as Error).message),
    );
    await load();
  }

  async function download(format: "geojson" | "csv") {
    try {
      const blob = await (await api(`/api/admin/export?format=${format}`)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ndoxwatch-reports.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!token) {
    return (
      <section className="flex w-full max-w-md flex-col gap-3 pt-4">
        <h1 className="font-display text-4xl leading-none">Funder console</h1>
        <p className="text-sm text-[var(--muted)]">Emergency desk access. The token stays in this browser tab only.</p>
        {err && <p className="font-medium text-[var(--danger)]">{err}</p>}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              sessionStorage.setItem(TOKEN_KEY, input);
            } catch {
              /* ignore */
            }
            setToken(input);
            setInput("");
          }}
        >
          <input
            type="password"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="min-h-12 rounded-md border-2 border-[var(--fg)] bg-[var(--surface)] px-3"
          />
          <BigButton type="submit">Open console</BigButton>
        </form>
      </section>
    );
  }

  const sel = reports.find((r) => r.id === selected) ?? null;
  const budgetUsed = ov?.budget ? ov.budget.usedSats : (ov?.spendTodaySats ?? 0);
  const budgetTotal = ov?.budget ? ov.budget.totalSats : (ov?.maxDailySats ?? 0);
  const pct = budgetTotal > 0 ? Math.min(100, Math.round((budgetUsed / budgetTotal) * 100)) : 0;

  return (
    <section className="flex w-full flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-4xl leading-none">Funder console</h1>
        <div className="flex gap-2">
          <BigButton variant="secondary" onClick={() => download("geojson")}>
            GeoJSON
          </BigButton>
          <BigButton variant="secondary" onClick={() => download("csv")}>
            CSV
          </BigButton>
        </div>
      </div>
      {err && <p className="font-medium text-[var(--danger)]">{err}</p>}

      {ov && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="slab p-3">
            <p className="text-sm text-[var(--muted)]">{ov.budget ? "NWC budget used" : "Paid today / daily cap"}</p>
            <p className="font-display text-3xl leading-none">
              {budgetUsed.toLocaleString()} / {budgetTotal.toLocaleString()} sats
            </p>
            <div className="mt-2 h-4 w-full rounded-sm border-2 border-[var(--fg)] bg-[var(--surface-2)]" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${pct >= 90 ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`} style={{ width: `${pct}%` }} />
            </div>
            {!ov.sponsorConfigured && <p className="mt-1 text-xs text-[var(--danger)]">SPONSOR_NWC_URL not set: claims will fail.</p>}
          </div>
          <div className="slab p-3">
            <p className="text-sm text-[var(--muted)]">Reports</p>
            <p className="font-display text-3xl leading-none">{ov.counts.total}</p>
            <p className="text-sm">
              ✓ {ov.counts.auto_ok} · review {ov.counts.review} · ✗ {ov.counts.rejected} · 🛰️ missed {ov.counts.sat_missed}
            </p>
          </div>
          <div className="slab p-3">
            <p className="text-sm text-[var(--muted)]">Payouts</p>
            <p className="font-display text-3xl leading-none">{ov.paused ? "Paused" : "Running"}</p>
            <BigButton variant={ov.paused ? "primary" : "danger"} onClick={togglePause} className="mt-1 w-full">
              {ov.paused ? "Resume payouts" : "Pause payouts"}
            </BigButton>
          </div>
        </div>
      )}

      <FloodMap className="h-[50vh] w-full !rounded-md !border-2 !border-[var(--fg)]" mask={ov?.mask} zones={ov?.zones} points={reports} onPointClick={setSelected} />
      <p className="text-xs text-[var(--muted)]">
        Red area: satellite mask ({ov?.mask.features.map((f) => `${f.properties.source}${f.properties.source === "placeholder" ? "" : `, ${f.properties.pre_window} → ${f.properties.post_window}`}`).join("; ") || "none"}).
        Dots: green paid, amber review, red rejected; purple ring = &quot;Satellite missed?&quot;. Precise locations: admin only.
      </p>

      <div className="flex gap-2" role="tablist">
        {(
          [
            ["review", "Review queue"],
            ["sat_missed", "Satellite missed?"],
            ["all", "All"],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-12 rounded-md border-2 border-[var(--fg)] px-4 font-bold ${filter === f ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--surface)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {sel && <ReportDetail r={sel} api={api} onDecide={decide} onClose={() => setSelected(null)} />}

      <ul className="flex flex-col gap-2">
        {reports.length === 0 && <li className="text-[var(--muted)]">Nothing here.</li>}
        {reports.map((r) => (
          <li key={r.id}>
            <button onClick={() => setSelected(r.id)} className="flex min-h-12 w-full flex-wrap items-center gap-3 rounded-md border-2 border-[var(--fg)] bg-[var(--surface)] p-3 text-left">
              <span className="font-semibold">{r.status}</span>
              {r.satellite_missed && <span className="rounded bg-violet-700 px-2 text-sm text-white">Satellite missed?</span>}
              <span>{r.depth}</span>
              <span className="text-sm text-[var(--muted)]">
                {new Date(r.created_at * 1000).toLocaleString()} · score {r.score ?? "–"} · {r.zone_id}
              </span>
              {r.reject_code && <span className="text-sm text-[var(--danger)]">{r.reject_code}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportDetail({
  r,
  api,
  onDecide,
  onClose,
}: {
  r: Report;
  api: (path: string) => Promise<Response>;
  onDecide: (id: string, a: "approve" | "reject") => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    setSrc(null);
    if (r.has_photo)
      api(`/api/admin/photo/${r.id}`)
        .then((x) => x.blob())
        .then((b) => setSrc((url = URL.createObjectURL(b))))
        .catch(() => {});
    return () => void (url && URL.revokeObjectURL(url));
  }, [r.id, r.has_photo, api]);

  return (
    <div className="flex flex-col gap-3 slab p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          Report {r.id.slice(0, 8)} {r.satellite_missed && <span className="rounded bg-violet-700 px-2 text-sm text-white">Satellite missed?</span>}
        </h2>
        <button onClick={onClose} className="min-h-12 px-3 underline">
          Close
        </button>
      </div>
      {src ? <img src={src} alt="Reported flood photo" className="max-h-80 w-full rounded-lg object-contain" /> : <p className="text-sm text-[var(--muted)]">{r.has_photo ? "Loading photo…" : "No photo (rejected or older than 7 days)"}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>Location</dt>
        <dd>
          {r.lat.toFixed(5)}, {r.lon.toFixed(5)} (± {Math.round(r.accuracy_m)} m)
        </dd>
        <dt>Reported depth</dt>
        <dd>{r.depth}</dd>
        <dt>Reporter key</dt>
        <dd className="font-mono">{r.reporter}…</dd>
        <dt>Checks</dt>
        <dd className="font-mono text-xs">{JSON.stringify(r.checks)}</dd>
        <dt>AI output</dt>
        <dd className="font-mono text-xs">{r.ai ? JSON.stringify(r.ai) : "none (AI unavailable)"}</dd>
      </dl>
      {r.status === "review" && (
        <div className="flex gap-2">
          <BigButton onClick={() => onDecide(r.id, "approve")}>Approve & pay</BigButton>
          <BigButton variant="danger" onClick={() => onDecide(r.id, "reject")}>
            Reject
          </BigButton>
        </div>
      )}
    </div>
  );
}

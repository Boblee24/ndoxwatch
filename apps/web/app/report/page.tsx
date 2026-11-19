"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@sats/core/i18n";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { CameraIcon, useAppLang } from "../shell";
import "@/lib/i18n";
import { DEPTHS, type Depth } from "@/lib/depths";
import { buildReportEventInput, sha256HexWeb } from "@/lib/reports/event";
import { getFix, preparePhoto, type Fix } from "@/lib/client/photo";
import { enqueue, flushQueue, queued, sendReport, type QueuedReport } from "@/lib/client/queue";

type Result = {
  status: "auto_ok" | "review" | "rejected" | "error";
  code?: string;
  label?: string;
  rewardSats?: number;
  checks?: Record<string, unknown>;
};

const CHECK_KEYS = ["signature", "zone", "cap", "new_photo", "in_mask", "ai"] as const;

export default function ReportPage() {
  const lang = useAppLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [depth, setDepth] = useState<Depth | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locState, setLocState] = useState<"idle" | "locating" | "ok" | "denied">("idle");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [waiting, setWaiting] = useState(0);

  const locate = useCallback(async () => {
    setLocState("locating");
    try {
      setFix(await getFix());
      setLocState("ok");
    } catch {
      setLocState("denied");
    }
  }, []);

  // Retry queued reports on load, when the network comes back, and every 30 s.
  const flush = useCallback(async () => {
    const r = await flushQueue();
    if (r.tooOld > 0) setNotice(t("r.too_old", lang));
    const last = r.sent.at(-1);
    if (last) setResult(last as Result);
    setWaiting((await queued()).length);
  }, [lang]);
  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void flush(), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [flush]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    setNotice(null);
    if (locState !== "ok") void locate();
    try {
      const jpeg = await preparePhoto(f);
      setPhoto(jpeg);
      setPreview(URL.createObjectURL(jpeg));
    } catch {
      setNotice(t("code.default", lang));
    }
  }

  async function submit() {
    if (!photo || !depth) return;
    setBusy(true);
    setNotice(null);
    try {
      const where = fix ?? (await getFix().catch(() => null));
      if (!where) {
        setLocState("denied");
        return;
      }
      await getOrCreateKey();
      const reportId = crypto.randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);
      const input = await buildReportEventInput({
        reportId,
        zoneId: null,
        depth,
        photoSha256: await sha256HexWeb(await photo.arrayBuffer()),
        lat: where.lat,
        lon: where.lon,
        createdAt,
      });
      const event = await signEvent(input);
      const item: QueuedReport = {
        id: reportId,
        createdAt,
        fields: { event: JSON.stringify(event), lat: String(where.lat), lon: String(where.lon), accuracy_m: String(where.accuracyM) },
        photo,
        attempts: 0,
      };
      const r = await sendReport(item);
      if (r.kind === "response") {
        setResult(r.body as Result);
      } else {
        await enqueue(item);
        setWaiting((await queued()).length);
        setNotice(t("r.queued", lang));
      }
      setPhoto(null);
      setPreview(null);
      setDepth(null);
    } finally {
      setBusy(false);
    }
  }


  const ready = Boolean(photo && depth);
  return (
    <section className="flex w-full max-w-md flex-col gap-5 pt-1">
      <h1 className="font-display text-4xl leading-none">{t("r.title", lang)}</h1>

      {result && <ResultCard result={result} lang={lang} onAgain={() => setResult(null)} />}
      {notice && (
        <p role="status" className="slab rise p-3 font-bold">
          {notice}
        </p>
      )}
      {waiting > 0 && (
        <p className="flex items-center gap-2 rounded-sm border-2 border-dashed border-[var(--fg)] px-3 py-2 text-sm font-bold">
          <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)] ring-2 ring-[var(--fg)]" />
          {t("r.queue_n", lang, { n: waiting })}
        </p>
      )}

      {/* 1. Photo: the whole viewfinder is the button. */}
      <Step n={1} label={t("r.step_photo", lang)} done={Boolean(preview)}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} tabIndex={-1} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border-2 border-[var(--fg)] ${
            preview ? "" : "border-dashed bg-[var(--surface)]"
          }`}
        >
          {preview ? (
            <>
              <img src={preview} alt={t("r.photo_ready", lang)} className="absolute inset-0 h-full w-full object-cover" />
              <span className="hivis absolute right-3 bottom-3 rounded-sm px-3 py-1.5 text-base font-bold">↻ {t("r.retake", lang)}</span>
            </>
          ) : (
            <span className="flex flex-col items-center gap-2 px-6 text-center">
              <span className="hivis flex h-20 w-20 items-center justify-center rounded-full">
                <CameraIcon className="h-10 w-10" />
              </span>
              <span className="text-lg font-bold">{t("r.tap_photo", lang)}</span>
              <span className="text-sm text-[var(--muted)]">{t("r.no_faces", lang)}</span>
            </span>
          )}
          {!preview &&
            CORNERS.map((c) => <span key={c} aria-hidden className={`absolute h-6 w-6 border-[var(--water)] ${c}`} />)}
        </button>
        <LocationLine state={locState} fix={fix} lang={lang} />
      </Step>

      {/* 2. Depth: a staff gauge. Tap a band, the water rises to it. */}
      <Step n={2} label={t("r.step_depth", lang)} done={Boolean(depth)}>
        <DepthGauge value={depth} onChange={setDepth} lang={lang} />
      </Step>

      {/* 3. Send */}
      <Step n={3} label={t("r.step_send", lang)} done={false}>
        <button
          type="button"
          onClick={submit}
          disabled={!ready || busy}
          className="hivis flex min-h-20 w-full items-center justify-center gap-3 rounded-md font-display text-3xl"
        >
          {busy ? (
            <>
              <span aria-hidden className="h-6 w-6 animate-spin rounded-full border-4 border-current border-t-transparent" />
              {t("r.sending", lang)}
            </>
          ) : (
            <>{t("r.send", lang).replace(/^3\.\s*/, "")} →</>
          )}
        </button>
        <p className="text-sm text-[var(--muted)]">{ready ? t("r.offline_ok", lang) : t("r.need", lang)}</p>
      </Step>
    </section>
  );
}

const CORNERS = ["top-2 left-2 border-t-4 border-l-4", "top-2 right-2 border-t-4 border-r-4", "bottom-2 left-2 border-b-4 border-l-4", "right-2 bottom-2 border-r-4 border-b-4"];

function Step({ n, label, done, children }: { n: number; label: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2">
        <span
          className={`font-display flex h-8 w-8 items-center justify-center rounded-sm border-2 border-[var(--fg)] text-xl ${
            done ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--surface)]"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <span className="font-display text-2xl leading-none">{label}</span>
      </p>
      {children}
    </div>
  );
}

const GAUGE_ORDER: Depth[] = ["impassable", "waist", "knee", "ankle"]; // top → bottom
const FILL: Record<Depth, string> = { ankle: "25%", knee: "50%", waist: "75%", impassable: "100%" };

function DepthGauge({ value, onChange, lang }: { value: Depth | null; onChange: (d: Depth) => void; lang: string }) {
  const level = value ? DEPTHS.indexOf(value) : -1;
  return (
    <div role="radiogroup" aria-label={t("r.depth", lang)} className="slab relative overflow-hidden p-0">
      <div
        aria-hidden
        className="water absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out"
        style={{ height: value ? FILL[value] : "0%" }}
      >
        {value && <span className="wave" />}
      </div>
      {GAUGE_ORDER.map((d) => {
        const under = level >= DEPTHS.indexOf(d);
        const selected = value === d;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(d)}
            className={`relative flex min-h-[4.25rem] w-full items-center gap-3 border-b-2 border-[var(--hair)] px-3 text-left last:border-b-0 ${
              under ? "text-white" : ""
            }`}
          >
            <span aria-hidden className={`flex w-10 flex-col gap-1.5 ${under ? "opacity-70" : ""}`}>
              <span className="h-[3px] w-10 bg-current" />
              <span className="h-[2px] w-5 bg-current" />
              <span className="h-[2px] w-5 bg-current" />
            </span>
            <span className="flex flex-1 flex-col leading-tight">
              <span className="font-display text-3xl">{t(`r.depth.${d}`, lang)}</span>
              <span className={`text-sm ${under ? "text-white/85" : "text-[var(--muted)]"}`}>{t(`r.depth.${d}.h`, lang)}</span>
            </span>
            {d === "impassable" && <span aria-hidden className="hazard h-8 w-8 rounded-sm border-2 border-[var(--fg)]" />}
            <span
              aria-hidden
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 font-bold ${
                selected ? "border-white bg-[var(--accent)] text-[#0c1a24]" : under ? "border-white/70" : "border-[var(--fg)]"
              }`}
            >
              {selected ? "✓" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LocationLine({ state, fix, lang }: { state: string; fix: Fix | null; lang: string }) {
  const base = "flex items-center gap-2 text-sm font-bold";
  if (state === "locating")
    return (
      <p className={base}>
        <span aria-hidden className="h-2.5 w-2.5 animate-ping rounded-full bg-[var(--water)]" />
        {t("r.locating", lang)}
      </p>
    );
  if (state === "denied") return <p className={`${base} text-[var(--danger)]`}>⚠ {t("r.loc_denied", lang)}</p>;
  if (state === "ok" && fix) {
    const weak = fix.accuracyM > 100;
    return (
      <p className={`${base} ${weak ? "text-[var(--danger)]" : ""}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z" />
        </svg>
        {t(weak ? "r.loc_weak" : "r.loc_ok", lang, { m: fix.accuracyM })}
      </p>
    );
  }
  return null;
}

function ResultCard({ result, lang, onAgain }: { result: Result; lang: string; onAgain: () => void }) {
  const ok = result.status === "auto_ok";
  const review = result.status === "review";
  const headline = ok
    ? t("res.auto_ok", lang, { sats: result.rewardSats ?? 0 })
    : review
      ? result.label === "SATELLITE_MISSED"
        ? t("res.sat_missed", lang)
        : t("res.review", lang)
      : t("res.rejected", lang);
  const reason = result.status === "rejected" || result.status === "error" ? t(`code.${result.code}`, lang) : null;
  const checks = result.checks ?? {};
  const tone = ok ? "var(--ok)" : review ? "var(--water)" : "var(--danger)";
  return (
    <div
      role="status"
      aria-live="polite"
      className="slab rise relative flex flex-col gap-3 overflow-hidden p-4"
      style={{ borderColor: tone, boxShadow: `4px 4px 0 ${tone}` }}
    >
      {ok && (
        <p className="stamp font-display w-fit rounded-sm border-4 px-3 py-1 text-5xl leading-none" style={{ borderColor: tone, color: tone }}>
          +{result.rewardSats ?? 0} sats
        </p>
      )}
      <p className="text-xl font-bold">{headline}</p>
      {reason && <p>{reason.startsWith("code.") ? t("code.default", lang) : reason}</p>}
      <ul className="flex flex-col divide-y divide-[var(--hair)]">
        {CHECK_KEYS.filter((k) => k in checks && checks[k] !== null).map((k) => {
          const v = checks[k];
          const pass = k === "ai" ? Boolean((v as { water_visible?: boolean })?.water_visible) : v === true;
          const extra = k === "ai" ? ` · ${Math.round(((v as { confidence?: number })?.confidence ?? 0) * 100) / 100}` : "";
          return (
            <li key={k} className="flex items-center gap-3 py-1.5">
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-sm font-bold text-white"
                style={{ background: pass ? "var(--ok)" : "var(--danger)" }}
              >
                {pass ? "✓" : "✗"}
              </span>
              <span className="font-medium">
                {t(`chk.${k}`, lang)}
                {extra}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        {ok && (
          <Link href="/wallet" className="hivis inline-flex min-h-12 items-center rounded-sm px-4 font-bold">
            {t("res.wallet", lang)} →
          </Link>
        )}
        <button type="button" onClick={onAgain} className="inline-flex min-h-12 items-center rounded-sm border-2 border-[var(--fg)] px-4 font-bold">
          {t("res.again", lang)}
        </button>
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@sats/core/i18n";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { BigButton } from "@sats/ui";
import { useAppLang } from "../shell";
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

const DEPTH_ICON: Record<Depth, string> = { ankle: "🦶", knee: "🦵", waist: "🧍", impassable: "⛔" };
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

  return (
    <section className="flex w-full max-w-md flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">{t("r.title", lang)}</h1>

      {result && <ResultCard result={result} lang={lang} />}
      {notice && <p className="rounded-xl bg-[var(--surface-2)] p-3 font-medium">{notice}</p>}
      {waiting > 0 && <p className="text-sm text-[var(--muted)]">{t("r.queue_n", lang, { n: waiting })}</p>}

      <div className="flex flex-col gap-2">
        <p className="font-semibold">{t("r.photo", lang)}</p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
        {preview ? (
          <img src={preview} alt="" className="max-h-64 w-full rounded-xl object-cover" />
        ) : null}
        <BigButton variant={preview ? "secondary" : "primary"} onClick={() => fileRef.current?.click()} icon={<span aria-hidden>📷</span>}>
          {preview ? t("r.retake", lang) : t("r.photo", lang).replace(/^1\.\s*/, "")}
        </BigButton>
        <p className="text-sm text-[var(--muted)]">{t("r.no_faces", lang)}</p>
        <LocationLine state={locState} fix={fix} lang={lang} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-semibold">{t("r.depth", lang)}</p>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("r.depth", lang)}>
          {DEPTHS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={depth === d}
              onClick={() => setDepth(d)}
              className={`flex min-h-20 flex-col items-center justify-center rounded-xl border-2 text-lg font-semibold ${
                depth === d ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : "border-[var(--border)] bg-[var(--surface-2)]"
              }`}
            >
              <span aria-hidden className="text-2xl">
                {DEPTH_ICON[d]}
              </span>
              {t(`r.depth.${d}`, lang)}
            </button>
          ))}
        </div>
      </div>

      <BigButton onClick={submit} disabled={!photo || !depth || busy} className="min-h-16 text-xl">
        {busy ? t("r.sending", lang) : t("r.send", lang)}
      </BigButton>
    </section>
  );
}

function LocationLine({ state, fix, lang }: { state: string; fix: Fix | null; lang: string }) {
  if (state === "locating") return <p className="text-sm">{t("r.locating", lang)}</p>;
  if (state === "denied") return <p className="text-sm font-medium text-[var(--danger)]">{t("r.loc_denied", lang)}</p>;
  if (state === "ok" && fix) {
    const weak = fix.accuracyM > 100;
    return (
      <p className={`text-sm ${weak ? "font-medium text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        📍 {t(weak ? "r.loc_weak" : "r.loc_ok", lang, { m: fix.accuracyM })}
      </p>
    );
  }
  return null;
}

function ResultCard({ result, lang }: { result: Result; lang: string }) {
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
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-xl border-2 p-4 ${ok ? "border-green-600" : review ? "border-amber-500" : "border-[var(--danger)]"}`}
    >
      <p className="text-xl font-bold">{headline}</p>
      {reason && <p>{reason.startsWith("code.") ? t("code.default", lang) : reason}</p>}
      <ul className="flex flex-col gap-1">
        {CHECK_KEYS.filter((k) => k in checks && checks[k] !== null).map((k) => {
          const v = checks[k];
          const pass = k === "ai" ? Boolean((v as { water_visible?: boolean })?.water_visible) : v === true;
          const extra = k === "ai" ? ` ${Math.round(((v as { confidence?: number })?.confidence ?? 0) * 100) / 100}` : "";
          return (
            <li key={k} className="flex items-center gap-2">
              <span aria-hidden className={pass ? "text-green-600" : "text-[var(--danger)]"}>
                {pass ? "✓" : "✗"}
              </span>
              {t(`chk.${k}`, lang)}
              {extra}
            </li>
          );
        })}
      </ul>
      {ok && (
        <Link href="/wallet" className="font-semibold underline">
          {t("res.wallet", lang)} →
        </Link>
      )}
    </div>
  );
}

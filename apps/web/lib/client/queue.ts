/**
 * Offline queue. A report is signed BEFORE it is queued, so the signature carries the time it was made.
 * Items wait in IndexedDB and are retried with backoff. The server accepts events up to 6 h old, so older
 * items are dropped with a "too old to send" message. UNIQUE event_id makes a duplicate send harmless.
 */
import { createStore, del, entries, set } from "idb-keyval";

export type QueuedReport = {
  id: string;
  createdAt: number;
  fields: { event: string; lat: string; lon: string; accuracy_m: string };
  photo: Blob;
  attempts: number;
};

export type SendOutcome = { kind: "response"; body: Record<string, unknown> } | { kind: "network" } | { kind: "server" };

const MAX_AGE_SEC = 6 * 3600 - 120; // a little margin under the server window
const store = typeof indexedDB !== "undefined" ? createStore("ndox-queue", "reports") : undefined;

export async function sendReport(q: Pick<QueuedReport, "fields" | "photo">): Promise<SendOutcome> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(q.fields)) fd.append(k, v);
  fd.append("photo", new File([q.photo], "photo.jpg", { type: "image/jpeg" }));
  let res: Response;
  try {
    res = await fetch("/api/reports", { method: "POST", body: fd });
  } catch {
    return { kind: "network" };
  }
  if (res.status >= 500 || res.status === 429) return { kind: "server" };
  try {
    return { kind: "response", body: (await res.json()) as Record<string, unknown> };
  } catch {
    return { kind: "server" };
  }
}

export async function enqueue(q: QueuedReport): Promise<void> {
  if (store) await set(q.id, q, store);
}

export async function queued(): Promise<QueuedReport[]> {
  if (!store) return [];
  return (await entries<string, QueuedReport>(store)).map(([, v]) => v);
}

/** Try every queued report once. Returns server answers for those that got one, and how many were too old. */
export async function flushQueue(nowSec = Math.floor(Date.now() / 1000)): Promise<{ sent: Record<string, unknown>[]; tooOld: number; left: number }> {
  const sent: Record<string, unknown>[] = [];
  let tooOld = 0;
  let left = 0;
  for (const q of await queued()) {
    if (nowSec - q.createdAt > MAX_AGE_SEC) {
      await del(q.id, store);
      tooOld++;
      continue;
    }
    const r = await sendReport(q);
    if (r.kind === "response") {
      await del(q.id, store);
      sent.push(r.body);
    } else {
      await set(q.id, { ...q, attempts: q.attempts + 1 }, store);
      left++;
      if (r.kind === "network") break; // still offline; don't burn through the rest
    }
  }
  return { sent, tooOld, left };
}

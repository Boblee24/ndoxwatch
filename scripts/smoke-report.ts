/**
 * Smoke test over HTTP: signs a synthetic report and POSTs it to a running app.
 *   pnpm exec tsx scripts/smoke-report.ts <lat> <lon> [baseUrl]
 * Uses a fresh key and a synthetic image each run. For testing the server only; real reports come from a phone.
 */
import { makeJpeg, newReporter, signedReport } from "../apps/web/lib/reports/testkit";

const [latS, lonS, base = "http://localhost:3000"] = process.argv.slice(2);
const lat = Number(latS);
const lon = Number(lonS);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("usage: smoke-report.ts <lat> <lon> [baseUrl]");

const s = await signedReport({ sk: newReporter(), lat, lon, photo: await makeJpeg(Math.floor(Math.random() * 1e6)) });
const fd = new FormData();
for (const [k, v] of Object.entries(s.fields)) fd.append(k, v);
fd.append("photo", new File([s.photo.bytes], "photo.jpg", { type: "image/jpeg" }));
const post = () => fetch(`${base}/api/reports`, { method: "POST", body: fd });
const r1 = await post();
console.log(r1.status, JSON.stringify(await r1.json()));
const r2 = await post();
console.log("replay:", r2.status, JSON.stringify(await r2.json()));

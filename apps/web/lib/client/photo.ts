/**
 * On-device photo prep: downscale to ≤1024 px and re-encode as JPEG via canvas. The canvas re-encode
 * drops all EXIF (including GPS) before anything leaves the phone. Target ≈100–150 KB, hard cap 400 KB.
 */
const MAX_SIDE = 1024;
const MAX_BYTES = 400 * 1024;

export async function preparePhoto(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    for (const [side, q] of [
      [MAX_SIDE, 0.7],
      [MAX_SIDE, 0.55],
      [800, 0.5],
      [640, 0.45],
    ] as const) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("photo too large");
  } finally {
    bmp.close();
  }
}

export type Fix = { lat: number; lon: number; accuracyM: number };

export function getFix(timeoutMs = 15_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          // 7 decimals (~1 cm) is plenty and keeps the signed loc_commit reproducible from the sent strings.
          lat: Number(p.coords.latitude.toFixed(7)),
          lon: Number(p.coords.longitude.toFixed(7)),
          accuracyM: Math.round(p.coords.accuracy),
        }),
      reject,
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

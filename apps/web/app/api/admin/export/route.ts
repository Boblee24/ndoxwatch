import { NextResponse } from "next/server";
import { z } from "zod";
import { listReports } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
const query = z.object({ format: z.enum(["geojson", "csv"]).default("geojson") });

/** Quote every cell and neutralise spreadsheet formulas. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const formula = typeof v === "string" && /^[=+\-@\t\r]/.test(s);
  return `"${(formula ? `'${s}` : s).replace(/"/g, '""')}"`;
}

/** Precise export for the funder (admin only). */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const p = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ code: "BAD_INPUT" }, { status: 400 });
  const reports = await listReports(await getDb(), "all", 10_000);
  const stamp = new Date().toISOString().slice(0, 10);
  if (p.data.format === "csv") {
    const cols = ["id", "created_at", "lat", "lon", "accuracy_m", "depth", "status", "reject_code", "score", "zone_id", "satellite_missed"] as const;
    const lines = [
      cols.join(","),
      ...reports.map((r) => cols.map((c) => csvCell(c === "created_at" ? new Date(r.created_at * 1000).toISOString() : r[c])).join(",")),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ndoxwatch-reports-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  const fc = {
    type: "FeatureCollection",
    features: reports.map(({ lat, lon, ...props }) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props })),
  };
  return new NextResponse(JSON.stringify(fc), {
    headers: {
      "content-type": "application/geo+json",
      "content-disposition": `attachment; filename="ndoxwatch-reports-${stamp}.geojson"`,
      "cache-control": "no-store",
    },
  });
}

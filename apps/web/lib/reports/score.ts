/**
 * Step 7 scoring (pure). AI proposes, these rules decide. Rules apply in order; the first match wins.
 */
import type { Depth, ReportStatus } from "../db/schema";

export type AiPhotoCheck = {
  water_visible: boolean;
  est_depth: "none" | "ankle" | "knee" | "waist" | "impassable" | "unclear";
  outdoor: boolean;
  screen_or_print: boolean;
  confidence: number;
  flags: Array<"blurry" | "dark" | "people_identifiable" | "text_overlay" | "none">;
};

const ORDER: Depth[] = ["ankle", "knee", "waist", "impassable"];

/** Within one depth class. "none"/"unclear" never count as consistent. */
export function depthConsistent(reported: Depth, est: AiPhotoCheck["est_depth"]): boolean {
  const i = ORDER.indexOf(est as Depth);
  return i >= 0 && Math.abs(i - ORDER.indexOf(reported)) <= 1;
}

export type ScoreInput = { depth: Depth; accuracyM: number; inMask: boolean | null; ai: AiPhotoCheck | null };
export type ScoreResult = { score: number | null; max: number; status: ReportStatus; label?: "SATELLITE_MISSED"; rejectCode?: "SCREEN_OR_PRINT" | "NO_WATER" | "LOW_SCORE" };

export function scoreReport(i: ScoreInput): ScoreResult {
  const max = i.inMask === null ? 5 : 6;
  // No AI result (call failed / not yet wired): never auto-pay; a human looks.
  if (!i.ai) return { score: null, max, status: "review" };
  const ai = i.ai;
  // Hard rejects from the AI check (step 6).
  if (ai.screen_or_print) return { score: 0, max, status: "rejected", rejectCode: "SCREEN_OR_PRINT" };
  if (!ai.water_visible && ai.confidence >= 0.8) return { score: 0, max, status: "rejected", rejectCode: "NO_WATER" };

  let score = 0;
  if (ai.water_visible) score += 2;
  if (depthConsistent(i.depth, ai.est_depth)) score += 1;
  if (ai.outdoor) score += 1;
  if (i.accuracyM <= 50) score += 1;
  if (i.inMask === true) score += 1;

  if (i.inMask === false && ai.water_visible) return { score, max, status: "review", label: "SATELLITE_MISSED" };
  if (score >= max - 1) return { score, max, status: "auto_ok" };
  if (score >= max - 3) return { score, max, status: "review" };
  return { score, max, status: "rejected", rejectCode: "LOW_SCORE" };
}

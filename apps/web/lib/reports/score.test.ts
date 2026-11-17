import { describe, expect, it } from "vitest";
import { depthConsistent, scoreReport, type AiPhotoCheck } from "./score";

const ai = (o: Partial<AiPhotoCheck> = {}): AiPhotoCheck => ({
  water_visible: true,
  est_depth: "knee",
  outdoor: true,
  screen_or_print: false,
  confidence: 0.9,
  flags: ["none"],
  ...o,
});
const good = { depth: "knee" as const, accuracyM: 20 };

describe("depthConsistent", () => {
  it("allows one class of difference", () => {
    expect(depthConsistent("knee", "ankle")).toBe(true);
    expect(depthConsistent("knee", "waist")).toBe(true);
    expect(depthConsistent("ankle", "waist")).toBe(false);
    expect(depthConsistent("knee", "unclear")).toBe(false);
    expect(depthConsistent("ankle", "none")).toBe(false);
  });
});

describe("scoreReport: with a mask (max 6)", () => {
  it("rule 1: outside the mask with water → review 'Satellite missed?' even when the score would pass", () => {
    const r = scoreReport({ ...good, inMask: false, ai: ai() });
    expect(r).toMatchObject({ status: "review", label: "SATELLITE_MISSED", score: 5, max: 6 });
  });
  it("rule 2: score ≥ 5 → auto_ok", () => {
    expect(scoreReport({ ...good, inMask: true, ai: ai() })).toMatchObject({ status: "auto_ok", score: 6 });
    expect(scoreReport({ ...good, accuracyM: 80, inMask: true, ai: ai() })).toMatchObject({ status: "auto_ok", score: 5 });
  });
  it("rule 3: score 3–4 → review", () => {
    expect(scoreReport({ ...good, accuracyM: 80, inMask: true, ai: ai({ outdoor: false }) })).toMatchObject({ status: "review", score: 4 });
    expect(scoreReport({ ...good, accuracyM: 80, inMask: true, ai: ai({ outdoor: false, est_depth: "unclear" }) })).toMatchObject({
      status: "review",
      score: 3,
    });
  });
  it("rule 4: score < 3 → rejected LOW_SCORE", () => {
    const r = scoreReport({ ...good, accuracyM: 80, inMask: true, ai: ai({ water_visible: false, confidence: 0.5, outdoor: false }) });
    expect(r).toMatchObject({ status: "rejected", rejectCode: "LOW_SCORE", score: 2 });
  });
  it("outside the mask without water is not 'Satellite missed?'", () => {
    const r = scoreReport({ ...good, inMask: false, ai: ai({ water_visible: false, confidence: 0.5 }) });
    expect(r.label).toBeUndefined();
    expect(r).toMatchObject({ status: "review", score: 3 });
  });
});

describe("scoreReport: no mask coverage (in_mask null, max 5)", () => {
  it("rule 1 never fires", () => {
    expect(scoreReport({ ...good, inMask: null, ai: ai() }).label).toBeUndefined();
  });
  it("rule 2: score ≥ 4 → auto_ok (live demo zone can pay)", () => {
    expect(scoreReport({ ...good, inMask: null, ai: ai() })).toMatchObject({ status: "auto_ok", score: 5, max: 5 });
    expect(scoreReport({ ...good, accuracyM: 80, inMask: null, ai: ai() })).toMatchObject({ status: "auto_ok", score: 4 });
  });
  it("rule 3: score 2–3 → review", () => {
    expect(scoreReport({ ...good, accuracyM: 80, inMask: null, ai: ai({ outdoor: false }) })).toMatchObject({ status: "review", score: 3 });
    expect(scoreReport({ ...good, accuracyM: 80, inMask: null, ai: ai({ outdoor: false, est_depth: "unclear" }) })).toMatchObject({
      status: "review",
      score: 2,
    });
  });
  it("rule 4: score < 2 → rejected", () => {
    const r = scoreReport({ ...good, accuracyM: 80, inMask: null, ai: ai({ water_visible: false, confidence: 0.5, outdoor: false }) });
    expect(r).toMatchObject({ status: "rejected", rejectCode: "LOW_SCORE", score: 1 });
  });
});

describe("AI hard rejects and failures", () => {
  it("screen_or_print → rejected", () => {
    expect(scoreReport({ ...good, inMask: true, ai: ai({ screen_or_print: true }) })).toMatchObject({ status: "rejected", rejectCode: "SCREEN_OR_PRINT" });
  });
  it("confident no water → rejected", () => {
    expect(scoreReport({ ...good, inMask: null, ai: ai({ water_visible: false, confidence: 0.8 }) })).toMatchObject({
      status: "rejected",
      rejectCode: "NO_WATER",
    });
  });
  it("AI failure → review, never auto_ok", () => {
    expect(scoreReport({ ...good, inMask: true, ai: null })).toMatchObject({ status: "review", score: null });
    expect(scoreReport({ ...good, inMask: null, ai: null })).toMatchObject({ status: "review" });
  });
});

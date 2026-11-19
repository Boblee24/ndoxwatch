/** Step 6: AI photo check. Output is untrusted data: zod-validated, and it never sets an amount. */
import { z } from "zod";
import { extractJson, registerFixture } from "@sats/ai";
import type { AiPhotoCheck } from "./score";

export const aiPhotoSchema = z.object({
  water_visible: z.boolean(),
  est_depth: z.enum(["none", "ankle", "knee", "waist", "impassable", "unclear"]),
  outdoor: z.boolean(),
  screen_or_print: z.boolean(),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.enum(["blurry", "dark", "people_identifiable", "text_overlay", "none"])).max(4),
});

export const PHOTO_FIXTURE = "ndox_photo_check";
// AI_MOCK=1 (tests, offline demo): a clear knee-deep street flood.
registerFixture(PHOTO_FIXTURE, {
  water_visible: true,
  est_depth: "knee",
  outdoor: true,
  screen_or_print: false,
  confidence: 0.9,
  flags: ["none"],
} satisfies AiPhotoCheck);

const SYSTEM = `You check photos submitted as flood reports. Look only at the image.
- water_visible: is standing or flowing flood water visible on a street, yard, field or building?
- est_depth: how deep the water looks against people, vehicles, kerbs or walls (ankle, knee, waist, impassable), "none" if no water, "unclear" if you cannot tell.
- outdoor: is the photo taken outdoors?
- screen_or_print: is this a photo of a screen, TV, phone, printout, poster or meme rather than a real scene?
- confidence: 0-1, your confidence in water_visible.
- flags: blurry, dark, people_identifiable (a face can be recognised), text_overlay; ["none"] if none apply.`;

export type CheckPhotoFn = (jpeg: Uint8Array) => Promise<AiPhotoCheck | null>;

/** Returns null when the AI call fails: the pipeline then sends the report to review (never auto-pays). */
export const checkPhotoWithAi: CheckPhotoFn = async (jpeg) => {
  const r = await extractJson({
    schema: aiPhotoSchema,
    system: SYSTEM,
    parts: [{ image: { mime: "image/jpeg", base64: Buffer.from(jpeg).toString("base64") } }],
    // gemini-3.5-flash-lite answered in 4–13 s in pnpm eval (Nov 2026); 15 s sent ~1 in 6 reports to review.
    timeoutMs: 25_000,
    fixture: PHOTO_FIXTURE,
  });
  return r.ok ? r.data : null;
};

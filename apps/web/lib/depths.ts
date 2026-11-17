/** Client-safe constants (no drizzle import). */
export const DEPTHS = ["ankle", "knee", "waist", "impassable"] as const;
export type Depth = (typeof DEPTHS)[number];

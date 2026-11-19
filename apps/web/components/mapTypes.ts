/** Map constants/types without MapLibre, so pages can import them without pulling the lazy map chunk. */
export const DEPTH_COLORS = { ankle: "#8fd6f5", knee: "#0f8bd1", waist: "#0a4f7a", impassable: "#0c1a24" } as const;
export const DEPTH_LEGEND = Object.entries(DEPTH_COLORS) as Array<[keyof typeof DEPTH_COLORS, string]>;
export type MapCell = { geohash5: string; count: number; max_depth: keyof typeof DEPTH_COLORS };
export type MapPoint = { id: string; lat: number; lon: number; depth: string; status: string; satellite_missed: boolean };

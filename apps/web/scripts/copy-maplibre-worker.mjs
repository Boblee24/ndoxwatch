// Copies MapLibre's web worker into public/ so it is served same-origin (worker-src 'self').
// Needed because bundling breaks MapLibre's import.meta.url-relative worker lookup. Runs on predev/prebuild.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), "public/vendor/maplibre-gl-worker.mjs");
// eslint-disable-next-line no-console -- build script output
console.log("✓ copied maplibre-gl-worker.mjs → public/vendor/");

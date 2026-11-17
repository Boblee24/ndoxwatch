import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
    // Several files boot PGlite + PostGIS in parallel; give hooks/tests headroom on slower laptops and CI.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: { AI_MOCK: "1" },
  },
});

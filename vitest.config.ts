import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [react(), svgr()],
  test: {
    // Colocated unit/component tests plus the central integration slice.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // jsdom per-file for component tests via `<script @vitest-environment jsdom>`.
    pool: "forks",
  },
});

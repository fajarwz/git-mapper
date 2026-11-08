import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { gitDevApi } from "./dev/gitApi/index.ts";
const host = process.env.TAURI_DEV_HOST;
// `tauri dev` hard-wires its devUrl to port 1420, so under the Tauri CLI the port must stay
// fixed: drifting to 1421 would leave the window loading whatever else answers 1420. A plain
// `npm run dev` (browser work, headless probes) may step to the next free port instead.
const underTauriCli = process.env.TAURI_ENV_PLATFORM !== undefined;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), svgr(), gitDevApi()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri's window loads http://localhost:1420, so under `tauri dev` fail rather than drift
  //    to another port and quietly show a different server
  server: {
    port: 1420,
    strictPort: underTauriCli,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

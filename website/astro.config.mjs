import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://gitmapper.fajarwz.com",
  integrations: [react()],
  // The stylesheet is ~6 KiB on a one-page site: inline it so it never blocks first paint.
  build: { inlineStylesheets: "always" },
  vite: {
    plugins: [tailwindcss()],
  },
});

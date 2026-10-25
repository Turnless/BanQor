import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // relative asset paths so the static build works on Vercel and GitHub Pages sub-paths
  base: "./",
  // read the repo-root .env; Vite only exposes VITE_* variables to the browser, never keys
  envDir: "../..",
  server: { fs: { allow: ["../.."] } },
  // one viem for the app and @banqor/sdk, so errors decode across both (and the bundle carries one copy)
  resolve: { dedupe: ["viem"] },
  build: {
    // two pages: the landing page (index.html) and the dashboard app (app.html)
    rollupOptions: { input: { landing: resolve(__dirname, "index.html"), app: resolve(__dirname, "app.html") } },
  },
});

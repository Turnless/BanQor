import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // relative asset paths so the static build works on Vercel and GitHub Pages sub-paths
  base: "./",
  // read the repo-root .env; Vite only exposes VITE_* variables to the browser, never keys
  envDir: "../..",
  server: { fs: { allow: ["../.."] } },
});

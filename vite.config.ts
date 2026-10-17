import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site is served from https://lr00rl.github.io/tls-companion/.
export default defineConfig({
  base: "/tls-companion/",
  plugins: [react()],
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});

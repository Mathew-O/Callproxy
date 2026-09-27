import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 127.0.0.1 rather than localhost: on Windows, Node resolves localhost to ::1 first.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  // GitHub Pages serves the static demo from /Callproxy/.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/calls": backend,
      "/config": backend,
      "/health": backend,
      "/voices": backend,
      "/tts": backend,
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});

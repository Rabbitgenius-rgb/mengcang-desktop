import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import discoveryVite from "./discovery-vite.mjs";
import pdfAssets from "./pdf-assets.mjs";
import webCaptureVite from "./web-capture-vite.mjs";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "motion/react"],
  },
  server: {
    host: "127.0.0.1",
    port: 4191,
    strictPort: true,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(),discoveryVite(),webCaptureVite(),pdfAssets()],
});

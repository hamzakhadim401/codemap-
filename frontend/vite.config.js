import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Dev server: proxy API calls to the running Python server
  server: {
    proxy: {
      "/projects": "http://localhost:8000",
      "/auth":     "http://localhost:8000",
      "/health":   "http://localhost:8000",
      "/sync":     "http://localhost:8000",
      "/webhook":  "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

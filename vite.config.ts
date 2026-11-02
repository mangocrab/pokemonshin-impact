import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";
import marketSeriesHandler from "./api/market-series.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "local-market-series-api",
      configureServer(server) {
        server.middlewares.use("/api/market-series", marketSeriesHandler);
      },
    },
    {
      ...mdx(),
      enforce: "pre",
    },
    react(),
    tailwindcss(),
  ],
});

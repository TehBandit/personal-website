import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";
import blogSearchPlugin from "./scripts/blog-search-plugin.mjs";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    blogSearchPlugin(),
    {
      ...mdx(),
      enforce: "pre",
    },
    react(),
    tailwindcss(),
  ],
});

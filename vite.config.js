import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";

// https://vite.dev/config/
export default defineConfig({
  server: {
    watch: {
      ignored: [
        "**/workspaces/**",
      ],
    },
  },
  plugins: [
    {
      ...mdx(),
      enforce: "pre",
    },
    react(),
    tailwindcss(),
  ],
});
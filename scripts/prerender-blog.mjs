import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { renderHead, sitemap } from "../src/seo/blog-seo.js";

const repository = fileURLToPath(new URL("../", import.meta.url));

export async function prerenderBlog({ outputDirectory = path.join(repository, "dist"), template } = {}) {
  template ??= await readFile(path.join(outputDirectory, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>') || !/<title>[\s\S]*?<\/title>/.test(template)) {
    throw new Error("Expected the Vite HTML template with an empty React root and title.");
  }
  // Middleware mode does not listen on a port. Load the existing application
  // components for static rendering; the deployment stays entirely static.
  const server = await createServer({
    root: repository, configFile: false, plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom", logLevel: "error",
  });
  try {
    const { blogPages, renderBlogPage, posts } = await server.ssrLoadModule("/src/seo/blog-prerender.jsx");
    const pages = blogPages();
    for (const page of pages) {
      const html = template.replace(/<title>[\s\S]*?<\/title>/, () => renderHead(page.metadata))
        .replace('<div id="root"></div>', () => `<div id="root" data-prerendered="true">${renderBlogPage(page.path)}</div>`);
      const directory = path.join(outputDirectory, ...page.path.split("/").filter(Boolean));
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "index.html"), html, "utf8");
    }
    await writeFile(path.join(outputDirectory, "sitemap.xml"), sitemap(posts), "utf8");
    return pages.map(({ path }) => path);
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = await prerenderBlog();
  console.log(`Pre-rendered ${paths.length} blog pages and generated sitemap.xml.`);
}

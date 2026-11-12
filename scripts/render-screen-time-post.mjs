import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithEsbuild } from "vite";

// Render only the article for offline review. This does not build the website,
// start a server, publish content, or execute any native app workflow.
const repository = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = path.join(repository, "src/blogposts/ScreenTimePost.jsx");
const cssPath = path.join(repository, "src/blogposts/ScreenTimePost.css");
const [source, css] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(cssPath, "utf8"),
]);
const require = createRequire(import.meta.url);
const reactURL = pathToFileURL(require.resolve("react")).href;
const jsx = source.replace('import "./ScreenTimePost.css";', "");
const { code } = await transformWithEsbuild(jsx, sourcePath, {
  loader: "jsx",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
});
const moduleURL = `data:text/javascript;base64,${Buffer.from(
  `import React from ${JSON.stringify(reactURL)};\n${code}`,
).toString("base64")}`;
const { default: Post, meta } = await import(moduleURL);
const article = renderToStaticMarkup(React.createElement(Post));
const plainText = article.replace(/<[^>]*>/g, " ");
const wordCount = plainText.trim().split(/\s+/).length;
const readMinutes = Math.ceil(wordCount / 230);
const fingerprint = createHash("sha256").update(source).update(css).digest("hex");
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="description" content="${escapeHTML(meta.desc)}">
  <meta name="draft-source-sha256" content="${fingerprint}">
  <title>Review draft — ${escapeHTML(meta.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html { scroll-padding-top: 1.5rem; }
    body { margin: 0; color: #202936; background: #f8fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .review-banner { padding: 0.85rem 1.5rem; background: #eaf2f8; color: #234763; border-bottom: 1px solid #ccdce8; font-size: 0.9rem; text-align: center; }
    .review-banner strong { margin-right: 0.5rem; }
    main { max-width: 58rem; margin: 2.5rem auto; padding: 3.5rem 3rem 1rem; background: #fff; border: 1px solid #e0e7ed; border-top: 3px solid #175c99; }
    .post-heading { max-width: 48rem; margin: 0 auto 2.2rem; padding-bottom: 2rem; border-bottom: 1px solid #d5dfe7; }
    .post-heading .eyebrow { color: #526174; text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.75rem; font-weight: 700; }
    .post-heading h1 { font-size: clamp(2rem, 4.5vw, 3rem); line-height: 1.14; letter-spacing: -0.035em; margin: 1rem 0; overflow-wrap: anywhere; }
    .post-heading .description { color: #526174; font-size: 1.15rem; line-height: 1.65; }
    .post-heading .metadata { color: #526174; font-size: 0.875rem; margin-top: 1.3rem; }
    .screen-time-post { font-size: 1.25rem; line-height: 1.75rem; }
    .review-footer { max-width: 48rem; margin: 0 auto 2rem; border-top: 1px solid #d5dfe7; padding-top: 1rem; color: #526174; font-size: 0.85rem; line-height: 1.7; }
    @media (max-width: 640px) {
      main { margin: 0; padding: 2rem 1.1rem 1rem; border-left: 0; border-right: 0; }
      .review-banner { text-align: left; padding: 0.8rem 1.1rem; }
    }
    @media print {
      .review-banner, .review-footer { display: none; }
      body { background: #fff; }
      main { margin: 0; padding: 0; max-width: none; border: 0; }
    }
    ${css}
  </style>
</head>
<body>
  <aside class="review-banner"><strong>Local review draft</strong> Prepared for approval. Nothing has been pushed, merged, or published.</aside>
  <main>
    <header class="post-heading">
      <div class="eyebrow">Development · Due or Die</div>
      <h1>${escapeHTML(meta.title)}</h1>
      <p class="description">${escapeHTML(meta.desc)}</p>
      <p class="metadata"><time datetime="${meta.date}">November 11, 2026</time> · ${readMinutes} minute read · iOS / Swift / Expo</p>
    </header>
    ${article}
    <footer class="review-footer">This preview renders the same article component and article styles prepared for the blog. The review banner and this note are preview-only. The website’s navigation and page heading are supplied by its existing blog layout.</footer>
  </main>
</body>
</html>
`;
const outputDirectory = path.join(repository, ".build-in-public-preview");
const outputPath = path.join(outputDirectory, "screen-time-timed-access.html");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(JSON.stringify({ outputPath, wordCount, readMinutes, sourceSHA256: fingerprint }, null, 2));

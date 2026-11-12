import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "@babel/parser";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import blogSearchPlugin, { extractArticleText } from "./blog-search-plugin.mjs";
import { createSearchIndex, filterPosts } from "../src/utils/blogSearch.js";

test("JSX indexing includes article text, entities, inline code and code blocks, excluding source details", () => {
  const source = 'const meta = { slug: "private-slug" }; export default function Post() { return <article className="private-class"><p>Fish &amp; chips with <strong>friends</strong>{" tonight"}</p>{/* private-comment */}<pre>{`let timer = 60;`}</pre><a href="/private-url">read more</a></article>; }';
  const text = extractArticleText(source);
  assert.match(text, /Fish & chips with friends tonight/);
  assert.match(text, /let timer = 60/);
  assert.match(text, /read more/);
  assert.doesNotMatch(text, /private-|className|export default/);
  const plugin = blogSearchPlugin();
  const result = plugin.transform(source, "D:\\personal-website\\src\\blogposts\\Example.jsx");
  assert.match(result.code, /export const searchText =/);
  assert.doesNotThrow(() => parse(result.code, { sourceType: "module", plugins: ["jsx"] }));
  assert.equal(plugin.transform(source, "/src/pages/Blog.jsx"), null);
});

const articles = [
  { meta: { title: "Screen Time", desc: "Timers", tag: "Development" }, searchText: "AuthorizationCenter restores permissions" },
  { meta: { title: "New York", desc: "Moving", tag: "Personal" }, searchText: "A housewarming party in Brooklyn" },
  { meta: { title: "Weekly update", tag: "Development" }, projects: [{ name: "Due or Die", bullets: [{ text: "Improved reminders" }], summary: { text: "No stale notifications" } }] },
  { meta: { title: "A small note" } },
];
const index = createSearchIndex(articles);

test("tags use OR, search combines with tags, and clearing filters restores the original order", () => {
  assert.deepEqual(filterPosts(index, "", ["Personal"]), [articles[1]]);
  assert.deepEqual(filterPosts(index, "", ["Development", "Personal"]), articles.slice(0, 3));
  assert.deepEqual(filterPosts(index, "Brooklyn", ["Personal", "Development"]), [articles[1]]);
  assert.deepEqual(filterPosts(index, "Brooklyn", ["Development"]), []);
  assert.deepEqual(filterPosts(index, "  \n ", []), articles);
  assert.deepEqual(filterPosts(index, "", ["General"]), [articles[3]]);
});

test("search matches case-insensitive terms across metadata, full articles and generated devlogs", () => {
  for (const query of ["SCREEN TIME", "timers", "AuthorizationCenter", " restores   permissions "]) {
    assert.deepEqual(filterPosts(index, query, []), [articles[0]]);
  }
  for (const query of ["Due or Die", "reminders", "stale notifications"]) {
    assert.deepEqual(filterPosts(index, query, []), [articles[2]]);
  }
  assert.deepEqual(filterPosts(index, "development", []), [articles[0], articles[2]]);
  assert.deepEqual(filterPosts(index, "does-not-exist", []), []);
});

test("real JSX articles and generated posts expose body-only text without maintaining a separate index", async () => {
  const directory = new URL("../src/blogposts/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".jsx"))) {
    const source = await readFile(new URL(file, directory), "utf8");
    assert(extractArticleText(source).length > 100, `${file} must expose its article body`);
  }
  const source = await readFile(new URL("ScreenTimePost.jsx", directory), "utf8");
  const post = { meta: { title: "Example" }, searchText: extractArticleText(source) };
  assert.deepEqual(filterPosts(createSearchIndex([post]), "grant_ineligible", []), [post]);
  const generated = JSON.parse(await readFile(new URL("generated/2026-08-16.json", directory), "utf8"));
  assert.deepEqual(filterPosts(createSearchIndex([generated]), "stale notifications", []), [generated]);
});

test("Vite supplies searchable article bodies and the blog initially renders every post", { timeout: 30000 }, async () => {
  // Module loading only: no listening HTTP server and no build output.
  const server = await createServer({
    configFile: false,
    plugins: [blogSearchPlugin(), react()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const { posts } = await server.ssrLoadModule("/src/blogposts/index.js");
    const { default: Blog } = await server.ssrLoadModule("/src/pages/Blog.jsx");
    const results = filterPosts(createSearchIndex(posts), "grant_ineligible", ["Development"]);
    assert(results.some((post) => post.meta.slug === "ios-screen-time-timed-access"));
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/blog" }, createElement(Blog)));
    assert.match(html, /id="blog-search"/);
    assert.match(html, /aria-pressed="true"[^>]*>all posts/);
    assert.match(html, /aria-live="polite"/);
    for (const post of posts) assert(html.includes(`href="/blog/${post.meta.slug}"`));
  } finally {
    await server.close();
  }
});

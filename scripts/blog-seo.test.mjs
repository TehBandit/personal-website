import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { blogMetadata, blogPath, isoDate, jsonLD, renderHead, sitemap } from "../src/seo/blog-seo.js";
import { prerenderBlog } from "./prerender-blog.mjs";

const post = {
  meta: {
    title: "Screen Time shields and timers", seoTitle: "iOS Screen Time API troubleshooting",
    slug: "ios-screen-time-timed-access", desc: "Real authorization and timer fixes.",
    date: "2026-11-12", modified: "2026-11-12", tag: "Development",
    socialImage: "/social/ios-screen-time-timed-access.png",
    socialImageAlt: "Screen Time troubleshooting", socialImageWidth: 1200, socialImageHeight: 630,
  },
};

test("canonical URLs and schema use the visible article, real dates, author, and image", () => {
  const metadata = blogMetadata(post);
  assert.equal(metadata.url, "https://www.marcustaylor.org/blog/ios-screen-time-timed-access");
  assert.equal(metadata.title, post.meta.seoTitle);
  const article = metadata.structuredData["@graph"][0];
  assert.equal(article.headline, post.meta.title);
  assert.equal(article.author.name, "Marcus Taylor");
  assert.equal(article.datePublished, "2026-11-12");
  assert.equal(article.dateModified, "2026-11-12");
  assert.equal(article.image[0], "https://www.marcustaylor.org/social/ios-screen-time-timed-access.png");
  const html = renderHead(metadata);
  assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
  assert.match(html, /name="robots" content="index, follow, max-image-preview:large"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, 1);
});

test("untrusted text cannot break out of metadata or JSON-LD", () => {
  const malicious = structuredClone(post);
  malicious.meta.title = '</script><script>alert("x")</script>';
  malicious.meta.seoTitle = 'An "article" <script>';
  const head = renderHead(blogMetadata(malicious));
  assert.match(head, /&quot;article&quot; &lt;script&gt;/);
  assert.equal((head.match(/<script\b/g) ?? []).length, 1);
  assert.equal(JSON.parse(jsonLD({ text: malicious.meta.title })).text, malicious.meta.title);
  assert.throws(() => blogPath("../private"));
  assert.throws(() => blogPath("article?utm_source=spam"));
});

test("legacy dates normalize without timezone drift and invalid dates are omitted", () => {
  assert.equal(isoDate("8/26/2025"), "2025-08-26");
  assert.equal(isoDate("2026-11-12"), "2026-11-12");
  assert.equal(isoDate("2/30/2026"), undefined);
  assert.equal(isoDate("not a date"), undefined);
  const older = structuredClone(post);
  delete older.meta.modified;
  assert.equal("dateModified" in blogMetadata(older).structuredData["@graph"][0], false);
});

test("sitemap and index schema discover posts without exposing private or API routes", () => {
  const xml = sitemap([post]);
  assert.match(xml, /<loc>https:\/\/www\.marcustaylor\.org\/blog\/ios-screen-time-timed-access<\/loc>/);
  assert.match(xml, /<lastmod>2026-11-12<\/lastmod>/);
  assert.doesNotMatch(xml, /\/bookclub\/v\/|\/oauth\/|\/api\//);
  const index = blogMetadata(undefined, [post]).structuredData["@graph"][0];
  assert.equal(index.mainEntity.itemListElement[0].url, blogMetadata(post).url);
});

test("production components export crawlable blog HTML and internal links without client JavaScript", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blog-seo-test-"));
  try {
    const paths = await prerenderBlog({
      outputDirectory: directory,
      template: '<!doctype html><html lang="en"><head><title>mingus</title></head><body><div id="root"></div></body></html>',
    });
    assert(paths.includes("/blog/ios-screen-time-timed-access"));
    const article = await readFile(path.join(directory, "blog/ios-screen-time-timed-access/index.html"), "utf8");
    assert.match(article, /data-prerendered="true"/);
    assert.match(article, /<h1[^>]*>[^<]*Debugging iOS Screen Time/);
    assert.match(article, /grant_ineligible/);
    assert.match(article, /App Group storage/);
    assert.doesNotMatch(article, /Local review draft|noindex|source-sha256/);
    assert.equal((article.match(/rel="canonical"/g) ?? []).length, 1);
    assert.equal((article.match(/<h1\b/g) ?? []).length, 1);
    assert.match(article, /<main\b/);
    const schema = article.match(/<script[^>]*type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.equal(JSON.parse(schema[1])["@graph"][0]["@type"], "BlogPosting");
    const index = await readFile(path.join(directory, "blog/index.html"), "utf8");
    assert.match(index, /href="\/blog\/ios-screen-time-timed-access"/);
    const related = await readFile(path.join(directory, "blog/grocery-battle/index.html"), "utf8");
    assert.match(related, /href="\/blog\/ios-screen-time-timed-access"/);
    const xml = await readFile(path.join(directory, "sitemap.xml"), "utf8");
    assert.match(xml, /ios-screen-time-timed-access/);
    assert.equal((xml.match(/<loc>/g) ?? []).length, paths.length + 7);
  } finally {
    assert(directory.startsWith(path.join(tmpdir(), "blog-seo-test-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("social preview asset matches its published dimensions", async () => {
  const image = await readFile(new URL("../public/social/ios-screen-time-timed-access.png", import.meta.url));
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

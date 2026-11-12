export const SITE_URL = "https://www.marcustaylor.org";
export const AUTHOR_NAME = "Marcus Taylor";
export const DEFAULT_TITLE = "mingus";

export function isoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  const legacy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? "");
  if (!match && !legacy) return undefined;
  const [year, month, day] = match
    ? match.slice(1).map(Number)
    : [Number(legacy[3]), Number(legacy[1]), Number(legacy[2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

export function blogPath(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? "")) throw new Error("Invalid blog slug");
  return `/blog/${slug}`;
}

function imageURL(image) {
  if (!image) return undefined;
  const url = new URL(image, SITE_URL);
  return url.protocol === "https:" ? url.href : undefined;
}

export function blogMetadata(post, posts = []) {
  const path = post ? blogPath(post.meta.slug) : "/blog";
  const url = SITE_URL + path;
  const title = post
    ? post.meta.seoTitle ?? `${post.meta.title} | ${AUTHOR_NAME}`
    : `Development Blog and Project Notes | ${AUTHOR_NAME}`;
  const description = post
    ? post.meta.desc
    : "Technical write-ups, debugging stories, and build-in-public notes from Marcus Taylor's apps and independent software projects.";
  const image = post ? imageURL(post.meta.socialImage ?? post.meta.headerPhotos?.[0]) : undefined;
  const datePublished = post ? isoDate(post.meta.date) : undefined;
  const dateModified = post ? isoDate(post.meta.modified) : undefined;
  const author = post?.meta.author ?? AUTHOR_NAME;
  const breadcrumbs = [
    { "@type": "ListItem", position: 1, name: AUTHOR_NAME, item: SITE_URL + "/" },
    { "@type": "ListItem", position: 2, name: "Blog", item: SITE_URL + "/blog" },
    ...(post ? [{ "@type": "ListItem", position: 3, name: post.meta.title, item: url }] : []),
  ];
  const entity = post ? {
    "@type": "BlogPosting",
    "@id": url + "#article",
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: post.meta.title,
    description,
    author: { "@type": "Person", name: author, url: SITE_URL + "/resume" },
    publisher: { "@type": "Person", name: AUTHOR_NAME, url: SITE_URL + "/" },
    inLanguage: "en-US",
    articleSection: post.meta.tag,
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(image ? { image: [image] } : {}),
  } : {
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: title,
    description,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((entry, index) => ({
        "@type": "ListItem", position: index + 1, name: entry.meta.title,
        url: SITE_URL + blogPath(entry.meta.slug),
      })),
    },
  };
  return {
    title, description, url, type: post ? "article" : "website", image,
    imageAlt: post?.meta.socialImageAlt ?? post?.meta.title,
    imageWidth: post?.meta.socialImageWidth,
    imageHeight: post?.meta.socialImageHeight,
    datePublished, dateModified, author: post ? author : undefined,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [entity, { "@type": "BreadcrumbList", itemListElement: breadcrumbs }],
    },
  };
}

export function headElements(metadata) {
  const meta = (name, content, property = false) => ({
    tag: "meta", attributes: { [property ? "property" : "name"]: name, content },
  });
  return [
    meta("description", metadata.description),
    meta("robots", "index, follow, max-image-preview:large"),
    { tag: "link", attributes: { rel: "canonical", href: metadata.url } },
    meta("og:type", metadata.type, true),
    meta("og:title", metadata.title, true),
    meta("og:description", metadata.description, true),
    meta("og:url", metadata.url, true),
    meta("og:site_name", AUTHOR_NAME, true),
    meta("twitter:card", metadata.image ? "summary_large_image" : "summary"),
    meta("twitter:title", metadata.title),
    meta("twitter:description", metadata.description),
    ...(metadata.author ? [meta("author", metadata.author)] : []),
    ...(metadata.datePublished ? [meta("article:published_time", metadata.datePublished, true)] : []),
    ...(metadata.dateModified ? [meta("article:modified_time", metadata.dateModified, true)] : []),
    ...(metadata.image ? [
      meta("og:image", metadata.image, true),
      meta("og:image:alt", metadata.imageAlt, true),
      meta("twitter:image", metadata.image),
      meta("twitter:image:alt", metadata.imageAlt),
      ...(metadata.imageWidth ? [meta("og:image:width", String(metadata.imageWidth), true)] : []),
      ...(metadata.imageHeight ? [meta("og:image:height", String(metadata.imageHeight), true)] : []),
    ] : []),
  ];
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function jsonLD(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderHead(metadata) {
  return [
    `<title>${escapeHTML(metadata.title)}</title>`,
    ...headElements(metadata).map(({ tag, attributes }) =>
      `<${tag} data-blog-seo="" ${Object.entries(attributes).map(([key, value]) => `${key}="${escapeHTML(value)}"`).join(" ")}>`),
    `<script data-blog-seo="" type="application/ld+json">${jsonLD(metadata.structuredData)}</script>`,
  ].join("\n    ");
}

export function sitemap(posts) {
  const paths = ["/", "/blog", "/resume", "/contact", "/grocerybattle", "/bookclub", "/bookclub/support", "/bookclub/privacy"];
  const entries = [
    ...paths.map((path) => ({ path })),
    ...posts.map(({ meta }) => ({ path: blogPath(meta.slug), modified: isoDate(meta.modified ?? meta.date) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(({ path, modified }) =>
    `  <url><loc>${escapeHTML(SITE_URL + path)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}

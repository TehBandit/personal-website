import { useEffect } from "react";
import { blogMetadata, DEFAULT_TITLE, headElements, jsonLD } from "../seo/blog-seo.js";

export default function BlogSeo({ post, posts }) {
  const serialized = JSON.stringify(blogMetadata(post, posts));
  useEffect(() => {
    const metadata = JSON.parse(serialized);
    // Replace the same server-rendered tags on hydration and update them during
    // client navigation. Cleanup prevents article metadata leaking into other pages.
    document.head.querySelectorAll("[data-blog-seo]").forEach((element) => element.remove());
    document.title = metadata.title;
    const elements = headElements(metadata).map(({ tag, attributes }) => {
      const element = document.createElement(tag);
      element.setAttribute("data-blog-seo", "");
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    });
    const schema = document.createElement("script");
    schema.type = "application/ld+json";
    schema.setAttribute("data-blog-seo", "");
    schema.textContent = jsonLD(metadata.structuredData);
    elements.push(schema);
    document.head.append(...elements);
    return () => {
      elements.forEach((element) => element.remove());
      document.title = DEFAULT_TITLE;
    };
  }, [serialized]);
  return null;
}

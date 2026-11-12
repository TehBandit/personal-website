import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "../App.jsx";
import { posts } from "../blogposts/index.js";
import { blogMetadata, blogPath } from "./blog-seo.js";

export { posts };

export function blogPages() {
  return [
    { path: "/blog", metadata: blogMetadata(undefined, posts) },
    ...posts.map((post) => ({ path: blogPath(post.meta.slug), metadata: blogMetadata(post) })),
  ];
}

export function renderBlogPage(path) {
  return renderToString(
    <StrictMode>
      <StaticRouter location={path}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}

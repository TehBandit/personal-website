// src/posts/index.js
// Import all .jsx files in this folder
const modules = import.meta.glob("./*.jsx", { eager: true });
const generatedModules = import.meta.glob("./generated/*.json", {
  eager: true,
  import: "default",
});

const generatedPosts = Object.values(generatedModules).map((post) => ({
  generated: true,
  blocks: post.blocks,
  meta: {
    ...post.meta,
    desc: post.meta.description,
  },
}));

export const posts = [...Object.values(modules), ...generatedPosts].sort(
  (a, b) => new Date(b.meta.date) - new Date(a.meta.date)
);

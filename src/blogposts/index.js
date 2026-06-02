// src/posts/index.js
// Import all .jsx files in this folder
const modules = import.meta.glob("./*.jsx", { eager: true });

export const posts = Object.values(modules).sort(
  (a, b) => new Date(b.meta.date) - new Date(a.meta.date)
);

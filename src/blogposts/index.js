// src/posts/index.js
// Import all .jsx files in this folder
const modules = import.meta.glob("./*.jsx", { eager: true });

export const posts = Object.values(modules);
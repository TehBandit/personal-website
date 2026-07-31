import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, repositoryRoot } from "./config.mjs";
import { assertValidGeneratedPost } from "./validate.mjs";

async function findJsonFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJsonFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
  return files;
}

const config = await loadConfig();
const requested = process.argv.slice(2).map((entry) => path.resolve(entry));
const files = requested.length > 0
  ? requested
  : await findJsonFiles(path.join(repositoryRoot, "src/blogposts/generated"));

const slugs = new Map();

for (const file of files) {
  const post = JSON.parse(await fs.readFile(file, "utf8"));
  assertValidGeneratedPost(post, {
    config,
    requireGrounding: false,
  });
  const expectedFileName = `${post.meta.date}.json`;
  if (path.basename(file) !== expectedFileName) {
    throw new Error(`${file} must be named ${expectedFileName}.`);
  }
  if (slugs.has(post.meta.slug)) {
    throw new Error(`${file} duplicates slug ${post.meta.slug} from ${slugs.get(post.meta.slug)}.`);
  }
  slugs.set(post.meta.slug, file);
}

console.log(`Validated ${files.length} generated blog post${files.length === 1 ? "" : "s"}.`);

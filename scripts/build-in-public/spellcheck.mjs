import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./config.mjs";

function findJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
  });
}

const requested = process.argv.slice(2).map((entry) => path.resolve(entry));
const files = requested.length > 0
  ? requested
  : findJsonFiles(path.join(repositoryRoot, "src/blogposts/generated"));

if (files.length === 0) {
  console.log("No generated blog posts to spellcheck.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(repositoryRoot, "node_modules/cspell/bin.mjs"),
    "--config",
    path.join(repositoryRoot, "cspell.json"),
    "--no-progress",
    "--no-summary",
    "--show-suggestions",
    ...files,
  ],
  { cwd: repositoryRoot, stdio: "inherit" }
);
process.exit(result.status ?? 1);

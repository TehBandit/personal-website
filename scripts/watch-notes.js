/**
 * watch-notes.js
 * --------------
 * Watches notes-raw/ for file saves and automatically runs seed-graph.js
 * in --update mode for whichever file was changed.
 *
 * Run with:
 *   node --env-file=.env.local scripts/watch-notes.js
 *   node --env-file=.env.local scripts/watch-notes.js --workspace=my-world
 *   npm run watch-notes
 */

import chokidar from "chokidar";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Resolve workspace from --workspace=<slug> arg (defaults to veldmoor-chronicles)
const wsArg = process.argv.find((a) => a.startsWith("--workspace="));
const WORKSPACE = wsArg ? wsArg.split("=")[1] : "veldmoor-chronicles";
if (!/^[a-z0-9-]+$/.test(WORKSPACE)) {
  console.error(`[watch] Invalid workspace slug "${WORKSPACE}". Use lowercase letters, numbers, and hyphens.`);
  process.exit(1);
}
const NOTES_RAW_DIR = path.join(ROOT, "workspaces", WORKSPACE); // workspace root
const NOTES_DIR = path.join(NOTES_RAW_DIR, "notes"); // output dir to ignore

/**
 * Recursively collect all .txt relative paths under `dir`, skipping excluded dirs.
 */
function getAllTxtRelPaths(dir, base = dir, exclude = new Set()) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (exclude.has(full)) continue;
      if (entry.isDirectory()) results.push(...getAllTxtRelPaths(full, base, exclude));
      else if (entry.name.endsWith(".txt")) results.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

// Debounce per-file so rapid successive saves don't queue multiple runs
const timers = new Map();
const DEBOUNCE_MS = 500;

// Cache of last plain-text content seen per filename — used to skip
// seed-graph when only markdown formatting changed (bold, italic, etc.)
const plainTextCache = new Map();

/**
 * Strip markdown syntax to get the semantic plain-text content.
 * Covers bold, italic, code, headings, links, blockquotes, list markers.
 */
function stripMarkdown(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "")           // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links → anchor text
    .replace(/`{1,3}[^`]*`{1,3}/g, "")         // inline & fenced code
    .replace(/^```[\s\S]*?^```/gm, "")          // fenced code blocks
    .replace(/^#{1,6}\s+/gm, "")               // headings
    .replace(/^>\s+/gm, "")                     // blockquotes
    .replace(/^[-*+]\s+/gm, "")                // unordered list markers
    .replace(/^\d+\.\s+/gm, "")                // ordered list markers
    .replace(/(\*\*|__)(.*?)\1/g, "$2")         // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")            // italic
    .replace(/~~(.*?)~~/g, "$1")                // strikethrough
    .replace(/[-*_]{3,}/g, "")                  // horizontal rules
    .replace(/\s+/g, " ")                        // collapse whitespace
    .trim();
}

function runUpdate(filename) {
  console.log(`\n[watch] Change detected: ${filename}`);
  console.log(`[watch] Running: seed-graph.js --update ${filename} --workspace=${WORKSPACE}\n`);

  const child = spawn(
    process.execPath,
    ["--env-file=.env.local", "scripts/seed-graph.js", "--update", filename, `--workspace=${WORKSPACE}`],
    { cwd: ROOT, stdio: "inherit" }
  );

  child.on("close", (code) => {
    if (code === 0) {
      console.log(`\n[watch] Graph updated.`);
    } else {
      console.error(`\n[watch] seed-graph.js exited with code ${code}`);
    }
    console.log(`[watch] Watching for changes in notes-raw/ ...\n`);
  });
}

function scheduleUpdate(filepath) {
  const relPath = path.relative(NOTES_RAW_DIR, filepath).replace(/\\/g, "/");
  if (!relPath.endsWith(".txt")) return;

  if (timers.has(relPath)) clearTimeout(timers.get(relPath));
  timers.set(
    relPath,
    setTimeout(() => {
      timers.delete(relPath);

      // Read current content and strip markdown to get plain text
      let plainText = "";
      try {
        plainText = stripMarkdown(readFileSync(filepath, "utf8"));
      } catch {
        // File may have been deleted; run update anyway to clean up nodes
        runUpdate(relPath);
        return;
      }

      // Skip seed-graph if only formatting changed (plain text is unchanged)
      if (plainTextCache.get(relPath) === plainText) {
        console.log(`[watch] ${relPath} — formatting-only change, skipping graph update.`);
        return;
      }

      plainTextCache.set(relPath, plainText);
      runUpdate(relPath);
    }, DEBOUNCE_MS)
  );
}

const watcher = chokidar.watch(NOTES_RAW_DIR, {
  ignored: (fp) => {
    // Ignore the notes/ output directory and dotfiles
    return fp.startsWith(NOTES_DIR + path.sep) || fp === NOTES_DIR
      || path.basename(fp).startsWith(".");
  },
  ignoreInitial: true,   // don't fire for files already present on startup
  awaitWriteFinish: {    // wait for the file write to settle before firing
    stabilityThreshold: 300,
    pollInterval: 100,
  },
});

function runDelete(filename) {
  console.log(`\n[watch] Deleted: ${filename}`);
  console.log(`[watch] Running: seed-graph.js --delete ${filename} --workspace=${WORKSPACE}\n`);

  plainTextCache.delete(filename);

  const child = spawn(
    process.execPath,
    ["--env-file=.env.local", "scripts/seed-graph.js", "--delete", filename, `--workspace=${WORKSPACE}`],
    { cwd: ROOT, stdio: "inherit" }
  );

  child.on("close", (code) => {
    if (code === 0) {
      console.log(`\n[watch] Graph updated.`);
    } else {
      console.error(`\n[watch] seed-graph.js exited with code ${code}`);
    }
    console.log(`[watch] Watching for changes in notes-raw/ ...\n`);
  });
}

function handleUnlink(filepath) {
  const relPath = path.relative(NOTES_RAW_DIR, filepath).replace(/\\/g, "/");
  if (!relPath.endsWith(".txt")) return;
  // Cancel any pending update for this file
  if (timers.has(relPath)) { clearTimeout(timers.get(relPath)); timers.delete(relPath); }
  runDelete(relPath);
}

watcher
  .on("change", scheduleUpdate)
  .on("add",    scheduleUpdate) // also handle new files dropped in
  .on("unlink", handleUnlink);  // handle deleted files

console.log(`[watch] Workspace: ${WORKSPACE}`);
console.log(`[watch] Watching notes-raw/ for changes...`);
console.log(`[watch] Save any .txt file to auto-update the graph.\n`);

// Pre-populate plain-text cache so the first save after startup doesn't
// trigger a re-extract for files that haven't actually changed.
try {
  for (const relPath of getAllTxtRelPaths(NOTES_RAW_DIR, NOTES_RAW_DIR, new Set([NOTES_DIR]))) {
    try {
      const content = readFileSync(path.join(NOTES_RAW_DIR, relPath), "utf8");
      plainTextCache.set(relPath, stripMarkdown(content));
    } catch { /* skip unreadable files */ }
  }
  console.log(`[watch] Pre-cached plain text for ${plainTextCache.size} file(s).\n`);
} catch { /* workspace dir may not exist yet */ }

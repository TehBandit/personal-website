/**
 * watch-notes.js
 * --------------
 * Watches notes-raw/ for file saves and automatically runs seed-graph.js
 * in --update mode for whichever file was changed.
 *
 * Run with:
 *   node --env-file=.env.local scripts/watch-notes.js
 *   npm run watch-notes
 */

import chokidar from "chokidar";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NOTES_RAW_DIR = path.join(ROOT, "notes-raw");

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
  console.log(`[watch] Running: seed-graph.js --update ${filename}\n`);

  const child = spawn(
    process.execPath,
    ["--env-file=.env.local", "scripts/seed-graph.js", "--update", filename],
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
  const filename = path.basename(filepath);
  if (!filename.endsWith(".txt")) return;

  if (timers.has(filename)) clearTimeout(timers.get(filename));
  timers.set(
    filename,
    setTimeout(() => {
      timers.delete(filename);

      // Read current content and strip markdown to get plain text
      let plainText = "";
      try {
        plainText = stripMarkdown(readFileSync(filepath, "utf8"));
      } catch {
        // File may have been deleted; run update anyway to clean up nodes
        runUpdate(filename);
        return;
      }

      // Skip seed-graph if only formatting changed (plain text is unchanged)
      if (plainTextCache.get(filename) === plainText) {
        console.log(`[watch] ${filename} — formatting-only change, skipping graph update.`);
        return;
      }

      plainTextCache.set(filename, plainText);
      runUpdate(filename);
    }, DEBOUNCE_MS)
  );
}

const watcher = chokidar.watch(NOTES_RAW_DIR, {
  ignoreInitial: true,   // don't fire for files already present on startup
  awaitWriteFinish: {    // wait for the file write to settle before firing
    stabilityThreshold: 300,
    pollInterval: 100,
  },
});

watcher
  .on("change", scheduleUpdate)
  .on("add",    scheduleUpdate); // also handle new files dropped in

console.log(`[watch] Watching notes-raw/ for changes...`);
console.log(`[watch] Save any .txt file to auto-update the graph.\n`);

// Pre-populate plain-text cache so the first save after startup doesn't
// trigger a re-extract for files that haven't actually changed.
try {
  for (const f of readdirSync(NOTES_RAW_DIR)) {
    if (!f.endsWith(".txt")) continue;
    try {
      const content = readFileSync(path.join(NOTES_RAW_DIR, f), "utf8");
      plainTextCache.set(f, stripMarkdown(content));
    } catch { /* skip unreadable files */ }
  }
  console.log(`[watch] Pre-cached plain text for ${plainTextCache.size} file(s).\n`);
} catch { /* notes-raw dir may not exist yet */ }

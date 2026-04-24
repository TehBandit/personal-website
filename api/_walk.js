/**
 * Shared recursive directory walker for .md / .txt raw files.
 *
 * Every caller in the codebase needs the same core scan — recurse a workspace
 * directory, skip certain folders (typically `notes/`), and collect matching
 * files.  The only variation is *what* each caller wants back (relative paths,
 * absolute paths, a basename→path Map, or derived node IDs).
 *
 * walkRawFiles() does the single recursive scan and invokes a visitor callback
 * for every matching file.  Callers build whatever data structure they need
 * inside the visitor.
 */
import fs from "fs";
import path from "path";
import { extractTitleFromContent as extractSharedTitleFromContent } from "../shared/story-rules.js";

/**
 * Recursively walk `dir` for .md / .txt files.
 *
 * @param {string}   dir       — directory to scan
 * @param {object}   opts
 * @param {Set<string>} [opts.exclude]  — resolved directory paths to skip entirely
 * @param {(fullPath: string, entry: fs.Dirent) => void} opts.onFile — called for every matching file
 */
export function walkRawFiles(dir, { exclude = new Set(), onFile }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!exclude.has(path.resolve(full))) walkRawFiles(full, { exclude, onFile });
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
      onFile(full, entry);
    }
  }
}

/* ── Convenience wrappers ──────────────────────────────────────────────── */

/**
 * Collect relative paths (forward-slash separated) of all .md/.txt files
 * under `dir`, skipping directories in `exclude`.
 */
export function walkRelPaths(dir, baseDir = dir, exclude = new Set()) {
  const results = [];
  walkRawFiles(dir, {
    exclude,
    onFile(full) {
      results.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    },
  });
  return results;
}

/**
 * Collect absolute paths of all .md/.txt files under `dir`,
 * skipping directories in `exclude`.
 */
export function walkAbsPaths(dir, exclude = new Set()) {
  const results = [];
  walkRawFiles(dir, { exclude, onFile(full) { results.push(full); } });
  return results;
}

/**
 * Build a Map<lowercase basename, full path> from all .md/.txt files under
 * `dir`, skipping directories in `exclude`.  First match wins (no overwrite).
 */
export function walkBasenameMap(dir, exclude = new Set()) {
  const map = new Map();
  walkRawFiles(dir, {
    exclude,
    onFile(full, entry) {
      const key = entry.name.toLowerCase();
      if (!map.has(key)) map.set(key, full);
    },
  });
  return map;
}

/**
 * Collect snake_case node IDs derived from .md/.txt filenames found
 * recursively under `dir`.
 */
export function walkNodeIds(dir) {
  const ids = [];
  walkRawFiles(dir, {
    onFile(_full, entry) {
      ids.push(
        entry.name.replace(/\.(md|txt)$/i, "").replace(/-/g, "_")
      );
    },
  });
  return ids;
}

/**
 * Normalize a sourceFile path so the extension is always `.md`.
 * Matches the convention used by story-extract.js and story-derive.js.
 * Idempotent — values that are already `.md` (or empty) pass through unchanged.
 */
export function normalizeSourceFile(sf) {
  if (!sf) return sf;
  return sf.replace(/\.txt$/i, ".md");
}

export const extractTitleFromContent = extractSharedTitleFromContent;


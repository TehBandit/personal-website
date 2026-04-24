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

function isStructuredMarkdownLine(line) {
  const t = line.trim();
  return /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~|\|)/.test(t);
}

/**
 * Normalize hard-wrapped prose while preserving paragraph breaks.
 *
 * Handles both common patterns:
 * 1) single newlines inside paragraphs, blank line between paragraphs
 * 2) "double-spaced wraps" where every visual line is separated by \n\n
 */
export function normalizeWrappedProse(text) {
  if (typeof text !== "string") return "";

  let s = text.replace(/\r\n?/g, "\n").trim();
  if (!s) return "";

  // If the text uses only double newlines between visual lines, convert that
  // pattern into paragraphs using sentence/line-length heuristics.
  const hasSingleNewline = /(^|[^\n])\n(?!\n)/.test(s);
  const doubleNewlineCount = (s.match(/\n\n/g) || []).length;
  const looksDoubleWrapped = !hasSingleNewline && doubleNewlineCount >= 20;

  if (looksDoubleWrapped) {
    const lines = s.split(/\n\n/).map((line) => line.trim()).filter(Boolean);
    const paras = [];
    let current = "";
    let prevLine = "";

    for (const line of lines) {
      if (!current) {
        current = line;
        prevLine = line;
        continue;
      }

      const prevEndsSentence = /[.!?]["')\]]?$/.test(prevLine);
      const nextStartsSentence = /^[A-Z0-9"'(]/.test(line);
      const likelyParagraphBreak = prevEndsSentence && nextStartsSentence && prevLine.length < 55;

      if (isStructuredMarkdownLine(prevLine) || isStructuredMarkdownLine(line) || likelyParagraphBreak) {
        paras.push(current.trim());
        current = line;
      } else if (prevLine.endsWith("-")) {
        current = current.slice(0, -1) + line;
      } else {
        current += ` ${line}`;
      }

      prevLine = line;
    }

    if (current) paras.push(current.trim());
    return paras.join("\n\n").trim();
  }

  // Standard wrapped-prose mode: keep paragraph boundaries (2+ newlines),
  // but unwrap single line breaks inside each paragraph.
  const blocks = s.split(/\n{2,}/);
  const normalized = blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .filter((line) => line.trim().length > 0);

      if (lines.length <= 1) return (lines[0] || "").trim();
      if (lines.some((line) => isStructuredMarkdownLine(line))) return lines.join("\n").trim();

      let out = lines[0].trim();
      for (let i = 1; i < lines.length; i++) {
        const next = lines[i].trim();
        if (!next) continue;
        if (out.endsWith("-")) out = out.slice(0, -1) + next;
        else out += ` ${next}`;
      }
      return out.trim();
    })
    .filter(Boolean);

  return normalized.join("\n\n").trim();
}

export const extractTitleFromContent = extractSharedTitleFromContent;


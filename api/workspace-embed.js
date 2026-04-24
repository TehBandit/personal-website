/**
 * workspace-embed.js
 * Builds and caches embeddings for all notes in a workspace.
 * GET  /api/workspace-embed?workspace=slug  → returns cache status
 * POST /api/workspace-embed                 → builds/rebuilds embedding cache
 *
 * ⚠ Production note: uses fs.writeFileSync into workspaces/ — localhost only.
 * Swap to object storage (R2/S3) before deploying for other users.
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const CACHE_VERSION = "1";
const EMBED_MODEL = "text-embedding-3-small";

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWorkspacePaths(workspace) {
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  if (!fs.existsSync(wsDir)) return null;
  return {
    wsDir,
    notesDir: path.join(wsDir, "notes"),
    // Legacy fallback root for older workspaces that stored sourceFile under notes-raw.
    rawDir: path.join(wsDir, "notes-raw"),
    cacheFile: path.join(wsDir, "embedding-cache.json"),
  };
}

function loadNotes(notesDir) {
  if (!fs.existsSync(notesDir)) return [];
  return fs
    .readdirSync(notesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(notesDir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Build the text chunks to embed for a single node.
 * We produce up to three chunks per node: notes prose, excerpt, and context_summary.
 * Each chunk carries enough metadata to reconstruct a citation.
 */
function toAltExtension(relPath) {
  if (typeof relPath !== "string") return null;
  if (/\.txt$/i.test(relPath)) return relPath.replace(/\.txt$/i, ".md");
  if (/\.md$/i.test(relPath)) return relPath.replace(/\.md$/i, ".txt");
  return null;
}

function safeJoinUnder(baseDir, relPath) {
  const base = path.resolve(baseDir);
  const full = path.resolve(baseDir, relPath);
  if (full === base || full.startsWith(base + path.sep)) return full;
  return null;
}

/**
 * Resolve node.sourceFile to text content.
 * Primary lookup is workspace-root relative path, with notes-raw fallback for
 * legacy data. Returns diagnostic details when the file is missing or invalid.
 */
export function resolveNodeSourceText(node, wsDir, rawDir) {
  if (!node?.sourceFile || typeof node.sourceFile !== "string") {
    return { text: "", diagnostic: null };
  }

  const sourceFile = node.sourceFile.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!sourceFile) return { text: "", diagnostic: null };

  const candidates = [];
  const addCandidate = (baseDir, relPath) => {
    const joined = safeJoinUnder(baseDir, relPath);
    if (!joined) return;
    if (!candidates.includes(joined)) candidates.push(joined);
  };

  const alt = toAltExtension(sourceFile);

  // Primary: sourceFile is workspace-root relative.
  addCandidate(wsDir, sourceFile);
  if (alt) addCandidate(wsDir, alt);

  // Legacy fallback: older caches occasionally resolved under notes-raw.
  addCandidate(rawDir, sourceFile);
  if (alt) addCandidate(rawDir, alt);

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return { text: fs.readFileSync(filePath, "utf-8"), diagnostic: null };
    } catch {
      // Keep trying remaining candidates.
    }
  }

  return {
    text: "",
    diagnostic: {
      nodeId: node.id,
      nodeName: node.name,
      sourceFile,
      candidates,
    },
  };
}

function buildChunksForNode(node, wsDir, rawDir, diagnostics) {
  const chunks = [];
  const base = {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type || "character",
    excerpt: node.excerpt || "",
    tags: node.tags || [],
  };

  // Raw prose file takes priority for "notes" chunk
  let notesText = "";
  if (node.sourceFile) {
    const { text, diagnostic } = resolveNodeSourceText(node, wsDir, rawDir);
    if (text) {
      notesText = stripMarkdown(text.trim());
    } else if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }
  if (!notesText && typeof node.notes === "string") {
    notesText = node.notes.trim();
  }

  if (notesText) {
    // Chunk long notes into ~800-char segments so we stay well under token limits
    const segments = splitIntoSegments(notesText, 800);
    segments.forEach((seg, i) => {
      chunks.push({
        ...base,
        chunkType: "notes",
        chunkIndex: i,
        text: `${node.name}: ${seg}`,
      });
    });
  }

  if (typeof node.excerpt === "string" && node.excerpt.trim()) {
    chunks.push({
      ...base,
      chunkType: "excerpt",
      chunkIndex: 0,
      text: `${node.name} (summary): ${node.excerpt.trim()}`,
    });
  }

  if (typeof node.context_summary === "string" && node.context_summary.trim()) {
    chunks.push({
      ...base,
      chunkType: "context_summary",
      chunkIndex: 0,
      text: `${node.name} (context): ${node.context_summary.trim()}`,
    });
  }

  return chunks;
}

/**
 * Strip Markdown formatting tokens from text so the AI receives clean prose.
 * Applied to raw .md file content before embedding — the editor/viewer retains
 * the original markdown for rendering, but the embedding index stores plain text.
 */
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, "")           // headings
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")   // bold
    .replace(/\*([^*\n]+)\*/g, "$1")       // italic
    .replace(/~~([^~\n]+)~~/g, "$1")       // strikethrough
    .replace(/`([^`\n]+)`/g, "$1")         // inline code
    .replace(/^[-*+]\s+/gm, "")            // unordered list markers
    .replace(/^\d+\.\s+/gm, "")            // ordered list markers
    .replace(/^>\s*/gm, "")               // blockquotes
    .replace(/^---+$/gm, "")              // horizontal rules
    .replace(/<u>([^<]*)<\/u>/gi, "$1")   // underline html tags
    .replace(/<[^>]+>/g, "")              // any remaining html tags
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoSegments(text, maxChars) {
  const segments = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Try to break on a sentence boundary
    if (end < text.length) {
      const boundary = text.lastIndexOf(".", end);
      if (boundary > start + maxChars * 0.5) end = boundary + 1;
    }
    segments.push(text.slice(start, end).trim());
    start = end;
  }
  return segments.filter(Boolean);
}

/** Cosine similarity between two float arrays */
export function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Embed an array of texts in batches (API limit: 2048 inputs per request).
 * Returns embeddings in the same order.
 */
async function embedBatch(texts) {
  const BATCH = 100; // conservative
  const embeddings = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: slice });
    // API returns sorted by index
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    embeddings.push(...sorted.map((d) => d.embedding));
  }
  return embeddings;
}

// ---------------------------------------------------------------------------
// Load or build cache (exported for use in workspace-chat.js)
// ---------------------------------------------------------------------------

export async function getEmbeddingCache(workspace) {
  const paths = getWorkspacePaths(workspace);
  if (!paths) return null;

  const notes = loadNotes(paths.notesDir);
  if (notes.length === 0) return { chunks: [] };

  // Check if cache is valid
  if (fs.existsSync(paths.cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(paths.cacheFile, "utf-8"));
      if (cached.version === CACHE_VERSION && Array.isArray(cached.chunks) && cached.chunks.length > 0) {
        // Per-node staleness check using the mtime map stored in the cache.
        // Only re-embed nodes that actually changed rather than rebuilding everything.
        const noteFiles = fs.readdirSync(paths.notesDir).filter((f) => f.endsWith(".json"));
        const currentMtimes = {};
        for (const f of noteFiles) {
          currentMtimes[f] = fs.statSync(path.join(paths.notesDir, f)).mtimeMs;
        }

        const cachedMtimes = cached.nodeMtimes || {};

        // Determine which nodes changed, were added, or were removed
        const changedNodeIds = new Set();
        for (const [file, mtime] of Object.entries(currentMtimes)) {
          if (!cachedMtimes[file] || cachedMtimes[file] < mtime) {
            changedNodeIds.add(file.replace(/\.json$/, ""));
          }
        }
        const removedFiles = Object.keys(cachedMtimes).filter((f) => !(f in currentMtimes));
        const removedNodeIds = new Set(removedFiles.map((f) => f.replace(/\.json$/, "")));

        // If nothing changed, return the cache as-is
        if (changedNodeIds.size === 0 && removedNodeIds.size === 0) return cached;

        // Incremental update: keep chunks for unchanged nodes, rebuild only the rest
        return incrementalUpdate(paths, notes, cached, changedNodeIds, removedNodeIds, currentMtimes);
      }
    } catch {
      // fall through to full rebuild
    }
  }

  // Build cache from scratch
  return buildCache(paths, notes);
}

async function buildCache(paths, notes) {
  const diagnostics = [];
  const allChunks = [];
  for (const node of notes) {
    allChunks.push(...buildChunksForNode(node, paths.wsDir, paths.rawDir, diagnostics));
  }

  if (allChunks.length === 0) return { version: CACHE_VERSION, chunks: [] };

  const texts = allChunks.map((c) => c.text);
  const embeddings = await embedBatch(texts);

  const chunks = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));

  // Store per-file mtimes so incremental updates can detect which nodes changed
  const noteFiles = fs.readdirSync(paths.notesDir).filter((f) => f.endsWith(".json"));
  const nodeMtimes = {};
  for (const f of noteFiles) {
    try { nodeMtimes[f] = fs.statSync(path.join(paths.notesDir, f)).mtimeMs; } catch { /* skip */ }
  }

  const cache = {
    version: CACHE_VERSION,
    builtAt: new Date().toISOString(),
    nodeMtimes,
    chunks,
    diagnostics: {
      missingSourceFiles: diagnostics,
      missingSourceFileCount: diagnostics.length,
    },
  };

  if (diagnostics.length > 0) {
    console.warn(
      `[workspace-embed] Missing source files for ${diagnostics.length} node(s) in workspace ${path.basename(paths.wsDir)}.`
    );
    for (const d of diagnostics.slice(0, 20)) {
      console.warn(
        `[workspace-embed] node=${d.nodeId} sourceFile=${d.sourceFile} candidates=${d.candidates.join(" | ")}`
      );
    }
  }

  fs.writeFileSync(paths.cacheFile, JSON.stringify(cache), "utf-8");
  return cache;
}

/**
 * Incremental update: keep cached chunks for unchanged nodes, re-embed only
 * chunks for changed/new nodes, and drop chunks for removed nodes.
 */
async function incrementalUpdate(paths, notes, cached, changedNodeIds, removedNodeIds, currentMtimes) {
  // Keep chunks whose node is unchanged
  const keptChunks = cached.chunks.filter(
    (c) => !changedNodeIds.has(c.nodeId) && !removedNodeIds.has(c.nodeId)
  );

  // Build new chunks for changed/added nodes
  const newChunks = [];
  const diagnostics = [];
  for (const node of notes) {
    if (changedNodeIds.has(node.id)) {
      newChunks.push(...buildChunksForNode(node, paths.wsDir, paths.rawDir, diagnostics));
    }
  }

  // Embed only the new chunks
  let embeddedNewChunks = [];
  if (newChunks.length > 0) {
    const texts = newChunks.map((c) => c.text);
    const embeddings = await embedBatch(texts);
    embeddedNewChunks = newChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  }

  const allChunks = [...keptChunks, ...embeddedNewChunks];
  const cache = {
    version: CACHE_VERSION,
    builtAt: new Date().toISOString(),
    nodeMtimes: currentMtimes,
    chunks: allChunks,
    diagnostics: {
      missingSourceFiles: diagnostics,
      missingSourceFileCount: diagnostics.length,
    },
  };

  if (diagnostics.length > 0) {
    console.warn(
      `[workspace-embed] Incremental update found ${diagnostics.length} node(s) with missing source files in workspace ${path.basename(paths.wsDir)}.`
    );
  }

  fs.writeFileSync(paths.cacheFile, JSON.stringify(cache), "utf-8");
  return cache;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  const workspace = (req.method === "GET" ? req.query.workspace : req.body?.workspace) || "";
  if (!workspace || typeof workspace !== "string" || !/^[a-z0-9_-]+$/i.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  const paths = getWorkspacePaths(workspace);
  if (!paths) return res.status(404).json({ error: "Workspace not found" });

  if (req.method === "GET") {
    const exists = fs.existsSync(paths.cacheFile);
    if (!exists) return res.json({ status: "missing", chunks: 0 });
    try {
      const cache = JSON.parse(fs.readFileSync(paths.cacheFile, "utf-8"));
      return res.json({ status: "ok", chunks: cache.chunks?.length ?? 0, builtAt: cache.builtAt });
    } catch {
      return res.json({ status: "corrupt", chunks: 0 });
    }
  }

  if (req.method === "POST") {
    const notes = loadNotes(paths.notesDir);
    if (notes.length === 0) return res.json({ status: "ok", chunks: 0 });
    try {
      // Force rebuild by deleting cache first
      if (fs.existsSync(paths.cacheFile)) fs.unlinkSync(paths.cacheFile);
      const cache = await buildCache(paths, notes);
      return res.json({ status: "ok", chunks: cache.chunks.length, builtAt: cache.builtAt });
    } catch (err) {
      console.error("[workspace-embed] build error:", err);
      return res.status(500).json({ error: "Failed to build embedding cache" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

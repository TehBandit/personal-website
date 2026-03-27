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

const CACHE_VERSION = "1";
const EMBED_MODEL = "text-embedding-3-small";
const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

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
function buildChunksForNode(node, rawDir) {
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
    const rawPath = path.join(rawDir, node.sourceFile);
    if (fs.existsSync(rawPath)) {
      notesText = fs.readFileSync(rawPath, "utf-8").trim();
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
        // Check staleness: any note newer than cache?
        const cacheMtime = fs.statSync(paths.cacheFile).mtimeMs;
        const noteFiles = fs.readdirSync(paths.notesDir).filter((f) => f.endsWith(".json"));
        const anyStale = noteFiles.some((f) => {
          const mtime = fs.statSync(path.join(paths.notesDir, f)).mtimeMs;
          return mtime > cacheMtime;
        });
        if (!anyStale) return cached;
      }
    } catch {
      // fall through to rebuild
    }
  }

  // Build cache
  return buildCache(paths, notes);
}

async function buildCache(paths, notes) {
  const allChunks = [];
  for (const node of notes) {
    allChunks.push(...buildChunksForNode(node, paths.rawDir));
  }

  if (allChunks.length === 0) return { version: CACHE_VERSION, chunks: [] };

  const texts = allChunks.map((c) => c.text);
  const embeddings = await embedBatch(texts);

  const chunks = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));

  const cache = { version: CACHE_VERSION, builtAt: new Date().toISOString(), chunks };
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

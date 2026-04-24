import { extractTitleFromContent as extractSharedTitleFromContent } from "../../shared/story-rules.js";

/**
 * Compute the set of node IDs that "own" a dedicated file.
 *
 * Rules (first match wins):
 *  1. Merged nodes: at least one additionalSourceFile exists in the provided files list.
 *  2. Stem basename match: a file named after the node ID exists
 *     (e.g. "maren-ashveil.md" for node "maren_ashveil", checked in both hyphen and
 *      underscore variants).
 *
 * NOTE: node.sourceFile is a PROVENANCE field — it records which source document the
 * node was extracted from. A single bulk file can produce many nodes that all share
 * the same sourceFile, so we deliberately do NOT treat it as ownership.
 *
 * @param {Array<{id: string, additionalSourceFiles?: string[]}>} nodes
 * @param {Array<{filename: string}>} files - flat file list (e.g. from notes-raw-list)
 * @returns {Set<string>} set of node IDs that have an owned file
 */
/**
 * Normalize a raw filename stem (no extension) to a node ID.
 * Matches the server-side logic in notes-raw-file.js:
 *   lowercase → replace non-alphanumeric runs with _ → strip leading/trailing _
 */
export function normalizeToId(stem) {
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function computeOwnFileIds(nodes, files) {
  // Use lowercase keys throughout so mixed-case filenames (e.g. BIT_4484_Notes.md)
  // match lowercase node IDs (e.g. bit_4484_notes).
  const basenames = new Set(files.map((f) => f.filename.split("/").pop().toLowerCase()));
  const fileSet   = new Set(files.map((f) => f.filename.toLowerCase()));
  // Also build a set of normalized IDs derived from each file's basename, covering
  // filenames with spaces or mixed case (e.g. "MNode Value.md" → "mnode_value").
  const normalizedIds = new Set(
    files.map((f) => normalizeToId(f.filename.split("/").pop().replace(/\.(md|txt)$/i, "")))
  );

  // Pre-compute which files are already "stem-claimed" by a node whose ID naturally
  // maps to that filename. Rule 3 must NOT fire for these files, otherwise nodes
  // extracted FROM another character's file (e.g. "sunken_ledger" extracted from
  // "fen-caldra.md") would incorrectly inherit that file as their own and show as
  // coloured on the graph even though no dedicated file exists for them.
  //
  // e.g. "fen-caldra.md" → stem "fen_caldra" → nodeIds has "fen_caldra" → stem-claimed.
  // "BIT_4484_Notes.md" → stem "bit_4484_notes" → no such node → NOT stem-claimed,
  // so content-title-derived nodes (monitoring_and_controlling_chapter_8) still work.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const stemClaimedFiles = new Set();
  for (const file of files) {
    const base = file.filename.split("/").pop().toLowerCase().replace(/\.(md|txt)$/i, "");
    const underVariant = base.replace(/-/g, "_");
    const hyphenVariant = base.replace(/_/g, "-");
    const normVariant   = normalizeToId(base);
    if (nodeIds.has(underVariant) || nodeIds.has(hyphenVariant) || nodeIds.has(normVariant)) {
      stemClaimedFiles.add(file.filename.toLowerCase());
    }
  }

  const ids = new Set();

  // Pre-compute which single node "owns" each (non-stem-claimed) sourceFile for Rule 3.
  // When multiple nodes share a sourceFile (e.g. a document node + extracted entities
  // that were pulled from that document), ONLY the primary document node should be
  // coloured. Preference:
  //   1. documentNode: true  — explicitly flagged by story-extract as the document owner
  //   2. Longest notes field — document nodes store the full raw text; extracted
  //      entities have minimal/empty notes. This fallback handles data uploaded before
  //      the documentNode flag existed.
  const sourceFileOwners = new Map(); // lowercase sourceFile → owning node
  for (const node of nodes) {
    if (!node.sourceFile) continue;
    const sfKey = node.sourceFile.toLowerCase();
    // Only consider files that pass the Rule 3 guard (exist + not stem-claimed)
    if (!fileSet.has(sfKey) || stemClaimedFiles.has(sfKey)) continue;
    const existing = sourceFileOwners.get(sfKey);
    if (!existing) {
      sourceFileOwners.set(sfKey, node);
    } else if (node.documentNode && !existing.documentNode) {
      // Explicit document node always wins
      sourceFileOwners.set(sfKey, node);
    } else if (!existing.documentNode && !node.documentNode &&
               (node.notes?.length ?? 0) > (existing.notes?.length ?? 0)) {
      // Neither flagged — prefer the one with more content (the source document)
      sourceFileOwners.set(sfKey, node);
    }
  }

  for (const node of nodes) {
    // 1. Merged nodes: one or more constituent files still exist in the workspace.
    if ((node.additionalSourceFiles || []).some((sf) => fileSet.has((sf || "").toLowerCase()))) {
      ids.add(node.id);
      continue;
    }
    // 2. Stem basename match in hyphen, underscore, and normalized forms.
    const stemHyphen = node.id.replace(/_/g, "-");
    const stemUnder  = node.id;
    if (
      basenames.has(stemHyphen + ".md") || basenames.has(stemHyphen + ".txt") ||
      basenames.has(stemUnder  + ".md") || basenames.has(stemUnder  + ".txt") ||
      normalizedIds.has(node.id)
    ) {
      ids.add(node.id);
      continue;
    }
    // 3. sourceFile match — covers nodes whose ID was derived from the content title
    //    rather than the filename (e.g. story-extract uploads where the file is
    //    "BIT_4484_Notes.md" but the node ID is "monitoring_and_controlling_chapter_8").
    //    Only ONE node per sourceFile may claim ownership here: the documentNode (if
    //    flagged) or the node with the most notes content (for pre-flag data).
    if (node.sourceFile && sourceFileOwners.get(node.sourceFile.toLowerCase())?.id === node.id) {
      ids.add(node.id);
    }
  }

  return ids;
}

/**
 * Build an undirected adjacency map (Map<id, Set<id>>) from a link list.
 * Works with both resolved (object) and unresolved (string) link endpoints.
 */
export function buildAdjacencyMap(links) {
  const adj = new Map();
  for (const l of links) {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  }
  return adj;
}

/**
 * BFS shortest path between two node IDs.
 * @param {string} fromId
 * @param {string} toId
 * @param {Map<string, Set<string>>} adjacencyMap - from buildAdjacencyMap
 * @param {Map<string, object>} nodeMap - id → node object
 * @returns {object[] | null} ordered node array, or null when no path exists
 */
export function graphBFS(fromId, toId, adjacencyMap, nodeMap) {
  if (fromId === toId) return null;
  const prev = new Map();
  const visited = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) break;
    for (const nb of (adjacencyMap.get(cur) || [])) {
      if (!visited.has(nb)) { visited.add(nb); prev.set(nb, cur); queue.push(nb); }
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  let cur = toId;
  while (cur !== undefined) { path.unshift(cur); cur = prev.get(cur); }
  return path.map((id) => nodeMap.get(id)).filter(Boolean);
}

/**
 * Build a basename → full relative path lookup map from a flat file list.
 * e.g. "maren-ashveil.md" → "notes-raw/maren-ashveil.md"
 */
export function buildBasenameMap(files) {
  const map = new Map();
  for (const f of files) {
    const basename = f.filename.split("/").pop();
    const lc = basename.toLowerCase();
    // Primary: exact lowercase basename (e.g. "maren-ashveil.md")
    if (!map.has(lc)) map.set(lc, f.filename);
    // Secondary: normalized-ID form (e.g. "MNode Value.md" → key "mnode_value.md")
    // so resolveNodeFilename and mentionableEntities can find the file via node.id
    const extMatch = lc.match(/\.(md|txt)$/i);
    if (extMatch) {
      const stem = lc.slice(0, lc.length - extMatch[0].length);
      const normKey = normalizeToId(stem) + extMatch[0];
      if (normKey !== lc && !map.has(normKey)) map.set(normKey, f.filename);
    }
  }
  return map;
}

/**
 * Resolve a node's own raw file path from a pre-built basename map.
 * Tries hyphen then underscore form of the ID, .md before .txt.
 * Returns null if no matching file is found.
 */
export function resolveNodeFilename(nodeId, basenameMap) {
  const stemHyphen = nodeId.replace(/_/g, "-");
  return (
    basenameMap.get(stemHyphen + ".md") ??
    basenameMap.get(stemHyphen + ".txt") ??
    basenameMap.get(nodeId + ".md") ??
    basenameMap.get(nodeId + ".txt") ??
    null
  );
}

export const extractTitleFromContent = extractSharedTitleFromContent;

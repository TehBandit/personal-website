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
export function computeOwnFileIds(nodes, files) {
  // Use lowercase keys throughout so mixed-case filenames (e.g. BIT_4484_Notes.md)
  // match lowercase node IDs (e.g. bit_4484_notes).
  const basenames = new Set(files.map((f) => f.filename.split("/").pop().toLowerCase()));
  const fileSet   = new Set(files.map((f) => f.filename.toLowerCase()));
  const ids       = new Set();

  for (const node of nodes) {
    // 1. Merged nodes: one or more constituent files still exist in the workspace.
    if ((node.additionalSourceFiles || []).some((sf) => fileSet.has((sf || "").toLowerCase()))) {
      ids.add(node.id);
      continue;
    }
    // 2. Stem basename match in both hyphen and underscore forms.
    // node.id is always lowercase so no extra .toLowerCase() needed on the stems.
    const stemHyphen = node.id.replace(/_/g, "-");
    const stemUnder  = node.id;
    if (
      basenames.has(stemHyphen + ".md") || basenames.has(stemHyphen + ".txt") ||
      basenames.has(stemUnder  + ".md") || basenames.has(stemUnder  + ".txt")
    ) {
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
  return new Map(files.map((f) => [f.filename.split("/").pop().toLowerCase(), f.filename]));
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

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
  const basenames = new Set(files.map((f) => f.filename.split("/").pop()));
  const fileSet   = new Set(files.map((f) => f.filename));
  const ids       = new Set();

  for (const node of nodes) {
    // 1. Merged nodes: one or more constituent files still exist in the workspace.
    if ((node.additionalSourceFiles || []).some((sf) => fileSet.has(sf))) {
      ids.add(node.id);
      continue;
    }
    // 2. Stem basename match in both hyphen and underscore forms.
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

/**
 * dedup-nodes.js
 * ──────────────
 * Fuzzy deduplication of extracted story nodes against existing graph nodes.
 *
 * Strategy (in order, first match wins):
 *  1. Exact ID match (already handled upstream, but safety net)
 *  2. Exact normalised name match   ("Elara Voss" == "elara voss")
 *  3. One name is a strict substring of the other's words
 *     ("Elara" ⊂ words("Elara Voss")  ←→  "Elara" is fully contained)
 *  4. Token-sort ratio >= threshold  (handles reordered names)
 *  5. Initials / abbreviation match  ("E. Voss" == "Elara Voss")
 *
 * Returns the canonical existing node if a match is found, else null.
 */

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")   // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSort(str) {
  return normalize(str).split(" ").sort().join(" ");
}

// Dice coefficient on bigrams — fast fuzzy similarity 0-1
function diceCoeff(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  };
  const aMap = bigrams(a);
  const bMap = bigrams(b);
  let intersection = 0;
  for (const [bg, count] of aMap) {
    intersection += Math.min(count, bMap.get(bg) || 0);
  }
  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * @param {string} candidateName   - name from the newly extracted node
 * @param {string} candidateId     - id from the newly extracted node
 * @param {Array<{id, name, type}>} existingNodes - already-saved graph nodes
 * @param {number} [threshold=0.82] - dice similarity threshold (0-1)
 * @returns {{ id: string, name: string, type: string } | null}
 */
export function findDuplicate(candidateName, candidateId, existingNodes, threshold = 0.82) {
  const normCandidate = normalize(candidateName);
  const sortedCandidate = tokenSort(candidateName);
  const wordsCandidate = new Set(normCandidate.split(" "));

  for (const existing of existingNodes) {
    // 1. Exact id match
    if (existing.id === candidateId) return existing;

    const normExisting = normalize(existing.name);
    const sortedExisting = tokenSort(existing.name);
    const wordsExisting = new Set(normExisting.split(" "));

    // 2. Exact normalised name
    if (normCandidate === normExisting) return existing;

    // 3. Subset match — every word of the shorter name appears in the longer
    //    "Elara" vs "Elara Voss": words(Elara) ⊆ words(Elara Voss)
    const smaller = wordsCandidate.size <= wordsExisting.size ? wordsCandidate : wordsExisting;
    const larger  = wordsCandidate.size <= wordsExisting.size ? wordsExisting  : wordsCandidate;
    if (smaller.size >= 1 && [...smaller].every((w) => larger.has(w))) return existing;

    // 4. Token-sort dice — catches reordered multi-word names
    if (diceCoeff(sortedCandidate, sortedExisting) >= threshold) return existing;

    // 5. Initials / abbreviation  "E. Voss" → first letters match "Elara Voss"
    const initials = normExisting
      .split(" ")
      .map((w) => w[0])
      .join("");
    const candidateInitials = normCandidate
      .split(" ")
      .map((w) => w[0])
      .join("");
    if (
      normCandidate.replace(/\./g, "") === initials ||
      candidateInitials === normExisting.replace(/\./g, "")
    ) {
      return existing;
    }
  }

  return null;
}

/**
 * Given a list of extracted nodes and the current existing nodes,
 * returns `{ deduped, remapIds }` where:
 *   - deduped:  nodes that are genuinely new (no duplicate found)
 *   - remapIds: Map<candidateId → canonicalId> for connection retargeting
 */
export function deduplicateNodes(extractedNodes, existingNodes) {
  const remapIds = new Map();
  const deduped = [];

  // Also deduplicate within the extracted batch itself
  const seenInBatch = [];

  for (const node of extractedNodes) {
    // Check against already-saved nodes
    const existingMatch = findDuplicate(node.name, node.id, existingNodes);
    if (existingMatch) {
      remapIds.set(node.id, existingMatch.id);
      continue;
    }

    // Check against nodes already accepted in this same batch
    const batchMatch = findDuplicate(node.name, node.id, seenInBatch);
    if (batchMatch) {
      remapIds.set(node.id, batchMatch.id);
      continue;
    }

    deduped.push(node);
    seenInBatch.push({ id: node.id, name: node.name, type: node.type || "character" });
  }

  return { deduped, remapIds };
}

/**
 * Rewrite connection targets using the remap table,
 * and drop self-referencing connections.
 */
export function remapConnections(nodes, remapIds) {
  return nodes.map((node) => ({
    ...node,
    connections: (node.connections || [])
      .map((conn) => ({
        ...conn,
        target: remapIds.get(conn.target) ?? conn.target,
      }))
      .filter((conn) => conn.target !== node.id), // no self-links
  }));
}

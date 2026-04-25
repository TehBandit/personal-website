import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, RefreshCw, BookOpen, ChevronDown, ChevronUp, Loader, AlertCircle, X, Trash2, PanelLeftOpen, PanelLeftClose, Network, SquarePen, Copy, Check, Pencil } from "lucide-react";
import { useNodeTypeConfig } from "../contexts/NodeTypeContext.jsx";
import { buildAdjacencyMap, graphBFS } from "../utils/graphHelpers.js";
import { buildWordBoundaryPattern, collectGreedyMatches, overlapsAnyRange } from "../../shared/story-rules.js";

const BG = "#0a0a14";
const SIDEBAR_BG = "#0c0c18";
const PANEL_BG = "#0f0f1a";
const BUBBLE_BG = "#161624";
const BORDER = "rgba(255,255,255,0.07)";
const BORDER_MED = "rgba(255,255,255,0.1)";
const MUTED = "rgba(255,255,255,0.35)";
const TEXT = "rgba(255,255,255,0.88)";
const ACCENT = "#60a5fa";
const ACCENT_DIM = "rgba(96,165,250,0.15)";

// ---------------------------------------------------------------------------
// Graph query analysis — detect structural questions and answer from graph data
// ---------------------------------------------------------------------------

// Keywords that strongly indicate a graph-structure question (not a note-content question)
const GRAPH_KEYWORDS = [
  "neighbor", "neighbour",
  "on the graph", "in the graph", "graph structure",
  "path between", "path from", "path to",
  "degrees of separation", "how many hops",
  "directly connected", "direct connection",
  "connect to", "connects to", "connected to",
  "relate to", "related to", "relationship between",
  "how do", "how does", "how are",
  "relate", "relation between",
  "link between", "linked to",
  "adjacent",
  "focus",
];

function tokenizeWords(value) {
  if (!value) return [];
  const matches = value.toLowerCase().match(/[a-z0-9]+/g);
  return matches || [];
}

function tokenizeWordsWithSpans(value) {
  if (!value) return [];
  const spans = [];
  const re = /[a-z0-9]+/gi;
  let m;
  while ((m = re.exec(value)) !== null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      wordLower: m[0].toLowerCase(),
    });
  }
  return spans;
}

function isSingleEditAway(a, b) {
  if (a === b) return true;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < al && j < bl) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;

    if (al === bl) {
      i++;
      j++;
    } else if (al > bl) {
      i++;
    } else {
      j++;
    }
  }

  if (i < al || j < bl) edits++;
  return edits <= 1;
}

function isAdjacentSwapAway(a, b) {
  if (a.length !== b.length || a.length < 2) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i >= a.length - 1) return false;
  if (a[i] !== b[i + 1] || a[i + 1] !== b[i]) return false;
  return a.slice(i + 2) === b.slice(i + 2);
}

function isCloseWordMatch(observedWord, targetWord) {
  if (!observedWord || !targetWord) return false;
  const observed = observedWord.toLowerCase();
  const target = targetWord.toLowerCase();
  if (observed === target) return true;
  if (observed[0] !== target[0]) return false;
  return isSingleEditAway(observed, target) || isAdjacentSwapAway(observed, target);
}

function isFuzzyPhraseWindow(windowWords, targetWords) {
  if (!windowWords?.length || !targetWords?.length || windowWords.length !== targetWords.length) return false;
  let changedWords = 0;
  for (let i = 0; i < targetWords.length; i++) {
    if (windowWords[i] === targetWords[i]) continue;
    if (!isCloseWordMatch(windowWords[i], targetWords[i])) return false;
    changedWords++;
  }
  return changedWords > 0;
}

/**
 * Greedy non-overlapping matcher for candidate entities.
 * Candidates should already be sorted longest-first.
 */
function collectGreedyEntityMatches(text, candidates, options = {}) {
  if (!text || !candidates?.length) return [];
  const {
    enableFuzzy = false,
    maxFuzzyTextLength = 240,
  } = options;

  const exactCandidates = candidates.map((entity) => ({
    ...entity,
    patternSource: entity.patternSource || buildWordBoundaryPattern(entity.name || ""),
  }));
  const exactMatches = collectGreedyMatches(text, exactCandidates);

  const occupied = exactMatches.map((m) => ({ start: m.start, end: m.end }));
  const matchedCandidates = new Set(exactMatches.map((m) => m.item));
  const matches = exactMatches.map((m) => ({
    start: m.start,
    end: m.end,
    text: m.text,
    entity: m.item,
  }));

  if (enableFuzzy && text.length <= maxFuzzyTextLength) {
    const wordSpans = tokenizeWordsWithSpans(text);
    for (const entity of candidates) {
      if (matchedCandidates.has(entity)) continue;
      const targetWords = entity.wordTokens || tokenizeWords(entity.name || "");
      if (targetWords.length < 2) continue;
      if (targetWords.join("").length < 8) continue;
      const windowSize = targetWords.length;
      if (wordSpans.length < windowSize) continue;

      for (let i = 0; i <= wordSpans.length - windowSize; i++) {
        const first = wordSpans[i];
        const last = wordSpans[i + windowSize - 1];
        const start = first.start;
        const end = last.end;
        if (overlapsAnyRange(start, end, occupied)) continue;

        const windowWords = [];
        for (let j = 0; j < windowSize; j++) {
          windowWords.push(wordSpans[i + j].wordLower);
        }
        if (!isFuzzyPhraseWindow(windowWords, targetWords)) continue;

        occupied.push({ start, end });
        matches.push({ start, end, text: text.slice(start, end), entity });
        matchedCandidates.add(entity);
        break;
      }
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  return matches;
}

/**
 * Greedy longest-match node mention detection.
 *
 * Problem with plain `lower.includes(name)`: "management" appears inside
 * "management history", so BOTH nodes match even when the user only typed
 * "management history". This causes the wrong node to be used as primary.
 *
 * Fix: sort candidates longest-first, then consume text ranges so that a
 * shorter name can only match at positions NOT already covered by a longer
 * match. "management history" consumes its span; "management" can only
 * match if there's a standalone occurrence elsewhere in the query.
 */
function greedyMentionedNodes(lower, nodes) {
  const candidates = nodes
    .flatMap((node) => {
      const terms = [node.name, ...(node.aliases || [])]
        .filter((term) => typeof term === "string" && term.trim().length > 0);
      return terms.map((term) => ({
        node,
        term,
        wordTokens: tokenizeWords(term),
        patternSource: buildWordBoundaryPattern(term),
      }));
    })
    .sort((a, b) => b.term.length - a.term.length);

  const matches = collectGreedyEntityMatches(lower, candidates, { enableFuzzy: true, maxFuzzyTextLength: 220 });
  const seen = new Set();
  const result = [];
  for (const { entity } of matches) {
    if (seen.has(entity.node.id)) continue;
    seen.add(entity.node.id);
    result.push(entity.node);
  }
  return result;
}

function getNodeNeighbors(nodeId, graphData) {
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const nodes = [];
  const labels = {};
  for (const link of graphData.links) {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    const nbId = src === nodeId && nodeMap.has(tgt) ? tgt
                : tgt === nodeId && nodeMap.has(src) ? src
                : null;
    if (nbId && !seen.has(nbId)) {
      seen.add(nbId);
      nodes.push(nodeMap.get(nbId));
      labels[nbId] = link.label || "";
    }
  }
  return { nodes, labels };
}

function computeShortestPath(fromId, toId, graphData) {
  const adj = buildAdjacencyMap(graphData.links);
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));
  return graphBFS(fromId, toId, adj, nodeMap);
}

function joinWithAnd(items) {
  if (!items?.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function summarizeAnchorRelations(anchor, mentioned, graphData) {
  const targets = mentioned.filter((n) => n.id !== anchor.id);
  const connected = [];
  const missing = [];

  for (const target of targets) {
    const pathNodes = computeShortestPath(anchor.id, target.id, graphData);
    if (!pathNodes) {
      missing.push(target);
      continue;
    }
    connected.push({ target, pathNodes, hops: pathNodes.length - 1 });
  }

  return {
    anchor,
    targets,
    connected,
    missing,
    connectedCount: connected.length,
    directCount: connected.filter((p) => p.hops === 1).length,
    totalHops: connected.reduce((sum, p) => sum + p.hops, 0),
    maxHops: connected.reduce((m, p) => Math.max(m, p.hops), 0),
  };
}

function chooseSmartAnchor(mentioned, graphData) {
  if (!mentioned?.length) return null;
  const analyses = mentioned.map((anchor, mentionIndex) => ({
    mentionIndex,
    ...summarizeAnchorRelations(anchor, mentioned, graphData),
  }));

  analyses.sort((a, b) => {
    return (
      b.connectedCount - a.connectedCount ||
      b.directCount - a.directCount ||
      a.totalHops - b.totalHops ||
      a.maxHops - b.maxHops ||
      a.mentionIndex - b.mentionIndex
    );
  });

  return analyses[0];
}

/**
 * Returns a graph query result object, or null if the query is not graph-structural.
 * { type, focusNode, neighborNodes, pathNodes, linkLabels, answer }
 */
function analyzeGraphQuery(text, graphData) {
  if (!graphData?.nodes?.length) return null;
  const lower = text.toLowerCase();

  if (!GRAPH_KEYWORDS.some((k) => lower.includes(k))) return null;

  // Find mentioned node names using greedy longest-match so that "management"
  // inside "management history" is not counted as a separate match.
  const mentioned = greedyMentionedNodes(lower, graphData.nodes);

  if (mentioned.length === 0) return null;

  const primary = mentioned[0];

  // Multi-focus query: "focus X and Y" — 2+ nodes + explicit "focus" keyword, no path intent
  const focusKeywords = ["focus"];
  const pathKeywords = ["path", "hops", "degrees", "connect", "relate", "link", "how does", "how is", "how are", "how do"];
  if (
    mentioned.length >= 2 &&
    focusKeywords.some((k) => lower.includes(k)) &&
    !pathKeywords.some((k) => lower.includes(k))
  ) {
    const names = mentioned.map((n) => n.name).join(" and ");
    return {
      type: "multi-focus",
      focusNode: primary,
      focusNodes: mentioned,
      neighborNodes: [],
      pathNodes: [],
      linkLabels: {},
      answer: `Focusing on ${names} on the graph.`,
    };
  }

  // Path query: 2+ nodes AND a path-related keyword
  // "how does/is" is allowed here (broad) since we already require 2 named nodes
  if (
    mentioned.length >= 2 &&
    pathKeywords.some((k) => lower.includes(k))
  ) {
    // Multi-target relation query: "How does A relate to B and C?"
    // Evaluate A -> B and A -> C (and any further targets), then summarize
    // the common connector/structure rather than dropping extra entities.
    if (mentioned.length >= 3) {
      const anchorSummary = chooseSmartAnchor(mentioned, graphData);
      const anchor = anchorSummary?.anchor || mentioned[0];
      const targets = anchorSummary?.targets || mentioned.filter((n) => n.id !== anchor.id);
      const connected = anchorSummary?.connected || [];
      const missing = anchorSummary?.missing || [];
      const allPathNodesById = new Map([[anchor.id, anchor]]);

      for (const { pathNodes } of connected) {
        for (const node of pathNodes) allPathNodesById.set(node.id, node);
      }

      if (connected.length === 0) {
        return {
          type: "no-path",
          focusNode: anchor,
          focusNodes: [anchor],
          neighborNodes: [],
          pathNodes: [],
          linkLabels: {},
          answer: `There is no path connecting ${anchor.name} to ${joinWithAnd(targets.map((n) => n.name))} in the graph.`,
        };
      }

      const intermediateSets = connected.map(({ pathNodes }) => new Set(pathNodes.slice(1, -1).map((n) => n.id)));
      let sharedIntermediateIds = null;
      for (const ids of intermediateSets) {
        if (sharedIntermediateIds == null) {
          sharedIntermediateIds = new Set(ids);
          continue;
        }
        sharedIntermediateIds = new Set([...sharedIntermediateIds].filter((id) => ids.has(id)));
      }

      const sharedIntermediates = sharedIntermediateIds
        ? [...sharedIntermediateIds]
          .map((id) => allPathNodesById.get(id))
          .filter(Boolean)
        : [];

      const connectedNames = connected.map(({ target }) => target.name);
      const routeHints = connected.map(({ pathNodes }) => pathNodes.map((n) => n.name).join(" -> "));
      const sharedLine = sharedIntermediates.length
        ? `Shared connector${sharedIntermediates.length !== 1 ? "s" : ""}: ${joinWithAnd(sharedIntermediates.map((n) => n.name))}.`
        : `Common connector across the requested nodes: ${anchor.name}.`;
      const missingLine = missing.length
        ? `No path found from ${anchor.name} to ${joinWithAnd(missing.map((n) => n.name))}.`
        : "";
      const answer = [
        `Tracing how ${anchor.name} relates to ${joinWithAnd(connectedNames)} based on the graph structure.`,
        sharedLine,
        missingLine,
      ].filter(Boolean).join("\n");

      const tracePrompt = [
        `Trace how ${anchor.name} relates to ${joinWithAnd(connectedNames)} based only on the notes.`,
        sharedIntermediates.length
          ? `Use ${joinWithAnd(sharedIntermediates.map((n) => n.name))} as the shared connector context.`
          : "Explain the common factor(s) connecting these relationships.",
        `Use these graph routes as structure: ${routeHints.join(" | ")}.`,
        missing.length
          ? `Also note that no path was found from ${anchor.name} to ${joinWithAnd(missing.map((n) => n.name))}.`
          : "",
        "Write a cohesive narrative paragraph (not bullets), and explicitly identify the determining factor that links them.",
      ].filter(Boolean).join(" ");

      return {
        type: "multi-focus",
        focusNode: anchor,
        focusNodes: [...allPathNodesById.values()],
        neighborNodes: [],
        pathNodes: [],
        linkLabels: {},
        answer,
        tracePrompt,
        pathHint: routeHints.join(" | "),
        traceNodeIds: [...allPathNodesById.keys()],
      };
    }

    const secondary = mentioned[1];
    const pathNodes = computeShortestPath(primary.id, secondary.id, graphData);
    if (!pathNodes) {
      return {
        type: "no-path",
        focusNode: primary,
        neighborNodes: [],
        pathNodes: [],
        linkLabels: {},
        answer: `There is no path connecting ${primary.name} and ${secondary.name} in the graph.`,
      };
    }
    const hops = pathNodes.length - 1;
    return {
      type: "path",
      focusNode: primary,
      neighborNodes: [],
      pathNodes,
      linkLabels: {},
      answer: `There is a path of ${hops} hop${hops !== 1 ? "s" : ""} from ${primary.name} to ${secondary.name}:\n\n${pathNodes.map((n) => n.name).join(" → ")}`,
    };
  }

  // Neighbors query
  const { nodes, labels } = getNodeNeighbors(primary.id, graphData);
  if (nodes.length === 0) {
    return {
      type: "neighbors",
      focusNode: primary,
      neighborNodes: [],
      pathNodes: [],
      linkLabels: {},
      answer: `${primary.name} has no direct connections in the graph.`,
    };
  }
  const list = nodes
    .map((n) => `- ${n.name} (${n.type})${labels[n.id] ? ` — ${labels[n.id]}` : ""}`)
    .join("\n");
  return {
    type: "neighbors",
    focusNode: primary,
    neighborNodes: nodes,
    pathNodes: [],
    linkLabels: labels,
    answer: `${primary.name} has ${nodes.length} direct connection${nodes.length !== 1 ? "s" : ""} on the graph:\n\n${list}`,
  };
}

// ---------------------------------------------------------------------------
// Knowledge query detection — content/fact questions that should use RAG
// instead of graph structural analysis.
// These patterns unambiguously signal "tell me what the notes say about X".
// When matched, the graph structural interceptor is bypassed so the query
// reaches the AI + RAG pipeline with the relevant node's content pinned.
// ---------------------------------------------------------------------------

const KNOWLEDGE_QUERY_PATTERNS = [
  /\bsummariz/,
  /\btell\s+me\s+about\b/,
  /\bwhat\s+(?:do\s+(?:we|i)\s+know|is\s+known|is\s+written)\s+about\b/,
  /\bdescribe\b/,
  /\bwho\s+is\b/,
  /\bwho\s+are\b/,
  /\bwhat\s+is\b/,
  /\bwhat\s+are\b/,
  /\bhow\s+old\b/,
  /\bbackground\s+on\b/,
];

function detectKnowledgeQuery(text, graphData) {
  if (!graphData?.nodes?.length) return null;
  const lower = text.toLowerCase().trim();
  if (!KNOWLEDGE_QUERY_PATTERNS.some((p) => p.test(lower))) return null;

  // Find all node names using greedy longest-match so shorter names don't
  // falsely match inside longer ones (e.g. "management" inside "management history").
  const mentioned = greedyMentionedNodes(lower, graphData.nodes);

  if (mentioned.length === 0) return null;

  return {
    isSummarize: /\bsummariz/.test(lower),
    nodes: mentioned.slice(0, 3),
    pinnedNodeIds: mentioned.slice(0, 3).map((n) => n.id),
  };
}

// ---------------------------------------------------------------------------
// Meta commands — filter-based focus/tag mutations (no AI round-trip)
// ---------------------------------------------------------------------------

function parseMetaFilter(lower, graphData) {
  // Tag filter: "tagged veldmoor" / "with tag veldmoor" / "with the tag 'veldmoor'"
  const tagM = lower.match(/(?:tagged?|with\s+(?:the\s+)?tag)\s+['"]?([a-z0-9][a-z0-9_-]*)['"]?/);
  if (tagM) return { type: "tag", value: tagM[1] };

  // Node type filter — match actual types present in the graph
  const types = [...new Set(graphData.nodes.map((n) => n.type).filter(Boolean))];
  for (const t of types) {
    if (new RegExp(`\\b${t}\\s+nodes?\\b`, "i").test(lower)) return { type: "nodeType", value: t };
  }

  // "all nodes" (broad — no additional filter)
  if (/\ball\s+nodes?\b/.test(lower)) return { type: "all" };

  // Date filter: "created before/after/on DATE"
  const dateM = lower.match(/(?:created|added)\s+(before|after|on)\s+(.+?)(?:\s*$)/);
  if (dateM) {
    const date = new Date(dateM[2].trim());
    if (!isNaN(date)) return { type: "date", op: dateM[1], date };
  }

  // Derived / no source file
  if (/\bderived\b|\bno\s+(?:source\s+)?file\b|\bwithout\s+(?:a\s+)?file\b/.test(lower)) {
    return { type: "noFile" };
  }

  return null;
}

function applyMetaFilter(filter, graphData) {
  if (!filter) return null;
  switch (filter.type) {
    case "all": return graphData.nodes;
    case "tag":
      return graphData.nodes.filter((n) => (n.tags || []).some((t) => t.toLowerCase() === filter.value));
    case "nodeType":
      return graphData.nodes.filter((n) => n.type?.toLowerCase() === filter.value.toLowerCase());
    case "date": {
      const { op, date } = filter;
      const d = date;
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
      const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
      return graphData.nodes.filter((n) => {
        if (!n.createdAt) return false;
        if (op === "before") return n.createdAt < dayStart;
        if (op === "after")  return n.createdAt > dayEnd;
        return n.createdAt >= dayStart && n.createdAt <= dayEnd;
      });
    }
    case "noFile": return graphData.nodes.filter((n) => !n.sourceFile);
    default: return null;
  }
}

function describeMetaFilter(filter) {
  if (!filter) return "";
  switch (filter.type) {
    case "all":      return " (all nodes)";
    case "tag":      return ` tagged '${filter.value}'`;
    case "nodeType": return ` of type '${filter.value}'`;
    case "date":     return ` created ${filter.op} ${filter.date.toLocaleDateString()}`;
    case "noFile":   return " with no source file";
    default:         return "";
  }
}

/**
 * Detects metadata-driven commands (no named-node matching required):
 *   "focus all nodes tagged veldmoor"
 *   "add tag veldmoor to all character nodes"
 *   "remove tag test from nodes created before Mar 15, 2026"
 * Returns { action, targetTag?, filter, nodeIds, answer } or null.
 */
// ---------------------------------------------------------------------------
// Disallowed action detection — certain operations are never executed via chat
// ---------------------------------------------------------------------------

// Each entry: { pattern: RegExp, reason: string }
const DISALLOWED_RULES = [
  // Deletion / destruction
  { pattern: /\bdelete\b/,                          reason: "deleting nodes or files" },
  { pattern: /\bremove\s+(node|file|note|all)\b/,   reason: "removing nodes or files" },
  { pattern: /\berase\b/,                           reason: "erasing content" },
  { pattern: /\bdestroy\b/,                         reason: "destructive actions" },
  { pattern: /\bwipe\b/,                            reason: "wiping content" },
  { pattern: /\bpurge\b/,                           reason: "purging content" },
  { pattern: /\btrash\b/,                           reason: "trashing content" },
  { pattern: /\bdrop\b.*\bnode\b/,                  reason: "dropping nodes" },

  // Rename / move files
  { pattern: /\brename\b/,                          reason: "renaming files or nodes" },
  { pattern: /\bmove\s+(node|file|note)\b/,         reason: "moving files" },

  // Modifying connections / edges
  { pattern: /\b(add|create|make|insert)\b.*\b(connection|edge|link|relationship)\b/, reason: "modifying connections" },
  { pattern: /\b(remove|delete|unlink|disconnect)\b.*\b(connection|edge|link|relationship)\b/, reason: "modifying connections" },
  { pattern: /\bconnect\s+\w.*\bto\b/,              reason: "modifying connections" },
  { pattern: /\bdisconnect\b/,                      reason: "modifying connections" },
  { pattern: /\bunlink\b/,                          reason: "modifying connections" },

  // Workspace creation / deletion
  { pattern: /\b(create|make|add|new)\b.*\bworkspace\b/, reason: "creating workspaces" },
  { pattern: /\b(delete|remove|destroy)\b.*\bworkspace\b/, reason: "deleting workspaces" },
];

const DISALLOWED_RESPONSE =
  "That action isn't available through chat. Things like deleting nodes or files, renaming, modifying connections, and creating or deleting workspaces must be done through the editor directly.";

function detectDisallowedAction(text) {
  const lower = text.toLowerCase();
  return DISALLOWED_RULES.some(({ pattern }) => pattern.test(lower));
}

function analyzeMetaCommand(text, graphData) {
  if (!graphData?.nodes?.length) return null;
  const lower = text.toLowerCase().trim();

  // ADD TAG: "add [the] tag X to <filter>"
  const addM = lower.match(/\badd\s+(?:the\s+)?tag\s+['"]?([a-z0-9][a-z0-9_-]*)['"]?\s+to\s+(.+)/);
  if (addM) {
    const targetTag = addM[1];
    const filter = parseMetaFilter(addM[2], graphData);
    const matched = applyMetaFilter(filter, graphData) ?? [];
    const desc = describeMetaFilter(filter);
    if (matched.length === 0) return { action: "add-tag", targetTag, nodeIds: [], answer: `No nodes found${desc}.` };
    return {
      action: "add-tag", targetTag, filter,
      nodeIds: matched.map((n) => n.id),
      answer: `Adding tag **${targetTag}** to ${matched.length} node${matched.length !== 1 ? "s" : ""}${desc}.`,
    };
  }

  // REMOVE TAG: "remove [the] tag X from <filter>"
  const removeM = lower.match(/\bremove\s+(?:the\s+)?tag\s+['"]?([a-z0-9][a-z0-9_-]*)['"]?\s+from\s+(.+)/);
  if (removeM) {
    const targetTag = removeM[1];
    const filter = parseMetaFilter(removeM[2], graphData);
    const matched = applyMetaFilter(filter, graphData) ?? [];
    const desc = describeMetaFilter(filter);
    if (matched.length === 0) return { action: "remove-tag", targetTag, nodeIds: [], answer: `No nodes found${desc}.` };
    return {
      action: "remove-tag", targetTag, filter,
      nodeIds: matched.map((n) => n.id),
      answer: `Removing tag **${targetTag}** from ${matched.length} node${matched.length !== 1 ? "s" : ""}${desc}.`,
    };
  }

  // FOCUS with metadata filter — only intercept when a filter keyword is present
  // (named-node focus like "focus virsa col" is handled by analyzeGraphQuery)
  const hasFocusWord = /\bfocus\b/.test(lower);
  const hasMetaIndicator =
    /\b(tagged?|with\s+(?:the\s+)?tag|created\s+(?:before|after|on)|derived|no\s+(?:source\s+)?file)\b/.test(lower) ||
    /\ball\s+\w+\s+nodes?\b/.test(lower) ||
    /\ball\s+nodes?\b/.test(lower);
  if (hasFocusWord && hasMetaIndicator) {
    const filter = parseMetaFilter(lower, graphData);
    const matched = applyMetaFilter(filter, graphData) ?? [];
    const desc = describeMetaFilter(filter);
    if (matched.length > 0) {
      return {
        action: "focus", filter,
        nodeIds: matched.map((n) => n.id),
        answer: `Focusing on ${matched.length} node${matched.length !== 1 ? "s" : ""}${desc} on the graph.`,
      };
    }
    if (filter) return { action: "focus", filter, nodeIds: [], answer: `No nodes found${desc}.` };
  }

  return null;
}

// ---------------------------------------------------------------------------
// GraphMinimap — inline SVG subgraph for graph query responses
// ---------------------------------------------------------------------------

function GraphMinimap({ graphResult, graphData, onOpenNode, onShowPath }) {
  const NODE_TYPE_CONFIG = useNodeTypeConfig();
  const nodeTypeFallback = Object.values(NODE_TYPE_CONFIG)[0];
  if (!graphData || !graphResult) return null;
  const { type, focusNodeId, nodeIds, linkLabels } = graphResult;
  const truncate = (s, max) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  const W = 296;

  if (type === "neighbors") {
    const focusNode = graphData.nodes.find((n) => n.id === focusNodeId);
    if (!focusNode || nodeIds.length === 0) return null;
    const displayNodes = nodeIds.map((id) => graphData.nodes.find((n) => n.id === id)).filter(Boolean);
    const N = displayNodes.length;
    const H = Math.max(180, 150 + N * 6);
    const cx = W / 2, cy = H / 2;
    const R = N <= 3 ? 58 : N <= 6 ? 70 : N <= 9 ? 80 : 88;
    const focusCfg = NODE_TYPE_CONFIG[focusNode.type] || nodeTypeFallback;

    const positions = displayNodes.map((node, i) => {
      const angle = (2 * Math.PI * i / N) - Math.PI / 2;
      return { node, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
    });

    return (
      <div style={{ marginTop: "8px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(8,8,18,0.85)" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* Edges */}
          {positions.map(({ node, x, y }) => (
            <line key={`e-${node.id}`} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
          ))}
          {/* Edge relationship labels at midpoints */}
          {positions.map(({ node, x, y }) => {
            const lbl = linkLabels?.[node.id];
            if (!lbl) return null;
            return (
              <text key={`el-${node.id}`} x={(cx + x) / 2} y={(cy + y) / 2 - 3} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6.5" style={{ pointerEvents: "none" }}>
                {truncate(lbl, 14)}
              </text>
            );
          })}
          {/* Center focus node */}
          <g onClick={() => onOpenNode?.(focusNode.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
            <circle cx={cx} cy={cy} r={11} fill={focusCfg.color} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
            <text x={cx} y={cy + 23} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="8.5" fontWeight="600" style={{ pointerEvents: "none" }}>
              {truncate(focusNode.name, 16)}
            </text>
          </g>
          {/* Neighbor nodes */}
          {positions.map(({ node, x, y }) => {
            const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;
            const isTop = y < cy - 10, isBottom = y > cy + 10;
            const isLeft = x < cx - 15, isRight = x > cx + 15;
            let lx, ly, la;
            if (isTop && !isLeft && !isRight)  { lx = x;      ly = y - 12; la = "middle"; }
            else if (isBottom && !isLeft && !isRight) { lx = x; ly = y + 19; la = "middle"; }
            else if (isLeft)  { lx = x - 11; ly = y + 3;  la = "end";    }
            else if (isRight) { lx = x + 11; ly = y + 3;  la = "start";  }
            else              { lx = x;      ly = y + 19; la = "middle"; }
            return (
              <g key={node.id} onClick={() => onOpenNode?.(node.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
                <circle cx={x} cy={y} r={6.5} fill={cfg.color} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                <text x={lx} y={ly} textAnchor={la} fill="rgba(255,255,255,0.62)" fontSize="8" style={{ pointerEvents: "none" }}>
                  {truncate(node.name, 14)}
                </text>
              </g>
            );
          })}
        </svg>
        {onShowPath && (
          <div style={{ padding: "4px 8px 6px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => onShowPath(graphResult)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.4)", backgroundColor: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#93c5fd"; e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <Network size={9} />
              Show on graph
            </button>
          </div>
        )}
      </div>
    );
  }

  if (type === "path") {
    const pathNodes = nodeIds.map((id) => graphData.nodes.find((n) => n.id === id)).filter(Boolean);
    if (pathNodes.length < 2) return null;
    const N = pathNodes.length;
    const H = 88;
    const pad = 28;
    const innerW = W - 2 * pad;
    const gap = N > 1 ? innerW / (N - 1) : 0;
    const cy = 38;
    return (
      <div style={{ marginTop: "8px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(8,8,18,0.85)" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {pathNodes.slice(0, -1).map((_, i) => (
            <line key={`pe-${i}`} x1={pad + i * gap} y1={cy} x2={pad + (i + 1) * gap} y2={cy} stroke="rgba(251,191,36,0.35)" strokeWidth="1.5" />
          ))}
          {pathNodes.map((node, i) => {
            const x = pad + i * gap;
            const isEndpoint = i === 0 || i === N - 1;
            const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;
            return (
              <g key={node.id} onClick={() => onOpenNode?.(node.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
                <circle cx={x} cy={cy} r={isEndpoint ? 8 : 6} fill={cfg.color} stroke={isEndpoint ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.12)"} strokeWidth={isEndpoint ? 2 : 1} />
                <text x={x} y={cy + 20} textAnchor="middle" fill={isEndpoint ? "rgba(253,230,138,0.85)" : "rgba(255,255,255,0.58)"} fontSize="7.5" fontWeight={isEndpoint ? "600" : "400"} style={{ pointerEvents: "none" }}>
                  {truncate(node.name, 12)}
                </text>
              </g>
            );
          })}
        </svg>
        {onShowPath && (
          <div style={{ padding: "4px 8px 6px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => onShowPath(graphResult)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.4)", backgroundColor: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#93c5fd"; e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <Network size={9} />
              Show on graph
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Citation card
// ---------------------------------------------------------------------------

function CitationCard({ source, citationNumber, onOpenNode }) {
  const NODE_TYPE_CONFIG = useNodeTypeConfig();
  const nodeTypeFallback = Object.values(NODE_TYPE_CONFIG)[0];
  const cfg = NODE_TYPE_CONFIG[source.nodeType] || nodeTypeFallback;
  const clickable = !!onOpenNode;
  return (
    <button
      onClick={clickable ? () => onOpenNode(source.nodeId) : undefined}
      disabled={!clickable}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left w-full transition-colors"
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        border: `1px solid ${BORDER}`,
        cursor: clickable ? "pointer" : "default",
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)") : undefined}
      onMouseLeave={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)") : undefined}
    >
      <span
        className="text-[10px] font-bold rounded w-4 h-4 flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: ACCENT_DIM, color: ACCENT }}
      >
        {citationNumber}
      </span>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
      <span className="text-xs truncate flex-1" style={{ color: TEXT }}>{source.nodeName}</span>
      <span className="text-[10px] flex-shrink-0" style={{ color: MUTED }}>{cfg.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Citations panel (collapsible)
// ---------------------------------------------------------------------------

function CitationsPanel({ sources, onOpenNode }) {
  const [open, setOpen] = useState(true);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
        style={{
          color: ACCENT,
          backgroundColor: open ? ACCENT_DIM : "transparent",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.backgroundColor = ACCENT_DIM; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        <BookOpen size={11} />
        {sources.length} source{sources.length !== 1 ? "s" : ""}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-1.5">
          {sources.map((src) => (
            <CitationCard key={src.nodeId} source={src} citationNumber={src.citationNumber} onOpenNode={onOpenNode} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Content rendering — strips markdown bold, formats lists, renders citation superscripts
// ---------------------------------------------------------------------------

/** Strip **bold** and *italic* markers from a string */
function stripBold(str) {
  return str.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
}

/**
 * Build a lookup object for entity name → nodeId linking in chat text.
 * Mirrors FilesEditor's mentionableEntities logic: canonical name + explicit
 * aliases + auto-partial single words from multi-word names (stop-words excluded).
 * Returns { map, regex } or null when graphData has no nodes.
 */
function buildChatEntities(graphData, NODE_TYPE_CONFIG, nodeTypeFallback, ownFileIds) {
  if (!graphData?.nodes?.length) return null;
  const STOP_WORDS = new Set([
    // articles, prepositions, conjunctions
    "a","an","the","and","but","nor","or","yet","so","for","of","in","on",
    "at","to","by","up","as","into","onto","upon","over","under","about",
    "after","before","from","with","than","not","no","both","either","neither",
    // pronouns / relative words
    "it","its","he","she","they","we","you","me","him","her","us","them",
    "my","his","our","your","their","who","whom","whose","which","that","this",
    "these","those",
    // question words (critical — prevents "how","what","when" from aliasing titles)
    "how","what","when","where","why","whether",
    // auxiliary / modal verbs
    "is","are","was","were","be","been","being","am",
    "has","have","had","do","does","did",
    "can","will","would","could","should","may","might","must","shall",
    // common short verbs
    "get","got","put","set","let","use","used","make","made","take","took",
    "come","came","went","give","gave","tell","told","know","see","say","try",
    "keep","kept","seem","feel","look","call","find","need","want","said",
    // adverbs / quantifiers / determiners
    "also","even","just","only","very","quite","too","per","now","once",
    "here","there","still","back","else","ever","far","well","much","more",
    "most","less","many","some","few","all","any","each","every","own",
    "same","real","true","like","long","such",
    // numbers
    "one","two","three","four","five","six","seven","eight","nine","ten",
    // common adjectives that appear in descriptive chapter/document titles
    "old","new","big","main","next","last","first","early","late","high",
    "low","good","best","bad","key","top",
  ]);
  const seen = new Set();
  const list = [];

  // ── Pass 1: canonical names + explicit aliases ────────────────────────────
  // These MUST be registered before auto-partials so that a multi-word node
  // (e.g. "Management History") can never steal the `seen` key for a node
  // that has that same word as its own canonical name (e.g. "Management").
  // Without this, iteration order determines which node "wins" the key — fragile.
  for (const node of graphData.nodes) {
    if (ownFileIds && !ownFileIds.has(node.id)) continue; // skip grey nodes — no file
    const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;
    const push = (name) => {
      const key = name.toLowerCase();
      if (seen.has(key) || !name.trim()) return;
      seen.add(key);
      list.push({ name, nodeId: node.id, color: cfg.color });
    };
    push(node.name);
    for (const alias of (node.aliases || [])) push(alias);
  }

  // ── Pass 2: first/last-name partials for character nodes only ───────────────
  // Lets users refer to "Sable" or "Voss" when a character is named "Sable Voss".
  // Intentionally restricted to type "character": topic, concept, source, faction,
  // location, etc. nodes often have descriptive multi-word titles whose individual
  // words (e.g. "History", "Strategic", "Design") are not useful stand-alone links
  // and can cause spurious matches in ordinary prose.
  // Blocked by `seen` if any node already owns that exact string canonically.
  for (const node of graphData.nodes) {
    if (node.type !== "character") continue;
    if (ownFileIds && !ownFileIds.has(node.id)) continue; // skip grey nodes — no file
    const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;
    const push = (name) => {
      const key = name.toLowerCase();
      if (seen.has(key) || !name.trim()) return;
      seen.add(key);
      list.push({ name, nodeId: node.id, color: cfg.color });
    };
    const words = node.name.trim().split(/\s+/);
    if (words.length > 1) {
      for (const w of words) {
        if (w.length > 2 && !STOP_WORDS.has(w.toLowerCase())) push(w);
      }
    }

  }
  list.sort((a, b) => b.name.length - a.name.length);
  return {
    entities: list.map((e) => ({
      ...e,
      wordTokens: tokenizeWords(e.name),
      patternSource: buildWordBoundaryPattern(e.name),
    })),
  };
}

/**
 * Render an inline text segment, converting [N] markers to clickable superscripts
 * and entity names to clickable node links.
 */
function renderInline(text, citations, onOpenNode, key, entityData) {
  const parts = text.split(/(\[\d\])/g);

  const linkifyPlain = (str, baseKey) => {
    if (!entityData || !onOpenNode || !str) return str;
    const { entities } = entityData;
    if (!entities?.length) return str;
    // Skip linkification on long strings (full note content) — the regex has many
    // alternations and applying it to thousands of characters causes visible jank.
    if (str.length > 2000) return str;

    const matches = collectGreedyEntityMatches(str, entities, { enableFuzzy: true, maxFuzzyTextLength: 260 });
    if (!matches.length) return str;

    const segments = [];
    let last = 0;
    for (const { start, end, text, entity } of matches) {
      if (start > last) segments.push(str.slice(last, start));
      segments.push(
        <button
          key={`${baseKey}-el-${start}`}
          onClick={() => onOpenNode(entity.nodeId)}
          title={entity.name}
          style={{
            color: entity.color,
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            cursor: "pointer",
            fontWeight: 500,
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            userSelect: "text",
          }}
        >
          {text}
        </button>
      );
      last = end;
    }
    if (last < str.length) segments.push(str.slice(last));
    return segments.length ? segments : str;
  };

  return (
    <span key={key}>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d)\]$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const source = citations?.[num - 1];
          if (!source) return <span key={i}>{part}</span>;
          return (
            <sup key={i} style={{ lineHeight: 0 }}>
              <button
                onClick={() => onOpenNode?.(source.nodeId)}
                title={`Source: ${source.nodeName}`}
                style={{
                  color: "#93c5fd",
                  fontSize: "0.7em",
                  fontWeight: 600,
                  padding: "0 1px",
                  cursor: onOpenNode ? "pointer" : "default",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                  userSelect: "text",
                }}
              >
                [{num}]
              </button>
            </sup>
          );
        }
        const linked = linkifyPlain(part, i);
        return <span key={i}>{linked}</span>;
      })}
    </span>
  );
}

/**
 * Full content renderer: strips bold markers, parses numbered/bullet lists,
 * renders inline citation superscripts.
 */
function renderContent(content, citations, onOpenNode, entityData) {
  const lines = stripBold(content).split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Numbered list block
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const numMatch = lines[i].match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          const text = numMatch[2];
          items.push(<li key={i} value={num} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i, entityData)}</li>);
          i++;
        } else if (lines[i].trim() === "" && i + 1 < lines.length && /^\d+\.\s/.test(lines[i + 1])) {
          // blank line between list items — skip it and stay in the list
          i++;
        } else {
          break;
        }
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ paddingLeft: "1.4em", margin: "4px 0", listStyleType: "decimal" }}>
          {items}
        </ol>
      );
      continue;
    }

    // Bullet list block
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s+/, "");
        items.push(<li key={i} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i, entityData)}</li>);
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: "1.4em", margin: "4px 0", listStyleType: "disc" }}>
          {items}
        </ul>
      );
      continue;
    }

    // Blank line → spacing
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} style={{ height: "0.5em" }} />);
      i++;
      continue;
    }

    // Regular text line
    elements.push(
      <div key={`l-${i}`}>
        {renderInline(line, citations, onOpenNode, i, entityData)}
      </div>
    );
    i++;
  }

  return <div style={{ lineHeight: "1.6" }}>{elements}</div>;
}

function MessageBubble({ message, onOpenNode, ownFileIds, entityData, onRegenerate, onEditSubmit, isLast }) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming;
  const isThinking = isStreaming && message.content === "";

  // Filter citations: grey nodes (no own file) become null so inline [N] markers
  // degrade to plain text, while the panel only shows nodes with real notes.
  const filteredCitations = useMemo(() => {
    if (!message.citations) return null;
    return message.citations.map((c) =>
      (ownFileIds && !ownFileIds.has(c.nodeId)) ? null : c
    );
  }, [message.citations, ownFileIds]);

  const panelCitations = useMemo(() => {
    if (!filteredCitations) return null;
    return filteredCitations
      .map((c, i) => (c ? { ...c, citationNumber: i + 1 } : null))
      .filter(Boolean);
  }, [filteredCitations]);

  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const editRef = useRef(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const startEdit = () => {
    setEditText(message.content);
    setEditing(true);
    setTimeout(() => {
      if (editRef.current) {
        editRef.current.style.height = "auto";
        editRef.current.style.height = `${editRef.current.scrollHeight}px`;
        editRef.current.focus();
      }
    }, 0);
  };

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) onEditSubmit(trimmed);
    setEditing(false);
  };

  // Format timestamp
  const ts = message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Content */}
      <div className={`flex flex-col gap-1 min-w-0 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>

        {/* Bubble */}
        {editing ? (
          <div className="flex flex-col gap-2 w-full">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none outline-none"
              style={{
                backgroundColor: ACCENT_DIM,
                color: TEXT,
                border: `1px solid rgba(96,165,250,0.35)`,
                borderBottomRightRadius: "6px",
                lineHeight: "1.65",
                minWidth: "220px",
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditing(false)}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}` }}
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: "#fff", backgroundColor: ACCENT }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl text-sm"
            style={isUser
              ? {
                  backgroundColor: ACCENT_DIM,
                  color: TEXT,
                  border: `1px solid rgba(96,165,250,0.18)`,
                  borderBottomRightRadius: "6px",
                  padding: "5px 10px",
                }
              : {
                  backgroundColor: BUBBLE_BG,
                  color: TEXT,
                  border: `1px solid ${BORDER}`,
                  borderBottomLeftRadius: "6px",
                  lineHeight: "1.65",
                  overflow: "hidden",
                  padding: "5px 10px",
                }
            }
          >
            {/* Assistant top action bar */}
            {!isUser && !isThinking && !isStreaming && (
              <div
                className="flex items-center gap-1 transition-opacity"
                style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
              >
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors"
                  style={{ color: copied ? "#4ade80" : MUTED, backgroundColor: "rgba(255,255,255,0.05)" }}
                  title="Copy"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                {isLast && onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors"
                    style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.05)" }}
                    title="Regenerate response"
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                )}
                {ts && (
                  <span className="text-[10px] ml-auto" style={{ color: "rgba(255,255,255,0.18)" }}>{ts}</span>
                )}
              </div>
            )}

            {/* Message body */}
            <div>
              {isThinking ? (
                <span className="flex items-center gap-1.5" style={{ color: MUTED }}>
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="inline-block w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ backgroundColor: MUTED, animationDelay: `${i * 150}ms`, animationDuration: "900ms" }}
                      />
                    ))}
                  </span>
                  <span className="text-xs">Thinking…</span>
                </span>
              ) : isStreaming ? (
                <>
                  <span style={{ whiteSpace: "pre-wrap" }}>{stripBold(message.content)}</span>
                  <span
                    className="inline-block w-1 h-3.5 ml-0.5 rounded-sm animate-pulse"
                    style={{ backgroundColor: ACCENT, verticalAlign: "text-bottom", opacity: 0.7 }}
                  />
                </>
              ) : (
                renderContent(message.content, filteredCitations, onOpenNode, entityData)
              )}
            </div>

            {/* Citations flush inside the card */}
            {!isUser && panelCitations && panelCitations.length > 0 && (
              <div className="border-t px-4 pt-2 pb-3" style={{ borderColor: BORDER }}>
                <CitationsPanel sources={panelCitations} onOpenNode={onOpenNode} />
              </div>
            )}
          </div>
        )}

        {/* User edit / timestamp action row */}
        {!editing && !isStreaming && isUser && (
          <div
            className="flex items-center gap-1 transition-opacity"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
          >
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg transition-colors"
              style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}` }}
              title="Edit message"
            >
              <Pencil size={10} /> Edit
            </button>
            {ts && (
              <span className="text-[10px] px-1" style={{ color: "rgba(255,255,255,0.18)" }}>{ts}</span>
            )}
          </div>
        )}

        {/* Graph minimap — suppressed: graph is visible on the same screen, path is auto-highlighted */}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onSend, graphData }) {
  // Find the most-connected character to suggest a graph query
  let graphStarter = null;
  if (graphData?.nodes?.length) {
    const adj = buildAdjacencyMap(graphData.links || []);
    let best = null, bestDeg = 0;
    for (const node of graphData.nodes) {
      if (node.type === "character") {
        const deg = adj.get(node.id)?.size || 0;
        if (deg > bestDeg) { bestDeg = deg; best = node; }
      }
    }
    if (best) graphStarter = `Who are ${best.name}'s direct neighbors on the graph?`;
  }

  const starters = [
    graphStarter,
    "Who is Sable Voss and what are her motivations?",
    "What factions exist in this world?",
    "Summarize the key locations and their significance.",
    "What conflicts drive the story?",
  ].filter(Boolean).slice(0, 5);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: "rgba(96,165,250,0.1)", border: `1px solid rgba(96,165,250,0.2)` }}
        >
          <Network size={22} style={{ color: ACCENT }} />
        </div>
        <div>
          <p className="text-base font-semibold" style={{ color: TEXT }}>Ask about your world</p>
          <p className="text-xs mt-1" style={{ color: MUTED }}>Characters, factions, locations, connections — all grounded in your notes.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
        {starters.map((s) => (
          <button
            key={s}
            onClick={() => onSend(s)}
            className="text-left text-xs px-3.5 py-2.5 rounded-xl transition-colors leading-relaxed"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: `1px solid ${BORDER}`,
              color: "rgba(255,255,255,0.55)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = TEXT;
              e.currentTarget.style.borderColor = BORDER_MED;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
              e.currentTarget.style.color = "rgba(255,255,255,0.55)";
              e.currentTarget.style.borderColor = BORDER;
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Index status banner
// ---------------------------------------------------------------------------

function IndexBanner({ workspace, onDismiss }) {
  const [status, setStatus] = useState("idle"); // idle | building | done | error
  const [info, setInfo] = useState(null);

  useEffect(() => {
    fetch(`/api/workspace-embed?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d) => setInfo(d))
      .catch(() => {});
  }, [workspace]);

  const rebuild = useCallback(async () => {
    setStatus("building");
    try {
      const r = await fetch("/api/workspace-embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      const d = await r.json();
      setInfo(d);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
    }
  }, [workspace]);

  if (!info) return null;

  const isMissing = info.status === "missing" || info.status === "corrupt";
  if (!isMissing) return null; // only show when action is required

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 text-xs flex-shrink-0"
      style={{ backgroundColor: "rgba(251,191,36,0.07)", borderBottom: `1px solid rgba(251,191,36,0.15)` }}
    >
      <AlertCircle size={12} style={{ color: "#fbbf24", flexShrink: 0 }} />
      <span style={{ color: "rgba(253,230,138,0.9)" }}>Knowledge index not built.</span>
      <button
        onClick={rebuild}
        disabled={status === "building"}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ml-1"
        style={{ backgroundColor: "rgba(251,191,36,0.18)", color: "#fbbf24" }}
      >
        {status === "building" ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        {status === "building" ? "Building…" : "Build now"}
      </button>
      <button onClick={onDismiss} className="ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}><X size={11} /></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session storage helpers
// ---------------------------------------------------------------------------

const SESSIONS_KEY = (workspace) => `storygraph-chat-sessions-${workspace}`;
const MAX_SESSIONS = 30;

function loadSessions(workspace) {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY(workspace));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(workspace, sessions) {
  try { localStorage.setItem(SESSIONS_KEY(workspace), JSON.stringify(sessions)); } catch { /* no-op */ }
}

function createSession() {
  return { id: `s_${Date.now()}`, title: null, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
}

function deriveTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const t = first.content.trim();
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Session sidebar
// ---------------------------------------------------------------------------

function SessionSidebar({ sessions, activeId, onSelect, onNew, onDelete }) {
  return (
    <div
      className="flex flex-col w-56 flex-shrink-0 border-r overflow-hidden"
      style={{ backgroundColor: SIDEBAR_BG, borderColor: BORDER }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: BORDER }}
      >
        <span className="text-xs font-semibold" style={{ color: MUTED }}>Chats</span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-xs p-1.5 rounded-lg transition-colors"
          style={{ color: MUTED }}
          onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
          title="New chat"
        >
          <SquarePen size={14} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1.5 flex flex-col gap-0.5 px-2">
        {sessions.length === 0 && (
          <p className="text-xs px-2 py-6 text-center" style={{ color: "rgba(255,255,255,0.2)" }}>No chats yet</p>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ backgroundColor: isActive ? "rgba(96,165,250,0.1)" : "transparent" }}
              onClick={() => onSelect(s.id)}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" style={{ color: isActive ? TEXT : "rgba(255,255,255,0.55)" }}>
                  {s.title || "New chat"}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.22)" }}>
                  {formatRelativeTime(s.updatedAt)}
                </p>
              </div>
              <button
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                style={{ color: "rgba(255,255,255,0.3)" }}
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WorkspaceChat component
// ---------------------------------------------------------------------------

export default function WorkspaceChat({ workspace, onOpenNode, graphData = null, ownFileIds = null, chatFocusNode = null, onShowPath = null, onBulkPatch = null, pendingQuestion = null, onPendingConsumed = null, compact = false }) {
  // Build entity linkification data once per workspace/graph change.
  // Computed here (parent) rather than inside each MessageBubble so that N
  // messages don't each rebuild the same map+regex on every workspace switch.
  const _ntc = useNodeTypeConfig();
  const _ntf = Object.values(_ntc)[0];
  const entityData = useMemo(() => buildChatEntities(graphData, _ntc, _ntf, ownFileIds), [graphData, _ntc, _ntf, ownFileIds]);

  // Session state
  const [sessions, setSessions] = useState(() => loadSessions(workspace));
  const [activeId, setActiveId] = useState(() => {
    const s = loadSessions(workspace);
    return s.length > 0 ? s[0].id : null;
  });
  // In compact (panel) mode, hide history by default so the chat area has full height.
  const [sidebarOpen, setSidebarOpen] = useState(!compact);

  // Tracks which workspace the current `sessions` state belongs to.
  // Used to prevent the persist effect from writing stale sessions to the wrong
  // workspace key during a workspace switch (effects run in definition order, so
  // persist would otherwise fire before the reload effect updates sessions).
  const sessionsWorkspaceRef = useRef(workspace);

  // Reload sessions when the workspace prop changes
  useEffect(() => {
    sessionsWorkspaceRef.current = workspace;
    const s = loadSessions(workspace);
    setSessions(s);
    setActiveId(s.length > 0 ? s[0].id : null);
  }, [workspace]);

  // Chat state
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [showBanner, setShowBanner] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const sendMessageRef = useRef(null);

  // Derive active session and its messages
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);

  // Persist sessions to localStorage. Workspace is read from the ref (not a dep)
  // so this effect only fires when sessions actually changes — never on a bare
  // workspace switch where sessions would still hold the previous workspace's data.
  useEffect(() => {
    saveSessions(sessionsWorkspaceRef.current, sessions);
  }, [sessions]);

  // Smart auto-scroll: only scroll to bottom when user is already near the bottom
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, atBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  // Update messages on the active session.
  // sessionIdOverride lets sendMessage use the ID returned by ensureSession() rather
  // than the stale activeId captured in the closure (which may still be null when a
  // new session was lazily created on the very first message).
  const updateMessages = useCallback((updater, sessionIdOverride) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== (sessionIdOverride ?? activeId)) return s;
      const next = typeof updater === "function" ? updater(s.messages) : updater;
      const title = s.title ?? deriveTitle(next);
      return { ...s, messages: next, title, updatedAt: Date.now() };
    }));
  }, [activeId]);

  // Ensure an active session exists (create one lazily on first message)
  const ensureSession = useCallback(() => {
    if (activeId && sessions.find((s) => s.id === activeId)) return activeId;
    const s = createSession();
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
    return s.id;
  }, [activeId, sessions]);

  const newSession = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    const s = createSession();
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const selectSession = useCallback((id) => {
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    setActiveId(id);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activeId]);

  // Regenerate: drop the last assistant message and re-send the last user message
  const regenerate = useCallback(() => {
    const msgs = activeSession?.messages ?? [];
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const userText = msgs[lastUserIdx].content;
    updateMessages(() => msgs.slice(0, lastUserIdx));
    setTimeout(() => sendMessageRef.current?.(userText), 0);
  }, [activeSession, updateMessages]);

  // Edit user message: trim history to just before that message index, then resend
  const editMessage = useCallback((msgIndex, newText) => {
    updateMessages((prev) => prev.slice(0, msgIndex));
    setTimeout(() => sendMessageRef.current?.(newText), 0);
  }, [updateMessages]);

  const sendMessage = useCallback(
    async (textOverride, options = {}) => {
      const { forcedNodeIds = null, forcedPathHint = null, mode = null } = options;
      const text = (textOverride ?? input).trim();
      if (!text || sending) return;

      const effectiveId = ensureSession();

      setError(null);
      setInput("");
      setSending(true);

      const userMsg = { role: "user", content: text, createdAt: Date.now() };

      // Intercept disallowed (destructive) requests — reply inline, no API call
      if (detectDisallowedAction(text)) {
        const assistantMsg = {
          role: "assistant",
          content: DISALLOWED_RESPONSE,
          streaming: false,
          citations: null,
          graphResult: null,
        };
        setSessions((prev) => {
          const session = prev.find((s) => s.id === effectiveId) ?? prev[0];
          const newMsgs = [...(session?.messages ?? []), userMsg, assistantMsg];
          const title = session?.title ?? deriveTitle(newMsgs);
          return prev.map((s) => {
            if (s.id !== (session?.id ?? effectiveId)) return s;
            return { ...s, messages: newMsgs, title, updatedAt: Date.now() };
          });
        });
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      // Intercept metadata commands (filter-based focus/tag mutations) — no AI round-trip
      const metaCmd = graphData ? analyzeMetaCommand(text, graphData) : null;
      if (metaCmd) {
        const assistantMsg = {
          role: "assistant",
          content: metaCmd.answer,
          streaming: false,
          citations: null,
          graphResult: metaCmd.action === "focus" && metaCmd.nodeIds.length > 0
            ? { type: "meta-focus", focusNodeIds: metaCmd.nodeIds }
            : null,
        };
        setSessions((prev) => {
          const session = prev.find((s) => s.id === effectiveId) ?? prev[0];
          const newMsgs = [...(session?.messages ?? []), userMsg, assistantMsg];
          const title = session?.title ?? deriveTitle(newMsgs);
          return prev.map((s) => {
            if (s.id !== (session?.id ?? effectiveId)) return s;
            return { ...s, messages: newMsgs, title, updatedAt: Date.now() };
          });
        });
        if (metaCmd.action === "focus" && metaCmd.nodeIds.length > 0) {
          onShowPath?.({ type: "meta-focus", focusNodeIds: metaCmd.nodeIds });
        } else if ((metaCmd.action === "add-tag" || metaCmd.action === "remove-tag") && metaCmd.nodeIds.length > 0) {
          onBulkPatch?.({ action: metaCmd.action, targetTag: metaCmd.targetTag, nodeIds: metaCmd.nodeIds });
        }
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      // Detect knowledge/content queries BEFORE the graph structural interceptor.
      // "who is X", "how old is X", "summarize X", "describe X" etc. should be
      // answered from note content even when they also match graph keywords.
      const knowledgeHint = graphData ? detectKnowledgeQuery(text, graphData) : null;

      // Intercept graph structural queries — answer directly from graph data without the API.
      // Skipped when the query is clearly about note content (knowledgeHint is set).
      const graphAnalysis = (!knowledgeHint && graphData) ? analyzeGraphQuery(text, graphData) : null;
      if (graphAnalysis) {
        const derivedGraphNodeIds = [
          ...(graphAnalysis.pathNodes || []).map((n) => n.id),
          ...(graphAnalysis.neighborNodes || []).map((n) => n.id),
        ];
        const graphNodeIds = graphAnalysis.traceNodeIds?.length
          ? graphAnalysis.traceNodeIds
          : derivedGraphNodeIds;
        const graphResult = {
          type: graphAnalysis.type,
          focusNodeId: graphAnalysis.focusNode.id,
          focusNodeIds: graphAnalysis.focusNodes?.map((n) => n.id) ?? null,
          nodeIds: [...new Set(graphNodeIds)],
          linkLabels: graphAnalysis.linkLabels || {},
        };

        const shouldStreamNarrative = graphAnalysis.type === "path" || !!graphAnalysis.tracePrompt;

        // Non-trace results (multi-focus/focus, neighbors, no-path): answer immediately.
        if (!shouldStreamNarrative) {
          const assistantMsg = {
            role: "assistant",
            content: graphAnalysis.answer,
            streaming: false,
            citations: null,
            graphResult,
          };
          setSessions((prev) => {
            const session = prev.find((s) => s.id === effectiveId) ?? prev[0];
            const newMsgs = [...(session?.messages ?? []), userMsg, assistantMsg];
            const title = session?.title ?? deriveTitle(newMsgs);
            return prev.map((s) => {
              if (s.id !== (session?.id ?? effectiveId)) return s;
              return { ...s, messages: newMsgs, title, updatedAt: Date.now() };
            });
          });
          onShowPath?.(graphResult);
          setSending(false);
          setTimeout(() => inputRef.current?.focus(), 50);
          return;
        }

        // Found a traceable relationship pattern: show structural summary immediately,
        // then stream a narrative explanation from notes.
        let traceNodeIds = graphResult.nodeIds;
        let pathHint = graphAnalysis.pathHint || "";
        let tracePrompt = graphAnalysis.tracePrompt || "";

        if (graphAnalysis.type === "path") {
          const pathNames = graphAnalysis.pathNodes.map((n) => n.name);
          pathHint = pathNames.join(" → ");
          const middleNames = pathNames.slice(1, -1);
          tracePrompt = middleNames.length > 0
            ? `Trace the connection from ${pathNames[0]} to ${pathNames[pathNames.length - 1]} through ${middleNames.join(" and ")}, explaining each relationship step by step based only on the notes.`
            : `Describe the relationship between ${pathNames[0]} and ${pathNames[pathNames.length - 1]} in depth — their history, shared significance, any tensions or dynamics, and how each influences the other — drawing only from the notes. Do not just list the connection; give a thorough narrative account.`;
        } else if (!tracePrompt) {
          tracePrompt = `Describe how ${graphAnalysis.focusNode.name} relates to the requested entities using only the notes in a cohesive narrative paragraph.`;
        }

        const initialContent = graphAnalysis.answer;
        const snapSession = sessions.find((s) => s.id === effectiveId) ?? sessions[0];
        const currentMessages = [...(snapSession?.messages ?? []), userMsg];
        const assistantIdx = currentMessages.length;

        setSessions((prev) => {
          const session = prev.find((s) => s.id === (snapSession?.id ?? effectiveId)) ?? prev[0];
          const msgs = [...(session?.messages ?? []), userMsg, {
            role: "assistant",
            content: initialContent,
            streaming: true,
            citations: null,
            graphResult,
            createdAt: Date.now(),
          }];
          return prev.map((s) => {
            if (s.id !== session?.id) return s;
            return { ...s, messages: msgs, title: s.title ?? deriveTitle(msgs), updatedAt: Date.now() };
          });
        });

        onShowPath?.(graphResult);

        // Use the explicit trace prompt as the final user message for the API, but keep the
        // original user message visible in the UI (already stored above).
        const historyMessages = currentMessages.slice(0, -1).map(({ role, content }) => ({ role, content }));
        const payload = [...historyMessages, { role: "user", content: tracePrompt }];
        abortRef.current = new AbortController();

        try {
          const response = await fetch("/api/workspace-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspace,
              messages: payload,
              graphNodeIds: traceNodeIds,
              ...(pathHint ? { graphPathHint: pathHint } : {}),
            }),
            signal: abortRef.current.signal,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "Request failed");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let aiAccContent = "";
          let finalCitations = null;

          const flush = (line) => {
            if (!line.startsWith("data: ")) return;
            let parsed;
            try { parsed = JSON.parse(line.slice(6)); } catch { return; }
            if (parsed.type === "token") {
              aiAccContent += parsed.content;
              updateMessages((prev) => {
                const next = [...prev];
                next[assistantIdx] = { ...next[assistantIdx], content: initialContent + "\n\n" + aiAccContent };
                return next;
              }, effectiveId);
            } else if (parsed.type === "correction") {
              aiAccContent = parsed.content;
              updateMessages((prev) => {
                const next = [...prev];
                next[assistantIdx] = { ...next[assistantIdx], content: initialContent + "\n\n" + aiAccContent };
                return next;
              }, effectiveId);
            } else if (parsed.type === "citations") {
              finalCitations = parsed.sources;
            } else if (parsed.type === "error") {
              throw new Error(parsed.message);
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) { if (line.trim()) flush(line); }
          }
          if (buffer.trim()) flush(buffer);

          updateMessages((prev) => {
            const next = [...prev];
            next[assistantIdx] = {
              role: "assistant",
              content: initialContent + "\n\n" + aiAccContent,
              streaming: false,
              citations: finalCitations,
              graphResult,
            };
            return next;
          }, effectiveId);
        } catch (err) {
          if (err.name === "AbortError") {
            updateMessages((prev) => {
              const next = [...prev];
              if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
              return next;
            }, effectiveId);
          } else {
            // Keep the static path answer but mark done — don't wipe it on error
            updateMessages((prev) => {
              const next = [...prev];
              if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
              return next;
            }, effectiveId);
            setError(err.message || "Something went wrong");
          }
        } finally {
          setSending(false);
          abortRef.current = null;
          setTimeout(() => inputRef.current?.focus(), 50);
        }
        return;
      }

      // Derive currentMessages synchronously from the sessions closure.
      // sendMessage is recreated whenever sessions changes (via the ensureSession dep chain),
      // so sessions here is always fresh — we do NOT rely on the setSessions updater
      // side-effect, which runs asynchronously after React's batch flush and would
      // leave currentMessages undefined when assistantIdx is computed below.
      const snapSession = sessions.find((s) => s.id === effectiveId) ?? sessions[0];
      const currentMessages = [...(snapSession?.messages ?? []), userMsg];

      setSessions((prev) => {
        const session = prev.find((s) => s.id === (snapSession?.id ?? effectiveId)) ?? prev[0];
        const msgs = [...(session?.messages ?? []), userMsg];
        return prev.map((s) => {
          if (s.id !== session?.id) return s;
          return { ...s, messages: msgs, title: s.title ?? deriveTitle(msgs), updatedAt: Date.now() };
        });
      });

      // Collect node IDs from any recent graph result in this session (last 6 messages)
      // so follow-up questions can draw on the notes for those nodes.
      const recentMsgs = activeSession?.messages ?? [];
      const recentGraphResult = [...recentMsgs].reverse().slice(0, 6).find((m) => m.graphResult)?.graphResult;
      const graphNodeIds = forcedNodeIds ?? (recentGraphResult?.nodeIds?.length ? recentGraphResult.nodeIds : null);

      // Collect graph path description for context hint (e.g. "A → B → C")
      let graphPathHint = forcedPathHint;
      if (!graphPathHint && recentGraphResult && graphData) {
        const pathIds = recentGraphResult.type === "path" ? recentGraphResult.nodeIds : null;
        if (pathIds?.length) {
          const pathNames = pathIds
            .map((id) => graphData.nodes.find((n) => n.id === id)?.name)
            .filter(Boolean);
          if (pathNames.length >= 2) graphPathHint = pathNames.join(" → ");
        }
      }

      // Add streaming placeholder
      const assistantIdx = currentMessages.length;
      updateMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true, citations: null, createdAt: Date.now() }], effectiveId);

      const payload = currentMessages.map(({ role, content }) => ({ role, content }));

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/workspace-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace,
            messages: payload,
            ...(knowledgeHint?.pinnedNodeIds?.length
              ? { graphNodeIds: knowledgeHint.pinnedNodeIds }
              : graphNodeIds ? { graphNodeIds } : {}),
            ...(graphPathHint ? { graphPathHint } : {}),
            ...(knowledgeHint?.isSummarize ? { mode: "summarize" }
              : mode ? { mode } : {}),
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Request failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accContent = "";
        let finalCitations = null;

        const flush = (line) => {
          if (!line.startsWith("data: ")) return;
          let parsed;
          try { parsed = JSON.parse(line.slice(6)); } catch { return; }

          if (parsed.type === "token") {
            accContent += parsed.content;
            updateMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { ...next[assistantIdx], content: accContent };
              return next;
            }, effectiveId);
          } else if (parsed.type === "correction") {
            accContent = parsed.content;
            updateMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { ...next[assistantIdx], content: accContent };
              return next;
            }, effectiveId);
          } else if (parsed.type === "citations") {
            finalCitations = parsed.sources;
          } else if (parsed.type === "error") {
            throw new Error(parsed.message);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) { if (line.trim()) flush(line); }
        }
        if (buffer.trim()) flush(buffer);

        updateMessages((prev) => {
          const next = [...prev];
          next[assistantIdx] = { role: "assistant", content: accContent, streaming: false, citations: finalCitations };
          return next;
        }, effectiveId);
      } catch (err) {
        if (err.name === "AbortError") {
          updateMessages((prev) => {
            const next = [...prev];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
            return next;
          }, effectiveId);
        } else {
          setError(err.message || "Something went wrong");
          updateMessages((prev) => prev.filter((_, i) => i !== assistantIdx), effectiveId);
        }
      } finally {
        setSending(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [input, sending, workspace, ensureSession, updateMessages, graphData, sessions, activeSession, onBulkPatch, onShowPath]
  );

  // Keep ref in sync so regenerate/editMessage can call the latest sendMessage
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // When a pending question arrives (from detail panel "Ask AI"), create a new session and send.
  // pendingQuestion is { key, text, pinnedNodeIds?, pathHint? } | null.
  // handledPendingRef deduplicates by key to prevent StrictMode double-invocation.
  // autoSendRef stores { text, sessionId, options? } for the no-dep effect below.
  const handledPendingRef = useRef(null);
  const autoSendRef = useRef(null); // { text, sessionId, options? }
  useEffect(() => {
    if (!pendingQuestion || pendingQuestion.key === handledPendingRef.current) return;
    handledPendingRef.current = pendingQuestion.key;
    onPendingConsumed?.();
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    const s = createSession();
    autoSendRef.current = {
      text: pendingQuestion.text,
      sessionId: s.id,
      options: {
        forcedNodeIds: pendingQuestion.pinnedNodeIds || null,
        forcedPathHint: pendingQuestion.pathHint || null,
      },
    };
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);
  // No-dep: runs after every render — fires sendMessage once the new session's activeId commits.
  useEffect(() => {
    if (!autoSendRef.current) return;
    if (autoSendRef.current.sessionId !== activeId) return;
    const { text, options } = autoSendRef.current;
    autoSendRef.current = null;
    sendMessageRef.current?.(text, options);
  });

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="flex flex-1 overflow-hidden min-h-0" style={{ backgroundColor: BG }}>

      {/* Session sidebar */}
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={selectSession}
          onNew={newSession}
          onDelete={deleteSession}
        />
      )}

      {/* Main chat area */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">

        {/* Top bar */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
        >
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: MUTED }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
            title={sidebarOpen ? "Hide history" : "Show history"}
          >
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>

          <span className="text-sm font-medium truncate flex-1" style={{ color: TEXT }}>
            {activeSession?.title ?? "New chat"}
          </span>

          {/* Focus node context pill */}
          {chatFocusNode && (
            <span
              className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.22)", color: "#93c5fd", maxWidth: "120px" }}
              title={`Context: ${chatFocusNode.name}`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#60a5fa" }} />
              <span className="truncate">{chatFocusNode.name}</span>
            </span>
          )}

          <button
            onClick={newSession}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ color: MUTED }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
            title="New chat"
          >
            <SquarePen size={15} />
          </button>
        </div>

        {/* Index status banner (only when index is missing) */}
        {showBanner && (
          <IndexBanner workspace={workspace} onDismiss={() => setShowBanner(false)} />
        )}

        {/* Message list */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-6 min-h-0 relative"
        >
          {messages.length === 0 ? (
            <EmptyState onSend={(t) => sendMessage(t)} graphData={graphData} />
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={i}
                message={msg}
                onOpenNode={onOpenNode}
                graphData={graphData}
                ownFileIds={ownFileIds}
                entityData={entityData}
                onShowPath={onShowPath}
                isLast={i === messages.length - 1}
                onRegenerate={msg.role === "assistant" ? regenerate : undefined}
                onEditSubmit={msg.role === "user" ? (newText) => editMessage(i, newText) : undefined}
              />
            ))
          )}
          {error && (
            <div
              className="mx-10 flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#f87171" }}
            >
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}
          <div ref={bottomRef} />

          {/* Scroll-to-bottom button */}
          {!atBottom && (
            <button
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setAtBottom(true); }}
              className="sticky bottom-4 ml-auto flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-all"
              style={{ backgroundColor: BUBBLE_BG, border: `1px solid ${BORDER_MED}`, color: MUTED }}
              title="Scroll to bottom"
            >
              <ChevronDown size={15} />
            </button>
          )}
        </div>

        {/* Input bar */}
        <div
          className="flex-shrink-0 px-4 pb-4 pt-2"
          style={{ backgroundColor: PANEL_BG }}
        >
          <div
            className="flex items-end gap-2 rounded-2xl px-4 py-3"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              border: `1px solid ${BORDER_MED}`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.03) inset",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your story…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
              style={{ color: TEXT, caretColor: ACCENT, maxHeight: "140px", overflowY: "auto" }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              disabled={sending}
            />
            {sending ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}
                title="Stop"
              >
                <X size={14} />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                style={{
                  backgroundColor: input.trim() ? ACCENT : "transparent",
                  color: input.trim() ? "#fff" : MUTED,
                  opacity: input.trim() ? 1 : 0.5,
                }}
                title="Send (Enter)"
              >
                <Send size={14} />
              </button>
            )}
          </div>
          <p className="text-[10px] text-center mt-2" style={{ color: "rgba(255,255,255,0.15)" }}>
            GPT-4o · grounded in your notes
          </p>
        </div>
      </div>
    </div>
  );
}

import fs from "fs";
import path from "path";
import { walkRelPaths } from "./_walk.js";
import { buildWordBoundaryPattern, collectGreedyMatches } from "../shared/story-rules.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const INDEX_VERSION = 1;
const INDEX_FILE = "backlinks-index.json";

function collectGreedyMentionedNodeIds(content, candidates) {
  const mentioned = new Set();
  const matches = collectGreedyMatches(content, candidates);
  for (const { item } of matches) {
    mentioned.add(item.nodeId);
  }
  return mentioned;
}

function normalizeRelPath(relPath) {
  return String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function listRawFiles(wsDir, notesDir) {
  return walkRelPaths(wsDir, wsDir, new Set([path.resolve(notesDir)]))
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort();
}

function buildRawMtimes(wsDir, files) {
  const mtimes = {};
  for (const relPath of files) {
    const absPath = path.join(wsDir, ...relPath.split("/"));
    try {
      mtimes[relPath] = fs.statSync(absPath).mtimeMs;
    } catch {
      // Skip unreadable files.
    }
  }
  return mtimes;
}

function buildNoteMtimes(notesDir) {
  const mtimes = {};
  if (!fs.existsSync(notesDir)) return mtimes;
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    try {
      mtimes[file] = fs.statSync(path.join(notesDir, file)).mtimeMs;
    } catch {
      // Skip unreadable files.
    }
  }
  return mtimes;
}

function loadNodeCandidates(notesDir) {
  if (!fs.existsSync(notesDir)) return { candidates: [], nodeIds: [] };

  const candidates = fs.readdirSync(notesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
        if (!data?.id || !data?.name) return [];
        const seen = new Set();
        const terms = [];
        for (const value of [data.name, ...(data.aliases || [])]) {
          if (typeof value !== "string") continue;
          const term = value.trim();
          if (!term) continue;
          const key = term.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          terms.push(term);
        }
        return terms.map((term) => ({
          nodeId: data.id,
          term,
          patternSource: buildWordBoundaryPattern(term),
        }));
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));

  const nodeIds = [...new Set(candidates.map((c) => c.nodeId))].sort();
  return { candidates, nodeIds };
}

function getWorkspacePaths(workspace) {
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  return {
    wsDir,
    notesDir: path.join(wsDir, "notes"),
    indexPath: path.join(wsDir, INDEX_FILE),
  };
}

function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    if (!parsed || parsed.version !== INDEX_VERSION || typeof parsed !== "object") return null;
    if (!parsed.backlinksByNodeId || typeof parsed.backlinksByNodeId !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeIndex(indexPath, index) {
  fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8");
}

function removeFileFromAll(backlinksByNodeId, relPath) {
  for (const [nodeId, files] of Object.entries(backlinksByNodeId)) {
    if (!Array.isArray(files) || files.length === 0) continue;
    const next = files.filter((f) => f !== relPath);
    if (next.length > 0) backlinksByNodeId[nodeId] = next;
    else delete backlinksByNodeId[nodeId];
  }
}

function compactAndSortBacklinks(backlinksByNodeId) {
  const next = {};
  for (const [nodeId, files] of Object.entries(backlinksByNodeId || {})) {
    const deduped = [...new Set((files || []).map((f) => normalizeRelPath(f)).filter(Boolean))].sort();
    if (deduped.length > 0) next[nodeId] = deduped;
  }
  return next;
}

export function rebuildBacklinksIndex(workspace) {
  const { wsDir, notesDir, indexPath } = getWorkspacePaths(workspace);
  if (!fs.existsSync(wsDir)) return null;

  const { candidates } = loadNodeCandidates(notesDir);
  const rawFiles = listRawFiles(wsDir, notesDir);
  const backlinksByNodeId = {};

  for (const relPath of rawFiles) {
    let content;
    try {
      content = fs.readFileSync(path.join(wsDir, ...relPath.split("/")), "utf-8");
    } catch {
      continue;
    }
    const mentionedIds = collectGreedyMentionedNodeIds(content, candidates);
    for (const nodeId of mentionedIds) {
      if (!backlinksByNodeId[nodeId]) backlinksByNodeId[nodeId] = [];
      backlinksByNodeId[nodeId].push(relPath);
    }
  }

  const index = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    rawFileMtimes: buildRawMtimes(wsDir, rawFiles),
    noteMtimes: buildNoteMtimes(notesDir),
    backlinksByNodeId: compactAndSortBacklinks(backlinksByNodeId),
  };

  writeIndex(indexPath, index);
  return index;
}

function isIndexStale(index, wsDir, notesDir) {
  if (!index || index.version !== INDEX_VERSION) return true;

  const currentRawFiles = listRawFiles(wsDir, notesDir);
  const savedRawMtimes = index.rawFileMtimes || {};
  if (currentRawFiles.length !== Object.keys(savedRawMtimes).length) return true;

  for (const relPath of currentRawFiles) {
    const absPath = path.join(wsDir, ...relPath.split("/"));
    let mtime;
    try {
      mtime = fs.statSync(absPath).mtimeMs;
    } catch {
      return true;
    }
    if (savedRawMtimes[relPath] !== mtime) return true;
  }

  const currentNoteMtimes = buildNoteMtimes(notesDir);
  const savedNoteMtimes = index.noteMtimes || {};
  const noteFiles = Object.keys(currentNoteMtimes);
  if (noteFiles.length !== Object.keys(savedNoteMtimes).length) return true;
  for (const file of noteFiles) {
    if (savedNoteMtimes[file] !== currentNoteMtimes[file]) return true;
  }

  return false;
}

export function ensureFreshBacklinksIndex(workspace) {
  const { wsDir, notesDir, indexPath } = getWorkspacePaths(workspace);
  if (!fs.existsSync(wsDir)) return null;

  const current = readIndex(indexPath);
  if (!current) return rebuildBacklinksIndex(workspace);
  if (isIndexStale(current, wsDir, notesDir)) return rebuildBacklinksIndex(workspace);
  return current;
}

export function getBacklinksForNode(workspace, nodeId) {
  const index = ensureFreshBacklinksIndex(workspace);
  if (!index || !nodeId) return [];
  const files = index.backlinksByNodeId?.[nodeId];
  return Array.isArray(files) ? files : [];
}

/**
 * Incrementally update index entries for changed/deleted raw files.
 * Falls back to a full rebuild if the index is missing or invalid.
 */
export function updateBacklinksIndexForFiles(workspace, { upsertFiles = [], removedFiles = [] } = {}) {
  const { wsDir, notesDir, indexPath } = getWorkspacePaths(workspace);
  if (!fs.existsSync(wsDir)) return null;

  let index = readIndex(indexPath);
  if (!index) index = rebuildBacklinksIndex(workspace);
  if (!index) return null;

  const { candidates } = loadNodeCandidates(notesDir);
  const backlinksByNodeId = { ...(index.backlinksByNodeId || {}) };

  const removed = [...new Set(removedFiles.map(normalizeRelPath).filter(Boolean))];
  const upserts = [...new Set(upsertFiles.map(normalizeRelPath).filter(Boolean))];

  for (const relPath of removed) {
    removeFileFromAll(backlinksByNodeId, relPath);
  }

  for (const relPath of upserts) {
    removeFileFromAll(backlinksByNodeId, relPath);
    const absPath = path.join(wsDir, ...relPath.split("/"));
    if (!fs.existsSync(absPath)) continue;

    let content;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const mentionedIds = collectGreedyMentionedNodeIds(content, candidates);
    for (const nodeId of mentionedIds) {
      if (!backlinksByNodeId[nodeId]) backlinksByNodeId[nodeId] = [];
      backlinksByNodeId[nodeId].push(relPath);
    }
  }

  const rawFiles = listRawFiles(wsDir, notesDir);
  const rawSet = new Set(rawFiles);
  // Strip any lingering refs to deleted files.
  for (const [nodeId, files] of Object.entries(backlinksByNodeId)) {
    const next = (files || []).filter((f) => rawSet.has(f));
    if (next.length > 0) backlinksByNodeId[nodeId] = next;
    else delete backlinksByNodeId[nodeId];
  }

  const nextIndex = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    rawFileMtimes: buildRawMtimes(wsDir, rawFiles),
    noteMtimes: buildNoteMtimes(notesDir),
    backlinksByNodeId: compactAndSortBacklinks(backlinksByNodeId),
  };

  writeIndex(indexPath, nextIndex);
  return nextIndex;
}

import fs from "fs";
import path from "path";
import { walkRelPaths } from "./_walk.js";
import { buildWordBoundaryPattern, collectGreedyMatches } from "../shared/story-rules.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const INDEX_VERSION = 1;
const INDEX_FILE = "backlinks-index.json";
const NOTES_VERSION_FILE = "notes-version.json";

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

function buildNoteFileList(notesDir) {
  if (!fs.existsSync(notesDir)) return [];
  return fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")).sort();
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
  const files = buildNoteFileList(notesDir);
  for (const file of files) {
    try {
      mtimes[file] = fs.statSync(path.join(notesDir, file)).mtimeMs;
    } catch {
      // Skip unreadable files.
    }
  }
  return mtimes;
}

function hasListDrift(savedList, currentList) {
  if (savedList.length !== currentList.length) return true;
  for (let i = 0; i < currentList.length; i += 1) {
    if (savedList[i] !== currentList[i]) return true;
  }
  return false;
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
    notesVersionPath: path.join(wsDir, NOTES_VERSION_FILE),
  };
}

function readWorkspaceVersion(notesVersionPath) {
  if (!fs.existsSync(notesVersionPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(notesVersionPath, "utf-8"));
    if (raw?.version === undefined || raw?.version === null) return null;
    return String(raw.version);
  } catch {
    return null;
  }
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

const pendingBacklinksRebuilds = new Map();

function scheduleBacklinksRebuild(workspace) {
  if (!workspace || pendingBacklinksRebuilds.has(workspace)) return;
  const task = Promise.resolve()
    .then(() => rebuildBacklinksIndex(workspace))
    .catch(() => null)
    .finally(() => {
      pendingBacklinksRebuilds.delete(workspace);
    });
  pendingBacklinksRebuilds.set(workspace, task);
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
  const { wsDir, notesDir, indexPath, notesVersionPath } = getWorkspacePaths(workspace);
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
    workspaceVersion: readWorkspaceVersion(notesVersionPath),
    rawFileMtimes: buildRawMtimes(wsDir, rawFiles),
    noteMtimes: buildNoteMtimes(notesDir),
    backlinksByNodeId: compactAndSortBacklinks(backlinksByNodeId),
  };

  writeIndex(indexPath, index);
  return index;
}

export function ensureFreshBacklinksIndex(workspace) {
  const { wsDir, notesDir, indexPath, notesVersionPath } = getWorkspacePaths(workspace);
  if (!fs.existsSync(wsDir)) return null;

  const current = readIndex(indexPath);
  if (!current) {
    scheduleBacklinksRebuild(workspace);
    return null;
  }
  const workspaceVersion = readWorkspaceVersion(notesVersionPath);

  // Fast path: when notes-version.json is available, freshness is O(1).
  // On version mismatch we rebuild once from token drift (no per-file stat scan).
  if (workspaceVersion !== null) {
    if (current.workspaceVersion !== workspaceVersion) return rebuildBacklinksIndex(workspace);
    return current;
  }

  // Lightweight fallback when version token is unavailable:
  // detect only add/remove/rename drift (no per-file stat calls).
  const rawFiles = listRawFiles(wsDir, notesDir);
  const savedRawFiles = Object.keys(current.rawFileMtimes || {}).sort();
  if (hasListDrift(savedRawFiles, rawFiles)) return rebuildBacklinksIndex(workspace);

  const noteFiles = buildNoteFileList(notesDir);
  const savedNoteFiles = Object.keys(current.noteMtimes || {}).sort();
  if (hasListDrift(savedNoteFiles, noteFiles)) return rebuildBacklinksIndex(workspace);

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
  const { wsDir, notesDir, indexPath, notesVersionPath } = getWorkspacePaths(workspace);
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
    workspaceVersion: readWorkspaceVersion(notesVersionPath),
    rawFileMtimes: buildRawMtimes(wsDir, rawFiles),
    noteMtimes: buildNoteMtimes(notesDir),
    backlinksByNodeId: compactAndSortBacklinks(backlinksByNodeId),
  };

  writeIndex(indexPath, nextIndex);
  return nextIndex;
}

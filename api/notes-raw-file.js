import fs from "fs";
import path from "path";
import { findDuplicate } from "./dedup-nodes.js";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";
import { walkRelPaths, walkAbsPaths, walkNodeIds, normalizeSourceFile } from "./_walk.js";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

/** Collect relative paths of .md/.txt files, skipping excludeDir. */
function scanRawFiles(dir, baseDir, excludeDir) {
  return walkRelPaths(dir, baseDir, new Set([path.resolve(excludeDir)]));
}

function resolveDirs(workspace) {
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  return {
    dir: wsDir,
    notesDir: path.join(wsDir, "notes"),
  };
}

/**
 * Return the first node type key defined in workspace.json's nodeTypes, falling
 * back to "character" for workspaces that use the default narrative config.
 */
function getDefaultNodeType(workspace) {
  try {
    const wsJson = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, workspace, "workspace.json"), "utf-8"));
    const keys = Object.keys(wsJson.nodeTypes || {});
    if (keys.length > 0) return keys[0];
  } catch { /* no config or parse error */ }
  return "character";
}

/**
 * Read all node JSONs from notesDir, build a list of { id, patterns[] } where
 * patterns covers the node name and each alias. Then scan `content` for any
 * mentions, update the source node's connections array, and add reverse
 * connections on each mentioned node.
 */
function syncConnectionsForFile(filename, content, sourceId, notesDir) {
  if (!fs.existsSync(notesDir)) return;
  const jsonFiles = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));

  // Build lookup: id → { data, path, patterns }
  const nodeMap = new Map();
  for (const jf of jsonFiles) {
    const jPath = path.join(notesDir, jf);
    let data;
    try { data = JSON.parse(fs.readFileSync(jPath, "utf-8")); } catch { continue; }
    if (!data.id || !data.name) continue;
    const names = [data.name, ...(data.aliases || [])];
    const patterns = names.map((n) => {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${esc}\\b`, "i");
    });
    nodeMap.set(data.id, { data, path: jPath, patterns });
  }

  if (!nodeMap.has(sourceId)) return;

  // Determine which nodes are mentioned in content (excluding self)
  const mentionedIds = new Set();
  for (const [id, { patterns }] of nodeMap) {
    if (id === sourceId) continue;
    if (patterns.some((p) => p.test(content))) mentionedIds.add(id);
  }

  // Update source node: set connections to exactly the mentioned set, preserving labels
  const { data: srcData, path: srcPath } = nodeMap.get(sourceId);
  const existingConns = new Map((srcData.connections || []).map((c) => [c.target, c]));
  const newConns = [];
  for (const id of mentionedIds) {
    newConns.push(existingConns.get(id) ?? { target: id, label: "references" });
  }
  // Keep connections to nodes NOT in the map (external refs), keep manual ones not in content
  for (const [target, conn] of existingConns) {
    if (!mentionedIds.has(target) && !nodeMap.has(target)) newConns.push(conn);
  }
  srcData.connections = newConns;
  srcData.updatedAt = Date.now();
  fs.writeFileSync(srcPath, JSON.stringify(srcData, null, 2), "utf-8");

  // Add reverse reference on each mentioned target (don't remove existing ones)
  for (const id of mentionedIds) {
    const { data: tgtData, path: tgtPath } = nodeMap.get(id);
    const alreadyLinked = (tgtData.connections || []).some((c) => c.target === sourceId);
    if (!alreadyLinked) {
      tgtData.connections = [...(tgtData.connections || []), { target: sourceId, label: "references" }];
      tgtData.updatedAt = Date.now();
      fs.writeFileSync(tgtPath, JSON.stringify(tgtData, null, 2), "utf-8");
    }
  }
}

export default function handler(req, res) {
  const dirs = resolveDirs(req.query.workspace);
  if (!dirs) return res.status(400).json({ error: "Invalid workspace" });
  const { dir, notesDir } = dirs;
  const { filename } = req.query;

  // Allow sub-paths (folder/file.md) but prevent directory traversal.
  // Every path segment must be a non-empty, non-dotfile, non-traversal name.
  const isFolder = (req.method === "POST" && req.body?.isFolder === true) ||
                   (req.method === "DELETE" && req.query.isFolder === "true");
  const segments = filename ? filename.split(/[\/\\]/) : [];
  const badSegment = segments.some((s) => s === ".." || s === "." || s === "");
  const needsTextExt = !isFolder;
  if (!filename || badSegment || (needsTextExt && !/\.(md|txt)$/i.test(filename))) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  // Verify the resolved path stays within the workspace (double-check after join)
  // and does NOT point into the notes/ output directory.
  const filePath = path.join(dir, ...segments);
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  const resolvedNotesDir = path.resolve(notesDir);
  if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (resolvedPath === resolvedNotesDir || resolvedPath.startsWith(resolvedNotesDir + path.sep)) {
    return res.status(400).json({ error: "Cannot write to notes output directory" });
  }

  // ── GET: read file ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ filename, content });
  }

  // ── POST: create new file or folder ─────────────────────────────────────────
  if (req.method === "POST") {
    if (isFolder) {
      if (fs.existsSync(filePath)) return res.status(409).json({ error: "Folder already exists" });
      fs.mkdirSync(filePath, { recursive: true });
      return res.status(201).json({ path: filename });
    }
    if (fs.existsSync(filePath)) return res.status(409).json({ error: "File already exists" });
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(filePath, req.body?.content ?? "", "utf-8");

    // If a name is provided, create or attach the corresponding node JSON in notes/.
    // Importantly, dedupe against existing nodes first so adding a raw file for a grey
    // node does not spawn a second JSON for the same character/faction.
    const { name: nodeName } = req.body || {};
    if (nodeName && typeof nodeName === "string" && nodeName.trim()) {
      const trimmedName = nodeName.trim().substring(0, 120);
      const requestedId = path.basename(filename)
        .replace(/\.(md|txt)$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

      const existingNodes = fs.readdirSync(notesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(notesDir, f), "utf-8"));
            if (!data.id || !data.name) return null;
            return {
              id: data.id,
              name: data.name,
              type: data.type || "character",
              aliases: data.aliases || [],
              notes: data.notes || "",
              connections: data.connections || [],
              sourceFile: data.sourceFile || "",
              additionalSourceFiles: data.additionalSourceFiles || [],
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const matched = findDuplicate(trimmedName, requestedId, existingNodes);
      const nodeId = matched?.id || requestedId;
      const nodeJsonPath = path.join(notesDir, `${nodeId}.json`);

      let nodeData;
      if (fs.existsSync(nodeJsonPath)) {
        try {
          nodeData = JSON.parse(fs.readFileSync(nodeJsonPath, "utf-8"));
        } catch {
          nodeData = null;
        }
      }
      if (!nodeData) {
        nodeData = {
          id: nodeId,
          name: trimmedName,
          type: getDefaultNodeType(req.query.workspace),
          excerpt: "",
          notes: "",
          aliases: [],
          connections: [],
          sourceFile: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      const aliasSet = new Set((nodeData.aliases || []).map((a) => a.toLowerCase()));
      if (trimmedName.toLowerCase() !== (nodeData.name || "").toLowerCase() && !aliasSet.has(trimmedName.toLowerCase())) {
        nodeData.aliases = [...(nodeData.aliases || []), trimmedName];
      }
      const allSourceFiles = [nodeData.sourceFile, ...(nodeData.additionalSourceFiles || []), filename].filter(Boolean);
      const primarySourceFile = nodeData.sourceFile || filename;
      nodeData.sourceFile = primarySourceFile;
      const extraSourceFiles = [...new Set(allSourceFiles.filter((f) => f !== primarySourceFile))];
      if (extraSourceFiles.length > 0) nodeData.additionalSourceFiles = extraSourceFiles;
      else delete nodeData.additionalSourceFiles;
      nodeData.updatedAt = Date.now();
      fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeData, null, 2), "utf-8");

      // Seed connections: scan all raw files for mentions of the node's name.
      const escaped = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namePattern = new RegExp(`\\b${escaped}\\b`, "i");
      const allRawFiles = scanRawFiles(dir, dir, notesDir);

      for (const relPath of allRawFiles) {
        if (relPath === filename) continue; // skip the new file itself
        let rawContent;
        try { rawContent = fs.readFileSync(path.join(dir, relPath), "utf-8"); } catch { continue; }
        if (!namePattern.test(rawContent)) continue;

        const mentionerStem = relPath.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
        const mentionerJsonPath = path.join(notesDir, `${mentionerStem}.json`);
        if (!fs.existsSync(mentionerJsonPath)) continue;

        let mentionerData;
        try { mentionerData = JSON.parse(fs.readFileSync(mentionerJsonPath, "utf-8")); } catch { continue; }
        const alreadyLinked = (mentionerData.connections || []).some((c) => c.target === nodeId);
        if (!alreadyLinked) {
          mentionerData.connections = [...(mentionerData.connections || []), { target: nodeId, label: "references" }];
          mentionerData.updatedAt = Date.now();
          fs.writeFileSync(mentionerJsonPath, JSON.stringify(mentionerData, null, 2), "utf-8");
        }
      }

      rebuildGraphCache(req.query.workspace, notesDir);
      bumpWorkspaceVersion(req.query.workspace);
    }

    return res.status(201).json({ filename });
  }

  // ── PUT: save existing file ─────────────────────────────────────────────────
  if (req.method === "PUT") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = req.body?.content ?? "";
    fs.writeFileSync(filePath, content, "utf-8");
    const rawStem = path.basename(filename).replace(/\.(md|txt)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const rawNodeJsonPath = path.join(notesDir, `${rawStem}.json`);
    if (fs.existsSync(rawNodeJsonPath)) {
      try {
        syncConnectionsForFile(filename, content, rawStem, notesDir);
        rebuildGraphCache(req.query.workspace, notesDir);
        bumpWorkspaceVersion(req.query.workspace);
      } catch { /* non-fatal */ }
    }
    return res.status(200).json({ filename });
  }

  // ── PATCH: update aliases in the corresponding notes/ JSON ─────────────────
  if (req.method === "PATCH") {
    const nodeId = path.basename(filename).replace(/\.(md|txt)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const jsonPath = path.join(notesDir, `${nodeId}.json`);
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "Node JSON not found" });
    const { aliases, tags, name, type, propagate } = req.body || {};
    if (aliases !== undefined && !Array.isArray(aliases)) return res.status(400).json({ error: "aliases must be an array" });
    if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ error: "tags must be an array" });
    if (name !== undefined && (typeof name !== "string" || !name.trim())) return res.status(400).json({ error: "name must be a non-empty string" });
    if (type !== undefined && (typeof type !== "string" || !type.trim())) return res.status(400).json({ error: "type must be a non-empty string" });
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (aliases !== undefined) {
      data.aliases = aliases
        .filter((a) => typeof a === "string" && a.trim().length > 0)
        .map((a) => a.trim().substring(0, 60));
    }
    if (tags !== undefined) {
      data.tags = tags
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").substring(0, 40));
    }
    let filesUpdated = [];
    if (type !== undefined) {
      data.type = type.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").substring(0, 40);
    }
    if (name !== undefined) {
      const oldName = data.name ?? "";
      data.name = name.trim().substring(0, 120);

      if (propagate && oldName && data.name !== oldName) {
        // Identify which tokens (words) changed between old and new name
        const oldTokens = oldName.split(/\s+/);
        const newTokens = data.name.split(/\s+/);
        const changedPairs = [];
        const seenOld = new Set();
        const minLen = Math.min(oldTokens.length, newTokens.length);
        for (let i = 0; i < minLen; i++) {
          if (oldTokens[i] !== newTokens[i] && !seenOld.has(oldTokens[i])) {
            changedPairs.push({ old: oldTokens[i], new: newTokens[i] });
            seenOld.add(oldTokens[i]);
          }
        }

        if (changedPairs.length > 0) {
          // Update any alias that exactly matches a changed old token
          data.aliases = (data.aliases || []).map((alias) => {
            const pair = changedPairs.find((p) => p.old.toLowerCase() === alias.toLowerCase());
            return pair ? pair.new : alias;
          });

          // Build replacement patterns: full name first, then standalone changed tokens
          const patterns = [
            { regex: new RegExp(escapeRegex(oldName), "g"), replacement: data.name },
            ...changedPairs.map((p) => ({
              regex: new RegExp(`\\b${escapeRegex(p.old)}\\b`, "g"),
              replacement: p.new,
            })),
          ];

          // Scope replacements to only files known to mention the old name.
          // The client passes `affectedFiles` (from its backlinks cache);
          // fall back to a full scan when the list is not provided.
          const resolvedWsDir = path.resolve(dir);
          const resolvedNotesDir = path.resolve(notesDir);
          const { affectedFiles } = req.body;
          let filesToScan;
          if (Array.isArray(affectedFiles)) {
            const scopedPaths = new Set();
            // Include the entity's own file (backlinks excludes self)
            if (fs.existsSync(filePath)) scopedPaths.add(path.resolve(filePath));
            for (const rel of affectedFiles) {
              const segs = (typeof rel === "string" ? rel : "").split(/[\/\\]/);
              if (segs.some((s) => s === ".." || s === "." || s === "")) continue;
              if (!/\.(md|txt)$/i.test(rel)) continue;
              const abs = path.resolve(path.join(dir, ...segs));
              if (!abs.startsWith(resolvedWsDir + path.sep) && abs !== resolvedWsDir) continue;
              if (abs.startsWith(resolvedNotesDir + path.sep)) continue;
              if (fs.existsSync(abs)) scopedPaths.add(abs);
            }
            filesToScan = [...scopedPaths];
          } else {
            filesToScan = collectRawFiles(dir, notesDir);
          }
          for (const rawFile of filesToScan) {
            let content = fs.readFileSync(rawFile, "utf-8");
            let updated = content;
            for (const { regex, replacement } of patterns) {
              updated = updated.replace(regex, replacement);
            }
            if (updated !== content) {
              fs.writeFileSync(rawFile, updated, "utf-8");
              filesUpdated.push(path.relative(resolvedWsDir, rawFile).replace(/\\/g, "/"));
            }
          }
        }
      }
    }

    data.updatedAt = Date.now();
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
    rebuildGraphCache(req.query.workspace, dirs.notesDir);
    bumpWorkspaceVersion(req.query.workspace);
    return res.status(200).json({ aliases: data.aliases, tags: data.tags, name: data.name, type: data.type, filesUpdated });
  }

  // ── DELETE: remove file or empty folder ────────────────────────────────────
  if (req.method === "DELETE") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    if (req.query.isFolder === "true") {
      if (req.query.recursive === "true") {
        // Collect node IDs both by filename-stem and by sourceFile reference
        const stemIds = collectNodeIds(filePath);
        const folderRel = path.relative(dir, filePath).replace(/\\/g, "/");
        const sourceFileIds = findNodesBySourceFilePrefix(notesDir, folderRel + "/");
        const deletedIds = [...new Set([...stemIds, ...sourceFileIds])];
        try { fs.rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
        if (deletedIds.length) {
          purgeNodes(notesDir, deletedIds);
          rebuildGraphCache(req.query.workspace, notesDir);
          bumpWorkspaceVersion(req.query.workspace);
        } else {
          // Still bump so the graph refreshes even if no nodes were tracked
          rebuildGraphCache(req.query.workspace, notesDir);
          bumpWorkspaceVersion(req.query.workspace);
        }
      } else {
        // Non-recursive: only removes if already empty (safe for "move files first" flow)
        try { fs.rmdirSync(filePath); } catch { /* ignore */ }
      }
      return res.status(200).json({ path: filename });
    }
    fs.unlinkSync(filePath);
    // Clean up node JSONs: match by filename-stem AND by sourceFile field
    const stemId = path.basename(filename).replace(/\.(md|txt)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const sourceFileIds = findNodesBySourceFile(notesDir, filename);
    const allIds = [...new Set([stemId, ...sourceFileIds])];
    purgeNodes(notesDir, allIds);
    rebuildGraphCache(req.query.workspace, notesDir);
    bumpWorkspaceVersion(req.query.workspace);
    return res.status(200).json({ filename });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

/**
 * Escape a string for use in a RegExp constructor.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collect absolute paths of .md/.txt files, skipping notesDir. */
function collectRawFiles(wsDir, notesDir) {
  return walkAbsPaths(wsDir, new Set([path.resolve(notesDir)]));
}

/** Collect snake_case node IDs from .md/.txt filenames under folderPath. */
function collectNodeIds(folderPath) {
  return walkNodeIds(folderPath);
}

/**
 * Delete each node's JSON from notesDir, then strip connections targeting any
 * of the deleted node IDs from every remaining node JSON.
 */
function purgeNodes(notesDir, nodeIds) {
  if (!fs.existsSync(notesDir)) return;
  const idSet = new Set(nodeIds);

  // Delete the node JSONs themselves
  for (const id of nodeIds) {
    const jsonPath = path.join(notesDir, `${id}.json`);
    if (fs.existsSync(jsonPath)) {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
    }
  }

  // Strip outgoing connections that target a deleted node from surviving nodes
  let entries;
  try { entries = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const file of entries) {
    const jsonPath = path.join(notesDir, file);
    let data;
    try { data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); } catch { continue; }
    if (!Array.isArray(data.connections)) continue;
    const filtered = data.connections.filter((c) => !idSet.has(c.target));
    if (filtered.length !== data.connections.length) {
      data.connections = filtered;
      try { fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8"); } catch { /* ignore */ }
    }
  }
}

/**
 * Find node IDs whose sourceFile (or additionalSourceFiles) exactly matches the
 * given relative path. Used when a single raw file is deleted.
 */
function findNodesBySourceFile(notesDir, sourceFile) {
  if (!fs.existsSync(notesDir)) return [];
  const ids = [];
  const normalized = normalizeSourceFile(sourceFile);
  let entries;
  try { entries = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")); } catch { return ids; }
  for (const file of entries) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8")); } catch { continue; }
    if (
      normalizeSourceFile(data.sourceFile) === normalized ||
      (Array.isArray(data.additionalSourceFiles) && data.additionalSourceFiles.some((sf) => normalizeSourceFile(sf) === normalized))
    ) {
      if (data.id) ids.push(data.id);
    }
  }
  return ids;
}

/**
 * Find node IDs whose sourceFile starts with the given folder prefix.
 * Used when a folder is deleted recursively.
 */
function findNodesBySourceFilePrefix(notesDir, prefix) {
  if (!fs.existsSync(notesDir)) return [];
  const ids = [];
  let entries;
  try { entries = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")); } catch { return ids; }
  for (const file of entries) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8")); } catch { continue; }
    if (
      (data.sourceFile && data.sourceFile.startsWith(prefix)) ||
      (Array.isArray(data.additionalSourceFiles) && data.additionalSourceFiles.some((sf) => sf.startsWith(prefix)))
    ) {
      if (data.id) ids.push(data.id);
    }
  }
  return ids;
}

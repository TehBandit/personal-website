import fs from "fs";
import path from "path";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

function resolveDirs(workspace) {
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  return {
    dir: wsDir,
    notesDir: path.join(wsDir, "notes"),
  };
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
    return res.status(201).json({ filename });
  }

  // ── PUT: save existing file ─────────────────────────────────────────────────
  if (req.method === "PUT") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = req.body?.content ?? "";
    fs.writeFileSync(filePath, content, "utf-8");
    return res.status(200).json({ filename });
  }

  // ── PATCH: update aliases in the corresponding notes/ JSON ─────────────────
  if (req.method === "PATCH") {
    const nodeId = path.basename(filename).replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    const jsonPath = path.join(notesDir, `${nodeId}.json`);
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "Node JSON not found" });
    const { aliases, name, propagate } = req.body || {};
    if (aliases !== undefined && !Array.isArray(aliases)) return res.status(400).json({ error: "aliases must be an array" });
    if (name !== undefined && (typeof name !== "string" || !name.trim())) return res.status(400).json({ error: "name must be a non-empty string" });
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (aliases !== undefined) {
      data.aliases = aliases
        .filter((a) => typeof a === "string" && a.trim().length > 0)
        .map((a) => a.trim().substring(0, 60));
    }
    let filesUpdated = [];
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

          // Apply to every raw file in the workspace (excluding notes/ output dir)
          const resolvedWsDir = path.resolve(dir);
          for (const rawFile of collectRawFiles(dir, notesDir)) {
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

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
    rebuildGraphCache(req.query.workspace, dirs.notesDir);
    bumpWorkspaceVersion(req.query.workspace);
    return res.status(200).json({ aliases: data.aliases, name: data.name, filesUpdated });
  }

  // ── DELETE: remove file or empty folder ────────────────────────────────────
  if (req.method === "DELETE") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    if (req.query.isFolder === "true") {
      if (req.query.recursive === "true") {
        // Collect all tracked raw files inside before wiping the folder
        const deletedIds = collectNodeIds(filePath, dir);
        try { fs.rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
        if (deletedIds.length) {
          purgeNodes(notesDir, deletedIds);
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
    // Clean up the corresponding node JSON and any connections pointing to it
    const nodeId = path.basename(filename).replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    purgeNodes(notesDir, [nodeId]);
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

/**
 * Recursively collect all .md/.txt files in wsDir, excluding the notes/ output dir.
 */
function collectRawFiles(wsDir, notesDir) {
  const files = [];
  const excludeDir = path.resolve(notesDir);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(full) !== excludeDir) walk(full);
      } else if (/\.(md|txt)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  }
  walk(wsDir);
  return files;
}

/**
 * Collect snake_case node IDs for every .md/.txt file found recursively under `folderPath`.
 * Paths are relative to `baseDir`.
 */
function collectNodeIds(folderPath, baseDir) {
  const ids = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (/\.(md|txt)$/i.test(entry.name)) {
        ids.push(path.basename(entry.name).replace(/\.(md|txt)$/i, "").replace(/-/g, "_"));
      }
    }
  }
  walk(folderPath);
  return ids;
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

import fs from "fs";
import path from "path";
import { findDuplicate } from "./dedup-nodes.js";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { updateBacklinksIndexForFiles } from "./_backlinks-index.js";
import { walkRelPaths, walkAbsPaths, walkNodeIds, normalizeSourceFile, extractTitleFromContent } from "./_walk.js";
import { buildWordBoundaryPattern, collectGreedyMatches } from "../shared/story-rules.js";
import { resolveWorkspaceDirs, WORKSPACES_DIR } from "./_storygraph-paths.js";
import { ensureDir } from "./_storygraph-io.js";

/** Collect relative paths of .md/.txt files, skipping excludeDir. */
function scanRawFiles(dir, baseDir, excludeDir) {
  return walkRelPaths(dir, baseDir, new Set([path.resolve(excludeDir)]));
}

function resolveDirs(workspace) {
  const dirs = resolveWorkspaceDirs(workspace);
  if (!dirs) return null;
  return {
    dir: dirs.wsDir,
    notesDir: dirs.notesDir,
  };
}

// Preserve inline span styles when a client serializer strips them to plain text
// (observed with some markdown editor round-trips on load/autosave).
function preserveStyledSpans(existingContent, nextContent) {
  const existing = typeof existingContent === "string" ? existingContent : "";
  let next = typeof nextContent === "string" ? nextContent : "";
  const hasStyledSpan = existing.includes("<span style=");
  const hasColorFont = /<font\s+color=/i.test(existing);
  const hasColorMark = /<mark\s+data-color=/i.test(existing);
  const incomingHasFormatting = next.includes("<span style=") || /<font\s+color=/i.test(next) || /<mark\s+data-color=/i.test(next);
  if (!(hasStyledSpan || hasColorFont || hasColorMark) || incomingHasFormatting) return next;

  const rules = [
    {
      full: /<span\s+style="[^"]*">[\s\S]*?<\/span>/g,
      plain: /<span\s+style="[^"]*">([\s\S]*?)<\/span>/g,
    },
    {
      full: /<font\s+color="[^"]*">[\s\S]*?<\/font>/gi,
      plain: /<font\s+color="[^"]*">([\s\S]*?)<\/font>/gi,
    },
    {
      full: /<mark\s+data-color="[^"]*">[\s\S]*?<\/mark>/gi,
      plain: /<mark\s+data-color="[^"]*">([\s\S]*?)<\/mark>/gi,
    },
  ];

  for (const rule of rules) {
    const fullMatches = [...existing.matchAll(rule.full)].map((m) => m[0]);
    const plainMatches = [...existing.matchAll(rule.plain)].map((m) => m[1]);

    for (let i = 0; i < fullMatches.length; i++) {
      const fullMarkup = fullMatches[i];
      const plainText = plainMatches[i] ?? "";
      if (!plainText) continue;
      if (next.includes(fullMarkup)) continue;

      const idx = next.indexOf(plainText);
      if (idx === -1) continue;
      next = next.slice(0, idx) + fullMarkup + next.slice(idx + plainText.length);
    }
  }

  return next;
}

function hasFormattingTags(value) {
  const text = typeof value === "string" ? value : "";
  return {
    hasSpan: /<span\s+style=/i.test(text),
    hasFont: /<font\s+color=/i.test(text),
    hasMark: /<mark\s+data-color=/i.test(text),
  };
}

function snippetAroundFormatting(value) {
  const text = typeof value === "string" ? value : "";
  const idx = text.search(/Highlight|Color Text|<mark\s+data-color=|<font\s+color=/i);
  if (idx < 0) return "";
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 220);
  return text.slice(start, end).replace(/\r\n/g, "\\n").replace(/\n/g, "\\n");
}

function appendWriteTrace(dir, req, phase, payload) {
  const traceEnabledByQuery = req.query?.trace === "1";
  const traceEnabledByFile = fs.existsSync(path.join(dir, "_notes_trace_on"));
  if (!traceEnabledByQuery && !traceEnabledByFile) return;

  const hasAnyFmt = (f) => Boolean(f?.hasSpan || f?.hasFont || f?.hasMark);
  const isSuspicious = (() => {
    if (payload?.error) return true;
    if (phase === "PUT-before-write") {
      const hadFormatting = hasAnyFmt(payload?.incomingFlags) || hasAnyFmt(payload?.existingFlags);
      const finalHasFormatting = hasAnyFmt(payload?.finalFlags);
      if (hadFormatting && !finalHasFormatting) return true;
      if (typeof payload?.incomingLength === "number" && payload.incomingLength > 0 && payload?.finalLength === 0) return true;
      return false;
    }
    if (phase === "POST-write") {
      if (typeof payload?.incomingLength === "number" && payload.incomingLength === 0) return true;
      return false;
    }
    if (phase === "GET-read") {
      if (typeof payload?.contentLength === "number" && payload.contentLength === 0) return true;
      return false;
    }
    return false;
  })();
  if (!isSuspicious) return;

  const tracePath = path.join(dir, "_notes_write_trace.log");
  const row = {
    ts: new Date().toISOString(),
    method: req.method,
    phase,
    filename: req.query?.filename || "",
    workspace: req.query?.workspace || "",
    ua: req.headers["user-agent"] || "",
    referer: req.headers.referer || req.headers.referrer || "",
    ...payload,
  };
  try {
    fs.appendFileSync(tracePath, `${JSON.stringify(row)}\n`, "utf-8");
  } catch {
    // non-fatal debug instrumentation
  }
}

/**
 * Detect mentioned node IDs via greedy non-overlapping phrase matching.
 * Longer names/aliases claim spans first so shorter substrings cannot steal
 * matches inside those spans (e.g. "management" inside "management history").
 */
function collectGreedyMentionedNodeIds(content, nodeMap, sourceId) {
  const candidates = [];
  for (const [id, { terms }] of nodeMap) {
    if (id === sourceId) continue;
    for (const term of terms) {
      candidates.push({
        nodeId: id,
        term,
        patternSource: buildWordBoundaryPattern(term),
      });
    }
  }

  candidates.sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));

  const mentionedIds = new Set();
  const matches = collectGreedyMatches(content, candidates);
  for (const { item } of matches) {
    mentionedIds.add(item.nodeId);
  }

  return mentionedIds;
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
  const jsonFiles = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")).sort();

  // Build lookup: id → { data, path, patterns }
  const nodeMap = new Map();
  for (const jf of jsonFiles) {
    const jPath = path.join(notesDir, jf);
    let data;
    try { data = JSON.parse(fs.readFileSync(jPath, "utf-8")); } catch { continue; }
    if (!data.id || !data.name) continue;
    const seenTerms = new Set();
    const terms = [];
    for (const value of [data.name, ...(data.aliases || [])]) {
      if (typeof value !== "string") continue;
      const term = value.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      terms.push(term);
    }
    nodeMap.set(data.id, { data, path: jPath, terms });
  }

  if (!nodeMap.has(sourceId)) return;

  // Determine which nodes are mentioned in content (excluding self)
  const mentionedIds = collectGreedyMentionedNodeIds(content, nodeMap, sourceId);

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
  const segments = filename ? filename.split(/[/\\]/) : [];
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
    appendWriteTrace(dir, req, "GET-read", {
      contentFlags: hasFormattingTags(content),
      contentSnippet: snippetAroundFormatting(content),
      contentLength: content.length,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ filename, content });
  }

  // ── POST: create new file or folder ─────────────────────────────────────────
  if (req.method === "POST") {
    if (isFolder) {
      if (fs.existsSync(filePath)) return res.status(409).json({ error: "Folder already exists" });
      ensureDir(filePath);
      return res.status(201).json({ path: filename });
    }
    if (fs.existsSync(filePath)) return res.status(409).json({ error: "File already exists" });
    const parentDir = path.dirname(filePath);
    ensureDir(parentDir);
    const postContent = req.body?.content ?? "";
    fs.writeFileSync(filePath, postContent, "utf-8");
    appendWriteTrace(dir, req, "POST-write", {
      incomingFlags: hasFormattingTags(postContent),
      incomingSnippet: snippetAroundFormatting(postContent),
      incomingLength: postContent.length,
      destinationPath: path.relative(dir, filePath).replace(/\\/g, "/"),
    });

    // If a name is provided, create or attach the corresponding node JSON in notes/.
    // Importantly, dedupe against existing nodes first so adding a raw file for a grey
    // node does not spawn a second JSON for the same character/faction.
    const { name: nodeName, content: bodyContent } = req.body || {};
    // If the file content has a detectable title (heading or styled first line),
    // prefer it over the filename-derived name — but only when content is non-empty.
    const contentTitle = (typeof bodyContent === "string" && bodyContent.trim())
      ? extractTitleFromContent(bodyContent)
      : null;
    const effectiveName = contentTitle || nodeName;
    if (effectiveName && typeof effectiveName === "string" && effectiveName.trim()) {
      const trimmedName = effectiveName.trim().substring(0, 120);
      const requestedId = path.basename(filename)
        .replace(/\.(md|txt)$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      ensureDir(notesDir);

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
          originSourceFile: filename,
          sourceFile: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      if (!nodeData.originSourceFile) {
        nodeData.originSourceFile = nodeData.sourceFile || filename;
      }

      const aliasSet = new Set((nodeData.aliases || []).map((a) => a.toLowerCase()));
      if (trimmedName.toLowerCase() !== (nodeData.name || "").toLowerCase() && !aliasSet.has(trimmedName.toLowerCase())) {
        nodeData.aliases = [...(nodeData.aliases || []), trimmedName];
      }
      const allSourceFiles = [nodeData.sourceFile, ...(nodeData.additionalSourceFiles || []), filename].filter(Boolean);
      // The just-created file is the active editable file for this node.
      const primarySourceFile = filename;
      nodeData.sourceFile = primarySourceFile;
      const extraSourceFiles = [...new Set(allSourceFiles.filter((f) => f !== primarySourceFile))];
      if (extraSourceFiles.length > 0) nodeData.additionalSourceFiles = extraSourceFiles;
      else delete nodeData.additionalSourceFiles;
      nodeData.updatedAt = Date.now();
      fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeData, null, 2), "utf-8");

      // Seed/refresh connections by syncing each raw file through the same
      // greedy matcher used on normal saves, so longer phrases always win.
      const allRawFiles = scanRawFiles(dir, dir, notesDir);

      for (const relPath of allRawFiles) {
        const mentionerStem = relPath.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
        const mentionerJsonPath = path.join(notesDir, `${mentionerStem}.json`);
        if (!fs.existsSync(mentionerJsonPath)) continue;

        let rawContent;
        try { rawContent = fs.readFileSync(path.join(dir, relPath), "utf-8"); } catch { continue; }
        syncConnectionsForFile(relPath, rawContent, mentionerStem, notesDir);
      }

      syncWorkspaceAfterWrite(req.query.workspace, notesDir);
    }

    // Keep backlinks index in sync for newly created raw files.
    try {
      updateBacklinksIndexForFiles(req.query.workspace, { upsertFiles: [filename] });
    } catch {
      // non-fatal
    }

    return res.status(201).json({ filename });
  }

  // ── PUT: save existing file ─────────────────────────────────────────────────
  if (req.method === "PUT") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const incomingContent = req.body?.content ?? "";
    const existingContent = fs.readFileSync(filePath, "utf-8");
    const content = preserveStyledSpans(existingContent, incomingContent);
    appendWriteTrace(dir, req, "PUT-before-write", {
      incomingFlags: hasFormattingTags(incomingContent),
      incomingSnippet: snippetAroundFormatting(incomingContent),
      existingFlags: hasFormattingTags(existingContent),
      existingSnippet: snippetAroundFormatting(existingContent),
      finalFlags: hasFormattingTags(content),
      finalSnippet: snippetAroundFormatting(content),
      incomingLength: incomingContent.length,
      existingLength: existingContent.length,
      finalLength: content.length,
      destinationPath: path.relative(dir, filePath).replace(/\\/g, "/"),
    });
    fs.writeFileSync(filePath, content, "utf-8");
    const rawStem = path.basename(filename).replace(/\.(md|txt)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const rawNodeJsonPath = path.join(notesDir, `${rawStem}.json`);
    if (fs.existsSync(rawNodeJsonPath)) {
      try {
        syncConnectionsForFile(filename, content, rawStem, notesDir);
        syncWorkspaceAfterWrite(req.query.workspace, notesDir);
      } catch { /* non-fatal */ }
    }
    try {
      updateBacklinksIndexForFiles(req.query.workspace, { upsertFiles: [filename] });
    } catch { /* non-fatal */ }
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
          const patterns = buildNamePropagationPatterns(oldName, data.name, changedPairs);

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
              const segs = (typeof rel === "string" ? rel : "").split(/[/\\]/);
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
    syncWorkspaceAfterWrite(req.query.workspace, dirs.notesDir);
    if (filesUpdated.length > 0) {
      try {
        updateBacklinksIndexForFiles(req.query.workspace, { upsertFiles: filesUpdated });
      } catch { /* non-fatal */ }
    }
    return res.status(200).json({ aliases: data.aliases, tags: data.tags, name: data.name, type: data.type, filesUpdated });
  }

  // ── DELETE: remove file or empty folder ────────────────────────────────────
  if (req.method === "DELETE") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    if (req.query.isFolder === "true") {
      if (req.query.recursive === "true") {
        const removedRawFiles = scanRawFiles(filePath, dir, notesDir);
        // Collect node IDs both by filename-stem and by sourceFile reference
        const stemIds = collectNodeIds(filePath);
        const folderRel = path.relative(dir, filePath).replace(/\\/g, "/");
        const sourceFileIds = findNodesBySourceFilePrefix(notesDir, folderRel + "/");
        const deletedIds = [...new Set([...stemIds, ...sourceFileIds])];
        try { fs.rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
        if (deletedIds.length) {
          purgeNodes(notesDir, deletedIds);
          syncWorkspaceAfterWrite(req.query.workspace, notesDir);
        } else {
          // Still bump so the graph refreshes even if no nodes were tracked
          syncWorkspaceAfterWrite(req.query.workspace, notesDir);
        }
        if (removedRawFiles.length > 0) {
          try {
            updateBacklinksIndexForFiles(req.query.workspace, { removedFiles: removedRawFiles });
          } catch { /* non-fatal */ }
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
    syncWorkspaceAfterWrite(req.query.workspace, notesDir);
    try {
      updateBacklinksIndexForFiles(req.query.workspace, { removedFiles: [filename] });
    } catch { /* non-fatal */ }
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

function buildEdgeBoundedRegex(term) {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(term)}(?![A-Za-z0-9_])`, "g");
}

export function buildNamePropagationPatterns(oldName, newName, changedPairs) {
  return [
    { regex: buildEdgeBoundedRegex(oldName), replacement: newName },
    ...changedPairs.map((p) => ({
      regex: buildEdgeBoundedRegex(p.old),
      replacement: p.new,
    })),
  ];
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

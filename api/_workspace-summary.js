import fs from "fs";
import path from "path";
import { walkRelPaths } from "./_walk.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const SUMMARY_VERSION = 1;
const SUMMARY_FILE = "workspace-summary.json";
const PREVIEW_LIMIT = 300;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug) && slug.length <= 80;
}

function readWorkspaceVersion(workspace) {
  try {
    const versionPath = path.join(WORKSPACES_DIR, workspace, "notes-version.json");
    if (!fs.existsSync(versionPath)) return null;
    const raw = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
    if (raw?.version === undefined || raw?.version === null) return null;
    return String(raw.version);
  } catch {
    return null;
  }
}

function readWorkspaceMeta(workspace) {
  const metaPath = path.join(WORKSPACES_DIR, workspace, "workspace.json");
  let name = workspace.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let hidden = false;
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (typeof meta?.name === "string" && meta.name.trim()) name = meta.name.trim();
      hidden = meta?.hidden === true;
    } catch {
      // keep defaults
    }
  }
  return { slug: workspace, name, hidden };
}

function readGraphCache(wsDir) {
  const cachePath = path.join(wsDir, "graph-cache.json");
  if (!fs.existsSync(cachePath)) return { nodes: [], links: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    return {
      nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
      links: Array.isArray(parsed?.links) ? parsed.links : [],
    };
  } catch {
    return { nodes: [], links: [] };
  }
}

function listWorkspaceRawFiles(wsDir) {
  const notesDir = path.join(wsDir, "notes");
  const relPaths = walkRelPaths(wsDir, wsDir, new Set([path.resolve(notesDir)]))
    .filter((rel) => /\.(md|txt)$/i.test(rel));

  const files = [];
  for (const filename of relPaths) {
    const absPath = path.join(wsDir, ...filename.split("/"));
    try {
      const stat = fs.statSync(absPath);
      files.push({ filename, mtime: Number(stat?.mtimeMs || 0) });
    } catch {
      // skip unreadable file
    }
  }
  return files;
}

function writeSummary(workspace, summary) {
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  fs.writeFileSync(path.join(wsDir, SUMMARY_FILE), JSON.stringify(summary), "utf-8");
}

export function readWorkspaceSummary(workspace) {
  if (!validSlug(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const summaryPath = path.join(wsDir, SUMMARY_FILE);
  if (!fs.existsSync(summaryPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    if (!parsed || parsed.version !== SUMMARY_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function rebuildWorkspaceSummary(workspace) {
  if (!validSlug(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  if (!fs.existsSync(wsDir)) return null;

  const weekAgo = Date.now() - 7 * 86400000;
  const workspaceMeta = readWorkspaceMeta(workspace);
  const graph = readGraphCache(wsDir);
  const files = listWorkspaceRawFiles(wsDir);

  const previewMap = new Map();
  const activityDayMap = {};
  const createdAtMap = {};
  let nodesThisWeek = 0;
  let editsThisWeek = 0;

  for (const node of graph.nodes) {
    const createdAt = Number(node?.createdAt || 0);
    const updatedAt = Number(node?.updatedAt || 0);
    const activityTs = Math.max(createdAt, updatedAt);
    if (activityTs > 0) activityDayMap[startOfDay(activityTs)] = 1;

    if (createdAt > 0) {
      const day = startOfDay(createdAt);
      createdAtMap[day] = (createdAtMap[day] || 0) + 1;
    }

    if (createdAt >= weekAgo) nodesThisWeek += 1;
    else if (updatedAt >= weekAgo) editsThisWeek += 1;

    if (node?.filePreview !== undefined) {
      const val = String(node.filePreview);
      if (node?.sourceFile && !previewMap.has(node.sourceFile)) previewMap.set(node.sourceFile, val);
      for (const sf of (node?.additionalSourceFiles || [])) {
        if (!previewMap.has(sf)) previewMap.set(sf, val);
      }
    }
  }

  const recentDocs = files
    .map((f) => {
      const raw = previewMap.get(f.filename) || "";
      const preview = raw.length > PREVIEW_LIMIT ? `${raw.slice(0, PREVIEW_LIMIT).trimEnd()}...` : raw;
      return {
        filename: f.filename,
        mtime: f.mtime,
        preview,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 24);

  const filesThisWeek = files.filter((f) => Number(f.mtime) >= weekAgo).length;

  const summary = {
    version: SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    workspaceVersion: readWorkspaceVersion(workspace),
    workspace: workspaceMeta,
    stats: {
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
      fileCount: files.length,
      nodesThisWeek,
      editsThisWeek,
      filesThisWeek,
      activityDayMap,
      createdAtMap,
    },
    recentDocs,
  };

  writeSummary(workspace, summary);
  return summary;
}

export function ensureWorkspaceSummary(workspace) {
  const current = readWorkspaceSummary(workspace);
  const workspaceVersion = readWorkspaceVersion(workspace);

  if (!current) return rebuildWorkspaceSummary(workspace);
  if (workspaceVersion !== null && current.workspaceVersion !== workspaceVersion) {
    return rebuildWorkspaceSummary(workspace);
  }
  return current;
}

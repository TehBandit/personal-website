/**
 * POST /api/node-bulk-patch
 * Body: { workspace, nodeIds: string[], tags_add?: string[], tags_remove?: string[] }
 *
 * Applies a tag patch to multiple nodes at once, then rebuilds the graph cache.
 * Only tags_add and tags_remove are supported — this endpoint cannot overwrite
 * arbitrary node fields.
 */
import fs from "fs";
import path from "path";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const sanitizeTag = (t) =>
  typeof t === "string"
    ? t.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").substring(0, 40)
    : null;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, nodeIds, tags_add, tags_remove } = req.body || {};

  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return res.status(400).json({ error: "nodeIds must be a non-empty array" });
  }
  if (nodeIds.some((id) => typeof id !== "string" || !/^[a-z0-9_]+$/.test(id))) {
    return res.status(400).json({ error: "One or more node ids are invalid" });
  }

  const hasTags_add = Array.isArray(tags_add) && tags_add.length > 0;
  const hasTags_remove = Array.isArray(tags_remove) && tags_remove.length > 0;
  if (!hasTags_add && !hasTags_remove) {
    return res.status(400).json({ error: "At least one of tags_add or tags_remove must be provided" });
  }

  const toAdd = hasTags_add ? tags_add.map(sanitizeTag).filter(Boolean) : [];
  const toRemove = hasTags_remove ? new Set(tags_remove.map(sanitizeTag).filter(Boolean)) : new Set();

  const notesDir = path.join(WORKSPACES_DIR, workspace, "notes");
  const updated = [];
  const skipped = [];

  for (const id of nodeIds) {
    const filePath = path.join(notesDir, `${id}.json`);
    // Path traversal guard
    if (!path.resolve(filePath).startsWith(path.resolve(notesDir) + path.sep)) {
      skipped.push(id);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      skipped.push(id);
      continue;
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      skipped.push(id);
      continue;
    }

    const existing = new Set((data.tags || []).map((t) => String(t).toLowerCase()));
    let changed = false;

    for (const tag of toAdd) {
      if (!existing.has(tag)) { existing.add(tag); changed = true; }
    }
    for (const tag of toRemove) {
      if (existing.has(tag)) { existing.delete(tag); changed = true; }
    }

    if (changed) {
      data.tags = [...existing];
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      updated.push(id);
    } else {
      skipped.push(id);
    }
  }

  if (updated.length > 0) {
    try {
      syncWorkspaceAfterWrite(workspace, notesDir);
    } catch (err) {
      // Graph rebuild failure is non-fatal — tags were already written
      console.error("node-bulk-patch: rebuildGraphCache failed", err);
    }
  }

  return res.status(200).json({ updated, skipped });
}

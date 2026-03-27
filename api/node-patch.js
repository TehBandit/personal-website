/**
 * PATCH /api/node-patch
 * Body: { workspace, id, disambiguation }
 * Writes the disambiguation field into the node's JSON file and rebuilds the graph cache.
 * Only the fields explicitly listed in PATCHABLE_FIELDS can be updated through this endpoint.
 */
import fs from "fs";
import path from "path";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

// Allowlist of fields this endpoint may write — prevents arbitrary JSON mutation.
const PATCHABLE_FIELDS = new Set(["disambiguation"]);

export default function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, id, ...fields } = req.body || {};

  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }
  if (!id || typeof id !== "string" || !/^[a-z0-9_]+$/.test(id)) {
    return res.status(400).json({ error: "Invalid node id" });
  }

  const updates = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!PATCHABLE_FIELDS.has(key)) continue;
    if (typeof value !== "string") return res.status(400).json({ error: `Field "${key}" must be a string` });
    updates[key] = value.trim();
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No patchable fields provided" });
  }

  const notesDir = path.join(WORKSPACES_DIR, workspace, "notes");
  const filePath = path.join(notesDir, `${id}.json`);

  // Verify resolved path stays inside notesDir (prevent traversal)
  if (!path.resolve(filePath).startsWith(path.resolve(notesDir) + path.sep)) {
    return res.status(400).json({ error: "Invalid path" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Node not found" });
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return res.status(500).json({ error: "Failed to read node file" });
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === "") {
      delete data[key]; // empty string → remove the field entirely
    } else {
      data[key] = value;
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    return res.status(500).json({ error: "Failed to write node file" });
  }

  rebuildGraphCache(workspace, notesDir);
  bumpWorkspaceVersion(workspace);

  return res.status(200).json({ ok: true, id, ...updates });
}

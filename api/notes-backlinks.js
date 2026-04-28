import fs from "fs";
import path from "path";
import { getBacklinksForNode } from "./_backlinks-index.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, filename } = req.query;

  if (!workspace || !/^[a-z0-9-]+$/.test(workspace))
    return res.status(400).json({ error: "Invalid workspace" });

  // Validate filename — no empty segments, no traversal, must end in .md or .txt
  const segments = filename ? filename.split(/[/\\]/) : [];
  if (!filename || segments.some((s) => s === ".." || s === "." || s === "") || !/\.(md|txt)$/i.test(filename))
    return res.status(400).json({ error: "Invalid filename" });

  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const notesDir = path.join(wsDir, "notes"); // output dir — excluded from scan

  // Verify the resolved file path is within the workspace and not in notes/
  const resolvedFile = path.resolve(path.join(wsDir, ...segments));
  const resolvedWs   = path.resolve(wsDir);
  const resolvedNotes = path.resolve(notesDir);
  if (!resolvedFile.startsWith(resolvedWs + path.sep) && resolvedFile !== resolvedWs)
    return res.status(400).json({ error: "Invalid path" });
  if (resolvedFile.startsWith(resolvedNotes + path.sep) || resolvedFile === resolvedNotes)
    return res.status(400).json({ error: "Invalid path" });

  if (!fs.existsSync(wsDir)) return res.status(200).json({ backlinks: [] });

  // Derive node id from filename (e.g. "notes-raw/orris-vane.md" → "orris_vane")
  const basename = filename.split("/").pop();
  const nodeId = basename.replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
  const nodeJsonPath = path.join(notesDir, nodeId + ".json");

  if (!fs.existsSync(nodeJsonPath)) return res.status(200).json({ backlinks: [] });

  let node;
  try {
    node = JSON.parse(fs.readFileSync(nodeJsonPath, "utf-8"));
  } catch {
    return res.status(200).json({ backlinks: [] });
  }

  // Fast path: use the backlinks index. If the index is missing/stale, the
  // loader lazily rebuilds it before returning.
  const backlinks = getBacklinksForNode(workspace, node.id)
    // Backlinks excludes the node's own/supplemental files based on stem.
    .filter((relPath) => relPath.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_") !== nodeId)
    .map((filename) => ({ filename }));

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ backlinks });
}

/**
 * workspace-image.js
 * GET /api/workspace-image?workspace=<slug>&path=<relpath>
 * Serves image files stored inside a workspace directory.
 * Read-only — no write access.
 */
import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);
const MIME = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".bmp":  "image/bmp",
};

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, path: imgPath } = req.query;
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }
  if (!imgPath || typeof imgPath !== "string") {
    return res.status(400).json({ error: "Missing path" });
  }

  // Validate every path segment — no traversal, no empty segments, no dotfiles
  const segments = imgPath.split(/[/\\]/);
  if (segments.some((s) => !s || s === "." || s === "..")) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const ext = path.extname(segments.at(-1)).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ error: "Unsupported image type" });
  }

  const wsDir = path.resolve(path.join(WORKSPACES_DIR, workspace));
  const filePath = path.resolve(path.join(wsDir, ...segments));

  // Double-check the resolved path stays inside the workspace
  if (!filePath.startsWith(wsDir + path.sep)) {
    return res.status(400).json({ error: "Invalid path" });
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Image not found" });

  const data = fs.readFileSync(filePath);
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  return res.status(200).send(data);
}

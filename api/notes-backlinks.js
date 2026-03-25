import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

function scanTxtFiles(dir, baseDir, excludeDir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (path.resolve(fullPath) === path.resolve(excludeDir)) continue;
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      results.push(...scanTxtFiles(fullPath, baseDir, excludeDir));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
      results.push(relPath);
    }
  }
  return results;
}

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, filename } = req.query;

  if (!workspace || !/^[a-z0-9-]+$/.test(workspace))
    return res.status(400).json({ error: "Invalid workspace" });

  // Validate filename — no empty segments, no traversal, must end in .md or .txt
  const segments = filename ? filename.split(/[\/\\]/) : [];
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

  const node = JSON.parse(fs.readFileSync(nodeJsonPath, "utf-8"));
  const names = [node.name, ...(node.aliases || [])].filter(Boolean);

  // Build word-boundary regex patterns for all names/aliases
  const patterns = names.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i");
  });

  // Scan all raw .txt files in the workspace (excluding notes/ output dir and any file
  // whose stem resolves to the same node ID — covers self and all supplemental copies)
  const allFiles = scanTxtFiles(wsDir, wsDir, notesDir).filter((f) => {
    const fileStem = f.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    return fileStem !== nodeId;
  });

  const backlinks = [];
  for (const relPath of allFiles) {
    let content;
    try { content = fs.readFileSync(path.join(wsDir, relPath), "utf-8"); } catch { continue; }
    if (patterns.some((re) => re.test(content))) {
      backlinks.push({ filename: relPath });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ backlinks });
}

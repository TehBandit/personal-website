import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

function resolveDirs(workspace) {
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  return { dir: wsDir, notesDir: path.join(wsDir, "notes") };
}

function validateRelPath(relPath, resolvedDir, resolvedNotesDir) {
  const segments = relPath.split(/[/\\]/);
  if (segments.some((s) => s === ".." || s === "." || s === "")) return false;
  const resolved = path.resolve(path.join(resolvedDir, ...segments));
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return false;
  if (resolved === resolvedNotesDir || resolved.startsWith(resolvedNotesDir + path.sep)) return false;
  return true;
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const dirs = resolveDirs(req.query.workspace);
  if (!dirs) return res.status(400).json({ error: "Invalid workspace" });
  const { dir, notesDir } = dirs;

  const { from, to } = req.body || {};
  if (!from || !to || typeof from !== "string" || typeof to !== "string") {
    return res.status(400).json({ error: "Missing from/to" });
  }

  if (!/\.(md|txt)$/i.test(from) || !/\.(md|txt)$/i.test(to)) {
    return res.status(400).json({ error: "Only text files (.md, .txt) can be moved" });
  }

  const resolvedDir = path.resolve(dir);
  const resolvedNotesDir = path.resolve(notesDir);

  if (!validateRelPath(from, resolvedDir, resolvedNotesDir) || !validateRelPath(to, resolvedDir, resolvedNotesDir)) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const fromAbs = path.join(dir, ...from.split("/"));
  const toAbs = path.join(dir, ...to.split("/"));

  if (!fs.existsSync(fromAbs)) return res.status(404).json({ error: "Source file not found" });
  if (fs.existsSync(toAbs)) return res.status(409).json({ error: "A file with that name already exists in the destination" });

  const toDir = path.dirname(toAbs);
  if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });

  fs.renameSync(fromAbs, toAbs);
  return res.status(200).json({ from, to });
}

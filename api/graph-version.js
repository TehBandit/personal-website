import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

export default function handler(req, res) {
  const { workspace } = req.query;
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  res.setHeader("Cache-Control", "no-store");

  // Fast path: read the pre-computed version token written on every node save.
  // Reduces polling cost from O(N statSync) to a single readFileSync.
  const versionFile = path.join(WORKSPACES_DIR, workspace, "notes-version.json");
  if (fs.existsSync(versionFile)) {
    try {
      const { version } = JSON.parse(fs.readFileSync(versionFile, "utf-8"));
      return res.status(200).json({ version: String(version) });
    } catch {
      // fall through to legacy scan
    }
  }

  // Legacy fallback: scan notes dir (runs only before the first write with the
  // new code, or if the version file is somehow missing/corrupt).
  const notesDir = path.join(WORKSPACES_DIR, workspace, "notes");
  let latest = 0;
  let count = 0;
  if (fs.existsSync(notesDir)) {
    for (const f of fs.readdirSync(notesDir)) {
      if (!f.endsWith(".json")) continue;
      count++;
      const mtime = fs.statSync(path.join(notesDir, f)).mtimeMs;
      if (mtime > latest) latest = mtime;
    }
  }
  return res.status(200).json({ version: `${count}:${latest}` });
}

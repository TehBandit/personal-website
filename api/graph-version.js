import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

export default async function handler(req, res) {
  const { workspace } = req.query;
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  res.setHeader("Cache-Control", "no-store");

  // Fast path: read the pre-computed version token written on every node save.
  // Reduces polling cost from O(N statSync) to a single async read.
  const versionFile = path.join(WORKSPACES_DIR, workspace, "notes-version.json");
  try {
    const raw = await fs.promises.readFile(versionFile, "utf-8");
    const { version } = JSON.parse(raw);
    return res.status(200).json({ version: String(version) });
  } catch {
    // fall through to legacy scan
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

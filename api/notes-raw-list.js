import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

async function scanDir(dir, baseDir, skipDirs = new Set()) {
  const entries = (await fs.promises.readdir(dir, { withFileTypes: true })).sort((a, b) => {
    // folders first, then alphabetically
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Process all entries at this level concurrently — stat calls run in parallel
  // instead of sequentially, reducing wall time from O(N) to O(depth).
  const results = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (skipDirs.has(fullPath)) return null;
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        const sub = await scanDir(fullPath, baseDir, skipDirs);
        return { kind: "folder", entry, relPath, sub };
      } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
        const stat = await fs.promises.stat(fullPath);
        return { kind: "file", entry, relPath, mtime: stat.mtimeMs };
      }
      return null;
    })
  );

  const tree = [];
  const files = [];

  // results preserves the sorted order from entries
  for (const result of results) {
    if (!result) continue;
    if (result.kind === "folder") {
      tree.push({ type: "folder", name: result.entry.name, path: result.relPath, children: result.sub.tree });
      files.push(...result.sub.files);
    } else {
      tree.push({ type: "file", name: result.entry.name, path: result.relPath, mtime: result.mtime });
      files.push({ filename: result.relPath, mtime: result.mtime });
    }
  }

  return { tree, files };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const workspace = req.query.workspace;
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) return res.status(400).json({ error: "Invalid workspace" });

  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const notesDir = path.join(wsDir, "notes"); // output dir — exclude from listing

  if (!fs.existsSync(wsDir)) return res.status(200).json({ files: [], tree: [] });

  const { tree, files } = await scanDir(wsDir, wsDir, new Set([notesDir]));

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ files, tree });
}

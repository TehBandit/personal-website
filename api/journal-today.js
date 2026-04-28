import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

function extractDateFromJournalFilename(filename) {
  const match = String(filename || "").match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function buildPreview(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "No text";
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const workspace = String(req.query.workspace || "").trim();
  const date = String(req.query.date || "").trim();

  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date" });
  }

  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const journalDir = path.join(wsDir, "journal");

  if (!fs.existsSync(journalDir)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ found: false });
  }

  let dirents;
  try {
    dirents = await fs.promises.readdir(journalDir, { withFileTypes: true });
  } catch {
    return res.status(500).json({ error: "Unable to read journal directory" });
  }

  const candidates = dirents
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => /\.(md|txt)$/i.test(name))
    .filter((name) => extractDateFromJournalFilename(name) === date);

  if (candidates.length === 0) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ found: false });
  }

  const withStats = await Promise.all(candidates.map(async (name) => {
    const absPath = path.join(journalDir, name);
    try {
      const stat = await fs.promises.stat(absPath);
      return { name, absPath, mtime: Number(stat?.mtimeMs || 0) };
    } catch {
      return null;
    }
  }));

  const best = withStats
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime || String(a.name).localeCompare(String(b.name)))[0];

  if (!best) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ found: false });
  }

  try {
    const content = await fs.promises.readFile(best.absPath, "utf-8");
    const filename = `journal/${best.name}`;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      found: true,
      filename,
      date,
      mtime: best.mtime,
      content,
      preview: buildPreview(content),
    });
  } catch {
    return res.status(500).json({ error: "Unable to read journal file" });
  }
}

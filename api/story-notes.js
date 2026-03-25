import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { workspace } = req.query;
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }

    res.setHeader("Cache-Control", "no-store");

    // Fast path: read the pre-built cache written after every extraction/update.
    // Reduces graph load from O(N readFileSync) to a single readFileSync.
    const cacheFile = path.join(WORKSPACES_DIR, workspace, "graph-cache.json");
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
        return res.status(200).json(cached);
      } catch {
        // fall through to N+1 scan
      }
    }

    // Legacy fallback: full N+1 scan. Runs only before the first write with the
    // new code, or if graph-cache.json is missing/corrupt.
    const notesDir = path.join(WORKSPACES_DIR, workspace, "notes");
    if (!fs.existsSync(notesDir)) {
      return res.status(200).json({ nodes: [], links: [] });
    }

    const files = fs
      .readdirSync(notesDir)
      .filter((f) => f.endsWith(".json"));

    const nodes = [];
    const links = [];
    const seenLinks = new Set();

    for (const file of files) {
      let data;
      try {
        const raw = fs.readFileSync(path.join(notesDir, file), "utf-8");
        data = JSON.parse(raw);
      } catch {
        continue;
      }

      const { id, name, type, excerpt, notes, aliases, connections = [] } = data;
      if (!id || !name) continue;

      nodes.push({ id, name, type: type || "character", excerpt: excerpt || "", notes: notes || "", aliases: aliases || [] });

      for (const conn of connections) {
        if (!conn.target) continue;
        const key = [id, conn.target].sort().join("||");
        if (!seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ source: id, target: conn.target, label: conn.label || "" });
        }
      }
    }

    return res.status(200).json({ nodes, links });
  } catch (err) {
    console.error("story-notes error:", err);
    return res.status(500).json({ error: "Failed to read notes folder" });
  }
}

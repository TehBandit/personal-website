import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const notesDir = path.join(process.cwd(), "notes");

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
        // Skip malformed files silently
        continue;
      }

      const { id, name, type, excerpt, notes, connections = [] } = data;

      if (!id || !name) continue;

      nodes.push({ id, name, type: type || "character", excerpt: excerpt || "", notes: notes || "" });

      for (const conn of connections) {
        if (!conn.target) continue;
        // Deduplicate bidirectional edges by sorting the pair
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

import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { workspace, summary } = req.query;
    const summaryMode = summary === "1" || summary === "true";
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }

    res.setHeader("Cache-Control", "no-store");

    // Read the disallowed-aliases blacklist (non-fatal — returns empty set if missing)
    const wsDir = path.join(WORKSPACES_DIR, workspace);
    let disallowedAliases = [];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(wsDir, "disallowed-aliases.json"), "utf-8"));
      if (Array.isArray(raw.aliases)) disallowedAliases = raw.aliases;
    } catch { /* no blacklist yet */ }

    // Fast path: read the pre-built cache written after every extraction/update.
    // Reduces graph load from O(N readFileSync) to a single readFileSync.
    const cacheFile = path.join(wsDir, "graph-cache.json");
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
        const cachedNodes = Array.isArray(cached?.nodes) ? cached.nodes : [];

        // Backward-compatibility: older workspaces may have nodes without
        // createdAt/updatedAt in cache and note JSON. Infer from note file mtime.
        let nodes = cachedNodes;
        const hasMissingTimestamps = cachedNodes.some((n) => !n?.createdAt && !n?.updatedAt);
        if (hasMissingTimestamps) {
          const notesDir = path.join(WORKSPACES_DIR, workspace, "notes");
          const tsById = new Map();
          if (fs.existsSync(notesDir)) {
            const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
            for (const file of files) {
              const abs = path.join(notesDir, file);
              try {
                const raw = JSON.parse(fs.readFileSync(abs, "utf-8"));
                if (!raw?.id) continue;
                const mtime = Number(fs.statSync(abs)?.mtimeMs || 0);
                const createdAt = Number(raw?.createdAt || mtime || 0);
                const updatedAt = Number(raw?.updatedAt || createdAt || mtime || 0);
                tsById.set(raw.id, {
                  ...(createdAt > 0 ? { createdAt } : {}),
                  ...(updatedAt > 0 ? { updatedAt } : {}),
                });
              } catch {
                // skip unreadable node file
              }
            }
          }

          nodes = cachedNodes.map((n) => {
            if (n?.createdAt || n?.updatedAt) return n;
            const inferred = tsById.get(n?.id);
            return inferred ? { ...n, ...inferred } : n;
          });

          // Persist repaired cache to avoid repeated per-request inference.
          try {
            if (nodes !== cachedNodes) {
              fs.writeFileSync(cacheFile, JSON.stringify({ ...cached, nodes }), "utf-8");
            }
          } catch {
            // non-fatal
          }
        }

        if (summaryMode) {
          const summaryNodes = (nodes || []).map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            sourceFile: n.sourceFile,
            additionalSourceFiles: n.additionalSourceFiles || [],
            filePreview: n.filePreview,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          }));
          const links = cached.links || [];
          return res.status(200).json({ nodes: summaryNodes, links, disallowedAliases });
        }
        return res.status(200).json({ ...cached, nodes, disallowedAliases });
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

      const {
        id,
        name,
        type,
        excerpt,
        notes,
        aliases,
        tags,
        disambiguation,
        context_summary,
        sourceFile,
        originSourceFile,
        additionalSourceFiles,
        documentNode,
        filePreview,
        createdAt,
        updatedAt,
        connections = [],
      } = data;
      if (!id || !name) continue;

      nodes.push(
        summaryMode
          ? {
              id,
              name,
              type: type || "character",
              sourceFile: data.sourceFile || "",
              additionalSourceFiles: data.additionalSourceFiles || [],
              filePreview: data.filePreview,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            }
          : {
              id,
              name,
              type: type || "character",
              excerpt: excerpt || "",
              notes: notes || "",
              aliases: aliases || [],
              tags: tags || [],
              ...(originSourceFile ? { originSourceFile } : {}),
              sourceFile: sourceFile || "",
              ...(additionalSourceFiles?.length ? { additionalSourceFiles } : {}),
              ...(disambiguation ? { disambiguation } : {}),
              ...(context_summary ? { context_summary } : {}),
              ...(documentNode ? { documentNode } : {}),
              ...(filePreview !== undefined ? { filePreview } : {}),
              ...(createdAt ? { createdAt } : {}),
              ...(updatedAt ? { updatedAt } : {}),
            }
      );

      for (const conn of connections) {
        if (!conn.target) continue;
        const key = [id, conn.target].sort().join("||");
        if (!seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ source: id, target: conn.target, label: conn.label || "" });
        }
      }
    }

    return res.status(200).json({ nodes, links, disallowedAliases });
  } catch (err) {
    console.error("story-notes error:", err);
    return res.status(500).json({ error: "Failed to read notes folder" });
  }
}

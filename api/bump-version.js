import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

/**
 * Write a lightweight version token to workspaces/{workspace}/notes-version.json.
 * graph-version.js reads this single file instead of stat-ing every note on disk,
 * reducing the 2-second polling cost from O(N) syscalls to a single readFileSync.
 */
export function bumpWorkspaceVersion(workspace) {
  try {
    const dir = path.join(WORKSPACES_DIR, workspace);
    fs.writeFileSync(
      path.join(dir, "notes-version.json"),
      JSON.stringify({ version: Date.now() }),
      "utf-8"
    );
  } catch {
    // non-fatal — polling will fall back to the legacy scan
  }
}

/**
 * Rebuild graph-cache.json from all node JSONs in notesDir.
 * story-notes.js reads this single file instead of doing an N+1 readFileSync
 * loop on every graph load, reducing the cost from O(N) to O(1).
 * Called once at write time (after extraction or alias update) rather than on
 * every read request.
 */
export function rebuildGraphCache(workspace, notesDir) {
  try {
    const wsDir = path.join(WORKSPACES_DIR, workspace);
    const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
    const nodes = [];
    const links = [];
    const seenLinks = new Set();

    // First pass: collect all node data and build the full ID set
    const allData = [];
    const allIds = new Set();
    for (const file of files) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
      } catch {
        continue;
      }
      if (!data.id || !data.name) continue;
      allData.push({ file, data });
      allIds.add(data.id);
    }

    // Second pass: purge orphaned nodes — either:
    //   (a) no sourceFile + no live connections (stranded grey mention node), or
    //   (b) sourceFile points to a file that no longer exists + no live connections
    for (const { file, data } of allData) {
      const hasLiveConnection = (data.connections || []).some((c) => allIds.has(c.target));
      if (hasLiveConnection) continue; // connected nodes always survive

      const sourceFileGone = data.sourceFile && !fs.existsSync(path.join(wsDir, data.sourceFile));
      if (!data.sourceFile || sourceFileGone) {
        try { fs.unlinkSync(path.join(notesDir, file)); } catch { /* ignore */ }
        allIds.delete(data.id);
        data.__purged = true;
      }
    }

    // Third pass: build graph cache from surviving nodes
    for (const { data } of allData) {
      if (data.__purged) continue;
      const { id, name, type, excerpt, notes, aliases, sourceFile, additionalSourceFiles, connections = [] } = data;

      nodes.push({
        id,
        name,
        type: type || "character",
        excerpt: excerpt || "",
        notes: notes || "",
        aliases: aliases || [],
        sourceFile: sourceFile || "",
        ...(additionalSourceFiles?.length ? { additionalSourceFiles } : {}),
      });

      for (const conn of connections) {
        if (!conn.target) continue;
        const key = [id, conn.target].sort().join("||");
        if (!seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ source: id, target: conn.target, label: conn.label || "" });
        }
      }
    }

    fs.writeFileSync(
      path.join(wsDir, "graph-cache.json"),
      JSON.stringify({ nodes, links }),
      "utf-8"
    );
  } catch {
    // non-fatal — story-notes.js falls back to the N+1 scan
  }
}

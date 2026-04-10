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
    if (!notesDir) notesDir = path.join(wsDir, "notes");
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

    // Third pass: alias deduplication with persistent blacklist.
    //
    // disallowed-aliases.json stores every alias that has EVER been flagged as
    // ambiguous for this workspace. Once blacklisted, an alias can never be used
    // by any node — even after the original conflict is resolved — preventing the
    // order-of-operations problem where removing from node A would let node B
    // keep the alias unchallenged.
    const disallowedPath = path.join(wsDir, "disallowed-aliases.json");
    let disallowedAliases; // Set<string> of lowercase blacklisted aliases
    try {
      const raw = JSON.parse(fs.readFileSync(disallowedPath, "utf-8"));
      disallowedAliases = new Set(Array.isArray(raw.aliases) ? raw.aliases.map((a) => a.toLowerCase()) : []);
    } catch {
      disallowedAliases = new Set();
    }

    // Build current alias → node-id map for newly-ambiguous detection
    const aliasCount = new Map(); // lowercase alias → Set of node ids that use it
    const nodeNamesLower = new Set(
      allData.filter(({ data }) => !data.__purged).map(({ data }) => data.name?.toLowerCase())
    );
    for (const { data } of allData) {
      if (data.__purged) continue;
      for (const alias of (data.aliases || [])) {
        const key = alias.toLowerCase();
        if (!aliasCount.has(key)) aliasCount.set(key, new Set());
        aliasCount.get(key).add(data.id);
      }
    }

    // Append newly-ambiguous aliases to the persistent blacklist
    let blacklistChanged = false;
    for (const [alias, ids] of aliasCount.entries()) {
      if (!disallowedAliases.has(alias) && (ids.size > 1 || nodeNamesLower.has(alias))) {
        disallowedAliases.add(alias);
        blacklistChanged = true;
      }
    }
    if (blacklistChanged) {
      try {
        fs.writeFileSync(
          disallowedPath,
          JSON.stringify({ aliases: [...disallowedAliases].sort() }, null, 2),
          "utf-8"
        );
      } catch { /* non-fatal */ }
    }

    // Strip ALL blacklisted aliases from every surviving node and write back
    for (const { file, data } of allData) {
      if (data.__purged) continue;
      const before = (data.aliases || []);
      const after = before.filter((a) => !disallowedAliases.has(a.toLowerCase()));
      if (after.length !== before.length) {
        data.aliases = after;
        try {
          fs.writeFileSync(path.join(notesDir, file), JSON.stringify(data, null, 2), "utf-8");
        } catch { /* skip unwritable files */ }
      }
    }

    // Fourth pass: build graph cache from surviving nodes
    //
    // Pre-build a basename → full-path map from a single recursive scan of the
    // workspace directory (excluding notes/). This replaces the previous approach
    // of running a recursive findRawFile() walk PER NODE — O(N×D) → O(D + N).
    const rawFileMap = new Map(); // lowercase basename → full path
    const walkDir = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && path.resolve(full) !== path.resolve(notesDir)) {
          walkDir(full);
        } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
          const key = entry.name.toLowerCase();
          if (!rawFileMap.has(key)) rawFileMap.set(key, full);
        }
      }
    };
    walkDir(wsDir);

    const FILE_PREVIEW_LIMIT = 600;

    for (const { data } of allData) {
      if (data.__purged) continue;
      const { id, name, type, excerpt, notes, aliases, tags, disambiguation, context_summary, sourceFile, additionalSourceFiles, createdAt, updatedAt, connections = [] } = data;

      // For nodes that own a dedicated raw file, embed a truncated preview of
      // that file's content (heading stripped) so the graph panel can show it
      // without a network round-trip.
      let filePreview = null;
      const stemHyphen = id.replace(/_/g, "-");
      const rawFilePath =
        rawFileMap.get(stemHyphen + ".md") ??
        rawFileMap.get(stemHyphen + ".txt") ??
        rawFileMap.get(id + ".md") ??
        rawFileMap.get(id + ".txt") ??
        null;
      if (rawFilePath) {
        try {
          const rawContent = fs.readFileSync(rawFilePath, "utf-8");
          const body = rawContent.replace(/^[^\n]*\n\n?/, "").trimStart();
          filePreview = body.length > FILE_PREVIEW_LIMIT
            ? body.slice(0, FILE_PREVIEW_LIMIT).trimEnd() + "…"
            : body;
        } catch { /* non-fatal */ }
      }

      nodes.push({
        id,
        name,
        type: type || "character",
        excerpt: excerpt || "",
        notes: notes || "",
        aliases: aliases || [],
        tags: tags || [],
        sourceFile: sourceFile || "",
        ...(additionalSourceFiles?.length ? { additionalSourceFiles } : {}),
        ...(disambiguation ? { disambiguation } : {}),
        ...(context_summary ? { context_summary } : {}),
        ...(filePreview !== null ? { filePreview } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });

      for (const conn of connections) {
        if (!conn.target || !allIds.has(conn.target)) continue; // drop phantom targets
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

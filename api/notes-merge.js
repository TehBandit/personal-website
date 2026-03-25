import fs from "fs";
import path from "path";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { workspace, sourceId, targetId } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace))
    return res.status(400).json({ error: "Invalid workspace" });
  if (!sourceId || !targetId || sourceId === targetId)
    return res.status(400).json({ error: "Invalid node IDs" });
  if (!/^[a-z0-9_]+$/.test(sourceId) || !/^[a-z0-9_]+$/.test(targetId))
    return res.status(400).json({ error: "Invalid node IDs" });

  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const notesDir = path.join(wsDir, "notes");

  const sourcePath = path.join(notesDir, `${sourceId}.json`);
  const targetPath = path.join(notesDir, `${targetId}.json`);

  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: "Source node not found" });
  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: "Target node not found" });

  let source, target;
  try {
    source = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
    target = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  } catch {
    return res.status(500).json({ error: "Failed to read node files" });
  }

  // ── Merge data into target ──────────────────────────────────────────────────

  // Aliases: union of both alias lists + source's primary name (as an alias on target)
  const aliasSet = new Set((target.aliases || []).map((a) => a.toLowerCase()));
  const mergedAliases = [...(target.aliases || [])];

  // Add source name as alias if it differs from target name
  if (source.name && source.name.toLowerCase() !== target.name.toLowerCase() && !aliasSet.has(source.name.toLowerCase())) {
    mergedAliases.push(source.name);
    aliasSet.add(source.name.toLowerCase());
  }
  // Add source aliases
  for (const a of (source.aliases || [])) {
    if (!aliasSet.has(a.toLowerCase()) && a.toLowerCase() !== target.name.toLowerCase()) {
      mergedAliases.push(a);
      aliasSet.add(a.toLowerCase());
    }
  }
  target.aliases = mergedAliases;

  // Excerpt: keep target's unless empty
  if (!target.excerpt && source.excerpt) target.excerpt = source.excerpt;

  // Notes: append source notes if not already contained in target
  if (source.notes && source.notes.trim() && !target.notes.includes(source.notes.trim())) {
    target.notes = target.notes
      ? `${target.notes}\n\n${source.notes.trim()}`
      : source.notes.trim();
  }

  // sourceFile: keep target's; adopt source's if target has none.
  // Track ALL source files so the UI can show merged copies.
  const allSourceFiles = [
    target.sourceFile,
    ...(target.additionalSourceFiles || []),
    source.sourceFile,
    ...(source.additionalSourceFiles || []),
  ].filter(Boolean);
  const primarySourceFile = target.sourceFile || source.sourceFile || "";
  target.sourceFile = primarySourceFile;
  const extraSourceFiles = [...new Set(allSourceFiles.filter((f) => f !== primarySourceFile))];
  if (extraSourceFiles.length > 0) target.additionalSourceFiles = extraSourceFiles;
  else delete target.additionalSourceFiles;

  // Connections: union, skip self-references to either ID, deduplicate
  const existingTargets = new Set((target.connections || []).map((c) => c.target));
  for (const conn of (source.connections || [])) {
    if (conn.target === targetId || conn.target === sourceId) continue;
    if (!existingTargets.has(conn.target)) {
      target.connections.push(conn);
      existingTargets.add(conn.target);
    }
  }

  // Write merged target
  fs.writeFileSync(targetPath, JSON.stringify(target, null, 2), "utf-8");

  // ── Remap all other nodes: sourceId → targetId in connections ───────────────
  let allFiles;
  try { allFiles = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json")); }
  catch { return res.status(500).json({ error: "Failed to read notes directory" }); }

  for (const file of allFiles) {
    if (file === `${sourceId}.json` || file === `${targetId}.json`) continue;
    const filePath = path.join(notesDir, file);
    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { continue; }

    let changed = false;
    const seen = new Set();
    const newConns = [];
    for (const conn of (data.connections || [])) {
      const remapped = conn.target === sourceId ? targetId : conn.target;
      if (seen.has(remapped)) { changed = true; continue; } // dedup
      seen.add(remapped);
      if (remapped !== conn.target) changed = true;
      newConns.push({ ...conn, target: remapped });
    }
    if (changed) {
      data.connections = newConns;
      try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch { /* non-fatal */ }
    }
  }

  // ── Delete source node ──────────────────────────────────────────────────────
  try { fs.unlinkSync(sourcePath); } catch { /* already gone */ }

  // ── Rebuild + bump ──────────────────────────────────────────────────────────
  rebuildGraphCache(workspace, notesDir);
  bumpWorkspaceVersion(workspace);

  return res.status(200).json({ ok: true, targetId, mergedFrom: sourceId });
}

import fs from "fs";
import path from "path";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { updateBacklinksIndexForFiles } from "./_backlinks-index.js";
import { resolveWorkspaceDirs } from "./_storygraph-paths.js";
import { ensureDir } from "./_storygraph-io.js";

function resolveDirs(workspace) {
  const dirs = resolveWorkspaceDirs(workspace);
  if (!dirs) return null;
  return { dir: dirs.wsDir, notesDir: dirs.notesDir };
}

function validateRelPath(relPath, resolvedDir, resolvedNotesDir) {
  const segments = relPath.split(/[/\\]/);
  if (segments.some((s) => s === ".." || s === "." || s === "")) return false;
  const resolved = path.resolve(path.join(resolvedDir, ...segments));
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return false;
  if (resolved === resolvedNotesDir || resolved.startsWith(resolvedNotesDir + path.sep)) return false;
  return true;
}

function normalizeSourceFile(sf) {
  if (!sf) return sf;
  return sf.replace(/\\.txt$/i, ".md");
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const dirs = resolveDirs(req.query.workspace);
  if (!dirs) return res.status(400).json({ error: "Invalid workspace" });
  const { dir, notesDir } = dirs;

  const { from, to } = req.body || {};
  if (!from || !to || typeof from !== "string" || typeof to !== "string") {
    return res.status(400).json({ error: "Missing from/to" });
  }

  if (!/\.(md|txt)$/i.test(from) || !/\.(md|txt)$/i.test(to)) {
    return res.status(400).json({ error: "Only text files (.md, .txt) can be moved" });
  }

  const resolvedDir = path.resolve(dir);
  const resolvedNotesDir = path.resolve(notesDir);

  if (!validateRelPath(from, resolvedDir, resolvedNotesDir) || !validateRelPath(to, resolvedDir, resolvedNotesDir)) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const fromAbs = path.join(dir, ...from.split("/"));
  const toAbs = path.join(dir, ...to.split("/"));

  if (!fs.existsSync(fromAbs)) return res.status(404).json({ error: "Source file not found" });
  if (fs.existsSync(toAbs)) return res.status(409).json({ error: "A file with that name already exists in the destination" });

  const toDir = path.dirname(toAbs);
  ensureDir(toDir);

  fs.renameSync(fromAbs, toAbs);

  // Keep node metadata in sync with the live file location.
  // originSourceFile is immutable provenance and is intentionally not changed.
  const fromNorm = normalizeSourceFile(from);
  const toNorm = normalizeSourceFile(to);
  if (fs.existsSync(notesDir)) {
    const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const jsonPath = path.join(notesDir, file);
      let data;
      try { data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); } catch { continue; }

      let changed = false;
      if (normalizeSourceFile(data.sourceFile) === fromNorm) {
        data.sourceFile = toNorm;
        changed = true;
      }

      if (Array.isArray(data.additionalSourceFiles)) {
        const remapped = data.additionalSourceFiles
          .map((sf) => normalizeSourceFile(sf) === fromNorm ? toNorm : sf)
          .filter(Boolean);
        const deduped = [...new Set(remapped.filter((sf) => sf !== data.sourceFile))];
        if (deduped.length !== data.additionalSourceFiles.length || deduped.some((sf, i) => sf !== data.additionalSourceFiles[i])) {
          data.additionalSourceFiles = deduped;
          changed = true;
        }
        if (data.additionalSourceFiles.length === 0) delete data.additionalSourceFiles;
      }

      if (changed) {
        data.updatedAt = Date.now();
        try { fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8"); } catch { /* ignore */ }
      }
    }
    syncWorkspaceAfterWrite(req.query.workspace, notesDir);
  }

  try {
    updateBacklinksIndexForFiles(req.query.workspace, { removedFiles: [from], upsertFiles: [to] });
  } catch {
    // non-fatal
  }

  return res.status(200).json({ from, to });
}

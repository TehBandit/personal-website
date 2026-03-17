/**
 * seed-graph.js
 * -------------
 * Processes txt files in notes-raw/ through OpenAI and writes/patches
 * the resulting JSON files in notes/.
 *
 * By default runs INCREMENTALLY — existing nodes are preserved and only
 * new nodes or new connections are written.
 *
 * Pass --force to clear notes/ and fully regenerate from scratch.
 * Pass --update to re-process specified files and refresh matching node content.
 * Pass specific filenames to only process those files (no path needed):
 *
 * Run with:
 *   node --env-file=.env.local scripts/seed-graph.js
 *   node --env-file=.env.local scripts/seed-graph.js --force
 *   node --env-file=.env.local scripts/seed-graph.js iron-compact.txt kasra-deln.txt
 *   node --env-file=.env.local scripts/seed-graph.js --update kasra-deln.txt
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deduplicateNodes, remapConnections } from "../api/dedup-nodes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NOTES_RAW_DIR = path.join(ROOT, "notes-raw");
const NOTES_DIR = path.join(ROOT, "notes");

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(msg + "\n");
}

function loadExistingNodes() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((file) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, file), "utf-8"));
        return data.id && data.name ? [{ id: data.id, name: data.name, type: data.type || "character" }] : [];
      } catch {
        return [];
      }
    });
}

function loadNodeFile(id) {
  const file = path.join(NOTES_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function patchNodeConnections(nodeId, newConns) {
  const data = loadNodeFile(nodeId);
  if (!data) return 0;
  data.connections = data.connections || [];
  const existingTargets = new Set(data.connections.map((c) => c.target));
  let added = 0;
  for (const conn of newConns) {
    if (!conn.target || conn.target === nodeId) continue;
    if (existingTargets.has(conn.target)) continue;
    data.connections.push(conn);
    existingTargets.add(conn.target);
    added++;
  }
  if (added > 0) {
    fs.writeFileSync(path.join(NOTES_DIR, `${nodeId}.json`), JSON.stringify(data, null, 2), "utf-8");
  }
  return added;
}

/**
 * Remove all connections tagged with `sourceFile === filename` from every
 * node file. Called before re-extraction so stale edges are cleared even when
 * they live on a node whose primary sourceFile is different.
 */
function stripConnectionsFromSource(filename) {
  if (!fs.existsSync(NOTES_DIR)) return;
  for (const f of fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json"))) {
    const nodeId = path.basename(f, ".json");
    const data = loadNodeFile(nodeId);
    if (!data) continue;
    const before = (data.connections || []).length;
    data.connections = (data.connections || []).filter((c) => c.sourceFile !== filename);
    if (data.connections.length !== before) {
      fs.writeFileSync(path.join(NOTES_DIR, f), JSON.stringify(data, null, 2), "utf-8");
    }
  }
}

/**
 * Return the set of node IDs that "belong" to a given source file.
 * Ownership is determined by:
 *   1. The node's `sourceFile` field matches the filename exactly
 *   2. (migration) The node's ID matches the snake_case stem of the filename
 *      e.g. kasra-deln.txt → kasra_deln
 */
function getRefreshIdsForFile(filename) {
  const ids = new Set();
  if (!fs.existsSync(NOTES_DIR)) return ids;
  const stem = path.basename(filename, ".txt").replace(/-/g, "_").toLowerCase();
  for (const f of fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json"))) {
    const data = loadNodeFile(path.basename(f, ".json"));
    if (!data) continue;
    if (data.sourceFile === filename) ids.add(data.id);
    // migration fallback: stem match when sourceFile isn't stamped yet
    else if (!data.sourceFile && data.id === stem) ids.add(data.id);
  }
  return ids;
}

async function extractFromText(openai, rawText, filename, refreshNodeIds = new Set()) {
  // Exclude nodes being refreshed so OpenAI regenerates them with fresh content
  const existingNodes = loadExistingNodes().filter((n) => !refreshNodeIds.has(n.id));

  const systemPrompt = `You are a narrative analyst. Your job is to extract named story elements from raw notes and automatically map every connection between them.

You will receive:
1. A list of elements ALREADY IN THE GRAPH (with their ids, names, types)
2. Raw notes to analyze

Your tasks:
- Identify all significant named entities: characters, locations, factions, artifacts, events
- For each NEW entity, write a focused excerpt and condensed notes
- Determine all meaningful connections — both between new entities AND to existing graph entities
- If two entities should be connected, list the connection from ONE of them (avoid duplicates)

Return ONLY valid JSON matching this exact schema:
{
  "nodes": [
    {
      "id": "snake_case_unique_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One punchy sentence describing this element",
      "notes": "Full narrative notes about this element",
      "connections": [
        { "target": "id_of_related_entity", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ]
}

Rules:
- IDs must be lowercase snake_case, unique, and filename-safe
- Do NOT recreate existing entities — reference them only as connection targets
- CRITICAL: A first name alone (e.g. "Elara") and a full name (e.g. "Elara Voss") referring to the same person ARE the same entity — use the existing node's ID
- CRITICAL: Nicknames, titles, and shortened names that clearly refer to an existing entity must NOT become new nodes
- Extract every implied relationship from the text (don't miss any)
- Connection labels are lowercase and descriptive: "childhood best friends", "hidden within", "hunts relentlessly"
- If a new entity connects to an existing one, use the existing entity's exact ID as the target
- Return at least one node even if the notes are sparse
- CRITICAL: The notes come from a file named after their primary subject. Any sentence with an implicit subject (e.g. "is best friends with X", "was born in Y", "carries the Z") should be treated as a statement about the primary subject of this file — use their name as the subject when inferring connections`;

  // Derive a human-readable subject name from the filename (e.g. "maren-ashveil.txt" → "Maren Ashveil")
  const filenameSubject = filename
    .replace(/\.txt$/i, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const userPrompt = `EXISTING GRAPH NODES — do not recreate these, only reference their IDs in connections:
${
  existingNodes.length > 0
    ? existingNodes.map((n) => `  id: "${n.id}"  name: "${n.name}"  type: ${n.type}`).join("\n")
    : "  (none yet — this is the first file)"
}

RAW NOTES TO ANALYZE (from: ${filename}, primary subject: "${filenameSubject}"):
${rawText}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });

  return JSON.parse(completion.choices[0].message.content);
}

function saveNodes(extracted, sourceFile = null, refreshNodeIds = new Set()) {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });

  const existingNodes = loadExistingNodes();
  const existingIdSet = new Set(existingNodes.map((n) => n.id));
  const rawNodes = extracted.nodes || [];
  const existingConns = extracted.existing_connections || [];

  const { deduped, remapIds } = deduplicateNodes(rawNodes, existingNodes);
  const finalNodes = remapConnections(deduped, remapIds);

  const merged = rawNodes.length - deduped.length;
  if (merged > 0) log(`  ~ ${merged} duplicate(s) merged into existing nodes`);

  // Save genuinely new nodes (stamp sourceFile)
  const saved = [];
  for (const node of finalNodes) {
    if (!node.id || !node.name) continue;
    const safeId = node.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    const filePath = path.join(NOTES_DIR, `${safeId}.json`);
    const connections = (node.connections || []).map((c) =>
      sourceFile ? { ...c, sourceFile } : c
    );
    const nodeData = {
      id: safeId,
      name: node.name,
      type: node.type || "character",
      excerpt: node.excerpt || "",
      connections,
      notes: node.notes || "",
      ...(sourceFile ? { sourceFile } : {}),
    };
    fs.writeFileSync(filePath, JSON.stringify(nodeData, null, 2), "utf-8");
    saved.push(nodeData);
  }

  // In update mode: refresh content of existing nodes that belong to this file
  if (refreshNodeIds.size > 0) {
    for (const rawNode of rawNodes) {
      const canonicalId = remapIds.get(rawNode.id);
      if (!canonicalId || !refreshNodeIds.has(canonicalId)) continue;
      const existing = loadNodeFile(canonicalId);
      if (!existing) continue;

      // Remap connection targets; tag with sourceFile; drop self-links
      const freshConns = (rawNode.connections || [])
        .map((c) => ({
          target: remapIds.get(c.target) ?? c.target,
          label: c.label,
          ...(sourceFile ? { sourceFile } : {}),
        }))
        .filter((c) => c.target !== canonicalId);

      // Keep connections that came from OTHER source files, replace this file's
      const otherConns = (existing.connections || []).filter(
        (c) => c.sourceFile && c.sourceFile !== sourceFile
      );

      const nodeData = {
        ...existing,
        name: rawNode.name || existing.name,
        type: rawNode.type || existing.type,
        excerpt: rawNode.excerpt || existing.excerpt,
        notes: rawNode.notes || existing.notes,
        connections: [...otherConns, ...freshConns],
        ...(sourceFile ? { sourceFile } : {}),
      };
      fs.writeFileSync(
        path.join(NOTES_DIR, `${canonicalId}.json`),
        JSON.stringify(nodeData, null, 2),
        "utf-8"
      );
      saved.push(nodeData);
      log(`  ↻ ${nodeData.name} (${nodeData.type}) — updated`);
    }
  }

  // Patch orphaned connections from deduped-but-not-refreshed nodes into existing files
  let patched = 0;
  for (const node of rawNodes) {
    const canonicalId = remapIds.get(node.id);
    if (!canonicalId) continue;
    if (refreshNodeIds.has(canonicalId)) continue; // handled above
    const conns = (node.connections || []).map((c) => ({
      ...c,
      target: remapIds.get(c.target) ?? c.target,
      ...(sourceFile ? { sourceFile } : {}),
    }));
    patched += patchNodeConnections(canonicalId, conns);
  }

  // Patch explicit existing-to-existing connections
  for (const conn of existingConns) {
    const sourceId = remapIds.get(conn.source) ?? conn.source;
    const targetId = remapIds.get(conn.target) ?? conn.target;
    if (!existingIdSet.has(sourceId)) continue;
    patched += patchNodeConnections(sourceId, [{
      target: targetId,
      label: conn.label || "",
      ...(sourceFile ? { sourceFile } : {}),
    }]);
  }

  if (patched > 0) log(`  ~ ${patched} new connection(s) patched into existing nodes`);

  return saved;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log("ERROR: OPENAI_API_KEY not set. Run with: node --env-file=.env.local scripts/seed-graph.js");
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const isUpdate = process.argv.includes("--update");

  // Optional explicit file list (any args that don't start with --)
  const fileArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  // 1. Optionally clear notes/
  if (force) {
    if (fs.existsSync(NOTES_DIR)) {
      const existing = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json"));
      for (const f of existing) fs.unlinkSync(path.join(NOTES_DIR, f));
      log(`--force: cleared ${existing.length} existing JSON file(s) from notes/\n`);
    }
  } else {
    const count = fs.existsSync(NOTES_DIR)
      ? fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json")).length
      : 0;
    const modeLabel = isUpdate ? "Update mode" : "Incremental mode";
    log(`${modeLabel} (${count} existing node(s) — pass --force to regenerate from scratch)\n`);
  }

  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });

  // 2. Collect txt files — use argv list if provided, otherwise all txt files
  if (!fs.existsSync(NOTES_RAW_DIR)) {
    log("ERROR: notes-raw/ directory not found.");
    process.exit(1);
  }

  let txtFiles;
  if (fileArgs.length > 0) {
    // Validate each explicitly requested file exists
    txtFiles = fileArgs.map((f) => path.basename(f)); // strip any path prefix
    const missing = txtFiles.filter((f) => !fs.existsSync(path.join(NOTES_RAW_DIR, f)));
    if (missing.length > 0) {
      log(`ERROR: file(s) not found in notes-raw/: ${missing.join(", ")}`);
      process.exit(1);
    }
  } else {
    txtFiles = fs.readdirSync(NOTES_RAW_DIR).filter((f) => f.endsWith(".txt"));
  }

  if (txtFiles.length === 0) {
    log("No .txt files found in notes-raw/");
    process.exit(0);
  }
  log(`Processing ${txtFiles.length} file(s): ${txtFiles.join(", ")}\n`);

  const openai = new OpenAI({ apiKey });

  // 3. Process each file sequentially — context builds with each pass
  for (let i = 0; i < txtFiles.length; i++) {
    const filename = txtFiles[i];
    log(`[${i + 1}/${txtFiles.length}] Processing: ${filename}`);

    const rawText = fs.readFileSync(path.join(NOTES_RAW_DIR, filename), "utf-8").trim();
    const refreshNodeIds = isUpdate ? getRefreshIdsForFile(filename) : new Set();
    if (isUpdate && refreshNodeIds.size > 0) {
      log(`  Refreshing ${refreshNodeIds.size} existing node(s): ${[...refreshNodeIds].join(", ")}`);
    }
    // Strip stale connections from ALL nodes before re-extracting, so removed
    // relationships don't persist even when they live on a node whose primary
    // sourceFile differs from the file being processed.
    if (isUpdate) stripConnectionsFromSource(filename);
    const extracted = await extractFromText(openai, rawText, filename, refreshNodeIds);
    const saved = saveNodes(extracted, filename, refreshNodeIds);

    if (saved.length === 0) {
      log(`  → No nodes extracted (skipping)\n`);
    } else {
      for (const n of saved) {
        const connCount = n.connections.length;
        log(`  + ${n.name} (${n.type}) — ${connCount} connection${connCount !== 1 ? "s" : ""}`);
      }
      log("");
    }

    // Brief pause between files to stay within API rate limits
    if (i < txtFiles.length - 1) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // 4. Summary
  const finalNodes = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json"));
  log(`\nDone. ${finalNodes.length} node file(s) written to notes/`);
  log("Refresh /storygraph to see the updated graph.");
}

main().catch((err) => {
  log("\nFATAL: " + err.message);
  process.exit(1);
});

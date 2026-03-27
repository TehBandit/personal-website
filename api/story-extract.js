import OpenAI from "openai";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { deduplicateNodes, remapConnections } from "./dedup-nodes.js";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";

// ── File helpers ──────────────────────────────────────────────────────────────

function loadNodeFile(notesDir, id) {
  const file = path.join(notesDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

/**
 * Patch new connections into an existing node's JSON, skipping any that already
 * target the same node (regardless of label) to avoid redundant edges.
 * Returns the number of connections actually added.
 */
function patchNodeConnections(notesDir, nodeId, newConns) {
  const data = loadNodeFile(notesDir, nodeId);
  if (!data) return 0;

  data.connections = data.connections || [];
  const existingTargets = new Set(data.connections.map((c) => c.target));

  let added = 0;
  for (const conn of newConns) {
    if (!conn.target || conn.target === nodeId) continue; // skip self-links
    if (existingTargets.has(conn.target)) continue;       // skip duplicate edges
    data.connections.push(conn);
    existingTargets.add(conn.target);
    added++;
  }

  if (added > 0) {
    fs.writeFileSync(
      path.join(notesDir, `${nodeId}.json`),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }
  return added;
}

/**
 * Append new notes and/or replace excerpt on an existing node.
 * Preserves all other fields (connections, aliases, etc.).
 * Returns true if the file was actually modified.
 */
function patchNodeContent(notesDir, nodeId, notesAppend, newExcerpt) {
  const data = loadNodeFile(notesDir, nodeId);
  if (!data) return false;

  let changed = false;

  if (notesAppend && notesAppend.trim()) {
    const trimmed = notesAppend.trim();
    // Avoid appending duplicate content (simple substring check)
    if (!data.notes.includes(trimmed)) {
      data.notes = data.notes ? `${data.notes}\n\n${trimmed}` : trimmed;
      changed = true;
    }
  }

  if (newExcerpt && newExcerpt.trim() && newExcerpt.trim() !== data.excerpt) {
    data.excerpt = newExcerpt.trim();
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(
      path.join(notesDir, `${nodeId}.json`),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }
  return changed;
}

/**
 * Generate context summaries for multiple nodes in a single gpt-4o-mini call.
 * Returns a plain object { id: summaryString }. Non-fatal: returns {} on any error.
 * One round-trip instead of N, regardless of how many nodes need summarizing.
 */
async function batchGenerateContextSummaries(openai, items) {
  const toSummarize = items.filter(
    ({ excerpt, notes }) => (excerpt || "").trim() || (notes || "").trim()
  );
  if (toSummarize.length === 0) return {};
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You will receive a JSON array of story entities, each with an id, excerpt, and notes. " +
            "Return a JSON object where each key is the entity id and the value is a concise bullet-point " +
            "list of facts. Each bullet should be one short clause. Include only concrete narrative facts — " +
            "no filler, no repetition. Format each value as plain text with - bullets.",
        },
        {
          role: "user",
          content: JSON.stringify(
            toSummarize.map(({ id, excerpt, notes }) => ({ id, excerpt, notes }))
          ),
        },
      ],
      temperature: 0.1,
      max_tokens: Math.min(300 * toSummarize.length, 4000),
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {}; // non-fatal — extraction still succeeds without summaries
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server misconfiguration" });

    const { text, base64, type } = req.body;

    // --- Extract raw text from the file payload ---
    let rawText = text || "";
    if (type === "docx" && base64) {
      const buffer = Buffer.from(base64, "base64");
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    }

    rawText = rawText.trim();
    if (!rawText) {
      return res.status(400).json({ error: "No text content found in the file." });
    }
    if (rawText.length > 100_000) {
      return res.status(400).json({ error: "File too large — please split into sections under 100 KB." });
    }

    // --- Load existing nodes as context so the AI doesn't duplicate them ---
    const workspace = req.body.workspace;
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }
    const notesDir = path.join(process.cwd(), "workspaces", workspace, "notes");
    const existingNodes = [];

    if (fs.existsSync(notesDir)) {
      const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
          if (data.id && data.name) {
            existingNodes.push({
              id: data.id,
              name: data.name,
              type: data.type || "character",
              excerpt: data.excerpt || "",
              notes: data.notes || "",
              aliases: data.aliases || [],
              context_summary: data.context_summary || "",
              disambiguation: data.disambiguation || "",
            });
          }
        } catch {
          // skip malformed files
        }
      }
    }
    const existingIdSet = new Set(existingNodes.map((n) => n.id));

    // --- Prompt OpenAI with JSON mode ---
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are a narrative analyst. Your job is to extract named story elements from raw notes and automatically map every connection between them.

You will receive:
1. A list of elements ALREADY IN THE GRAPH (with their ids, names, types, and existing notes)
2. Raw notes to analyze

Your tasks:
- Identify all significant named entities: characters, locations, factions, artifacts, events
- For each NEW entity not already in the graph, write a focused excerpt and condensed notes
- For each EXISTING entity where this text reveals meaningfully new information, add an update with only the additional details (do not repeat what is already in their notes)
- Determine all meaningful connections — between new entities AND to existing graph entities
- Capture connections between EXISTING entities that are newly revealed in this text

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
  ],
  "updates": [
    {
      "id": "id_of_existing_entity",
      "notes_append": "New information to append to their existing notes (omit if nothing new)",
      "excerpt": "Revised excerpt if this text provides a sharper one-sentence description (omit if existing is fine)"
    }
  ],
  "existing_connections": [
    { "source": "existing_id", "target": "existing_or_new_id", "label": "brief lowercase relationship" }
  ]
}

Rules:
- IDs must be lowercase snake_case, unique, and filename-safe
- Do NOT recreate existing entities — reference them only as connection targets or in "updates"
- CRITICAL: A first name alone (e.g. "Elara") and a full name (e.g. "Elara Voss") referring to the same person ARE the same entity — use the existing node's ID
- CRITICAL: Nicknames, titles, and shortened names that clearly refer to an existing entity must NOT become new nodes
- Extract every implied relationship from the text (don't miss any)
- Connection labels are lowercase and descriptive: "childhood best friends", "hidden within", "hunts relentlessly"
- If a new entity connects to an existing one, use the existing entity's exact ID as the target
- Use "existing_connections" for any newly revealed connection where BOTH the source and target are already in the graph
- In "updates", only include genuinely NEW information not already captured in the existing notes — do not repeat or rephrase what is already there
- Omit "updates" entries that have no new information to add
- Return at least one node, one update, or one existing_connection even if the notes are sparse`;

    // Pre-scan the uploaded text to find which existing nodes are mentioned.
    // Those nodes get their full notes passed as context; others get id/name/type only.
    // This keeps the prompt lean while giving the AI complete context where it matters.
    const rawTextLower = rawText.toLowerCase();
    const mentionedNodeIds = new Set(
      existingNodes
        .filter((n) => {
          const namesToCheck = [n.name, ...(n.aliases || [])];
          return namesToCheck.some((name) =>
            rawTextLower.includes(name.toLowerCase())
          );
        })
        .map((n) => n.id)
    );

    const userPrompt = `EXISTING GRAPH NODES — do not recreate these; use their exact id in connection targets or updates:
${
  existingNodes.length > 0
    ? existingNodes.map((n) => {
        // Always show excerpt so the AI can distinguish similarly-named entities.
        // For nodes mentioned in the text, also include context summary / full notes.
        const parts = [`  id: "${n.id}"  name: "${n.name}"  type: ${n.type}`];
        if (n.excerpt)        parts.push(`    excerpt: ${n.excerpt}`);
        if (n.aliases?.length) parts.push(`    aliases: ${n.aliases.join(", ")}`);
        if (n.disambiguation) parts.push(`    disambiguation: ${n.disambiguation}`);
        if (mentionedNodeIds.has(n.id)) {
          // Use stored summary if available (~80 tokens); fall back to full notes
          if (n.context_summary) parts.push(`    context: ${n.context_summary}`);
          else if (n.notes)      parts.push(`    notes: ${n.notes}`);
        }
        return parts.join("\n");
      }).join("\n")
    : "  (none yet — this is the first upload)"
}${req.body.title ? `\n\nDOCUMENT TITLE (primary subject of this file): ${req.body.title}` : ""}

RAW NOTES TO ANALYZE:
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

    let extracted;
    try {
      extracted = JSON.parse(completion.choices[0].message.content);
    } catch {
      return res.status(500).json({ error: "AI returned malformed JSON — please try again." });
    }

    const newNodes = extracted.nodes || [];
    const existingConns = extracted.existing_connections || [];
    const updates = extracted.updates || [];

    // --- Deduplicate extracted nodes against existing graph ---
    const { deduped, remapIds } = deduplicateNodes(newNodes, existingNodes);
    const finalNodes = remapConnections(deduped, remapIds);

    // --- Collect orphaned connections from deduped (merged) nodes ---
    // When a node is a duplicate of an existing one, its connections would
    // otherwise be lost. Remap and patch them into the existing node's file.
    const orphanedBySource = new Map(); // existingId → [conn, ...]
    for (const node of newNodes) {
      const canonicalId = remapIds.get(node.id);
      if (!canonicalId) continue; // not a duplicate — handled as a new node
      const conns = (node.connections || []).map((c) => ({
        ...c,
        target: remapIds.get(c.target) ?? c.target,
      }));
      if (conns.length > 0) {
        if (!orphanedBySource.has(canonicalId)) orphanedBySource.set(canonicalId, []);
        orphanedBySource.get(canonicalId).push(...conns);
      }
    }

    // --- Compute the uploads path early so nodes get the correct sourceFile ---
    // safeFilename matches what will actually be written to disk below.
    const _uploadFilename = req.body.filename || `upload-${Date.now()}.md`;
    const _rawBasename = path.basename(_uploadFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeUploadFilename = _rawBasename.replace(/\.(txt|docx)$/i, ".md");

    // If the caller supplied a folderName, save into that folder; otherwise default to uploads/
    const _folderName = (req.body.folderName || "").trim();
    const _safeFolder = _folderName
      ? _folderName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 60)
      : "uploads";
    const uploadSourceFile = `${_safeFolder}/${safeUploadFilename}`;

    // --- Save each genuinely new node ---
    if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

    const savedNodes = [];
    const nodesForSummary = []; // collect for concurrent context_summary generation
    for (const node of finalNodes) {
      if (!node.id || !node.name) continue;
      const safeId = node.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      const filePath = path.join(notesDir, `${safeId}.json`);
      const nodeData = {
        id: safeId,
        name: node.name,
        type: node.type || "character",
        excerpt: node.excerpt || "",
        connections: node.connections || [],
        notes: node.notes || "",
        aliases: node.aliases || [],
        sourceFile: uploadSourceFile,
      };
      fs.writeFileSync(filePath, JSON.stringify(nodeData, null, 2), "utf-8");
      savedNodes.push({ id: safeId, name: node.name, type: node.type || "character" });
      nodesForSummary.push({ filePath, nodeData });
    }

    // --- Apply incremental updates to existing nodes ---
    let updatedNodeCount = 0;
    const updatedNodeIds = []; // collect for concurrent context_summary regeneration
    for (const update of updates) {
      if (!update.id) continue;
      const canonicalId = remapIds.get(update.id) ?? update.id;
      if (!existingIdSet.has(canonicalId)) continue; // only patch nodes that actually exist
      const patched = patchNodeContent(
        notesDir,
        canonicalId,
        update.notes_append || "",
        update.excerpt || ""
      );
      if (patched) {
        updatedNodeCount++;
        updatedNodeIds.push(canonicalId);
      }
    }

    // --- Patch orphaned connections into existing node files ---
    let patchedConnectionCount = 0;
    for (const [sourceId, conns] of orphanedBySource) {
      patchedConnectionCount += patchNodeConnections(notesDir, sourceId, conns);
    }

    // --- Patch explicit existing_connections from the AI output ---
    for (const conn of existingConns) {
      const sourceId = remapIds.get(conn.source) ?? conn.source;
      const targetId = remapIds.get(conn.target) ?? conn.target;
      if (!existingIdSet.has(sourceId)) continue; // source must be an existing node
      patchedConnectionCount += patchNodeConnections(notesDir, sourceId, [
        { target: targetId, label: conn.label || "" },
      ]);
    }

    // --- Generate/regenerate context_summary in a single batched gpt-4o-mini call ---
    // One round-trip instead of N parallel requests — cheaper and faster at scale.
    const summaryItems = [
      ...nodesForSummary.map(({ nodeData }) => ({
        id: nodeData.id,
        excerpt: nodeData.excerpt,
        notes: nodeData.notes,
      })),
      ...updatedNodeIds
        .map((nodeId) => {
          const nd = loadNodeFile(notesDir, nodeId);
          return nd ? { id: nodeId, excerpt: nd.excerpt || "", notes: nd.notes || "" } : null;
        })
        .filter(Boolean),
    ];

    const summaries = await batchGenerateContextSummaries(openai, summaryItems);

    // Write summaries back to new node files
    for (const { filePath, nodeData } of nodesForSummary) {
      const summary = summaries[nodeData.id];
      if (summary) {
        const stored = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        stored.context_summary = summary;
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf-8");
      }
    }
    // Write summaries back to updated existing node files
    for (const nodeId of updatedNodeIds) {
      const summary = summaries[nodeId];
      if (!summary) continue;
      const nodeData = loadNodeFile(notesDir, nodeId);
      if (!nodeData) continue;
      nodeData.context_summary = summary;
      fs.writeFileSync(
        path.join(notesDir, `${nodeId}.json`),
        JSON.stringify(nodeData, null, 2),
        "utf-8"
      );
    }

    // Rebuild the graph cache from all node JSONs so story-notes.js can serve
    // the next graph load with a single file read instead of N+1 readFileSync calls.
    rebuildGraphCache(workspace, notesDir);

    // Bump the lightweight version token so the 2-second poller detects this change
    // with a single file read instead of stat-ing every node JSON.
    bumpWorkspaceVersion(workspace);

    // --- Save source file to workspace folder for record-keeping ---
    const uploadsDir = path.join(process.cwd(), "workspaces", workspace, _safeFolder);
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, safeUploadFilename), rawText, "utf-8");

    return res.status(200).json({
      added: savedNodes.length,
      updated: updatedNodeCount,
      nodes: savedNodes,
      connectionsPatched: patchedConnectionCount,
    });
  } catch (err) {
    console.error("story-extract error:", err);
    return res.status(500).json({ error: err.message || "Extraction failed" });
  }
}

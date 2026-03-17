import OpenAI from "openai";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { deduplicateNodes, remapConnections } from "./dedup-nodes.js";

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

    // --- Load existing nodes as context so the AI doesn't duplicate them ---
    const notesDir = path.join(process.cwd(), "notes");
    const existingNodes = [];

    if (fs.existsSync(notesDir)) {
      const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
          if (data.id && data.name) {
            existingNodes.push({ id: data.id, name: data.name, type: data.type || "character" });
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
1. A list of elements ALREADY IN THE GRAPH (with their ids, names, types)
2. Raw notes to analyze

Your tasks:
- Identify all significant named entities: characters, locations, factions, artifacts, events
- For each NEW entity, write a focused excerpt and condensed notes
- Determine all meaningful connections — both between new entities AND to existing graph entities
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
  "existing_connections": [
    { "source": "existing_id", "target": "existing_or_new_id", "label": "brief lowercase relationship" }
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
- Use "existing_connections" for any newly revealed connection where BOTH the source and target are already in the graph
- Return at least one node or one existing_connection even if the notes are sparse`;

    const userPrompt = `EXISTING GRAPH NODES — do not recreate these, only reference their IDs in connections:
${
  existingNodes.length > 0
    ? existingNodes.map((n) => `  id: "${n.id}"  name: "${n.name}"  type: ${n.type}`).join("\n")
    : "  (none yet — this is the first upload)"
}

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

    // --- Save each genuinely new node ---
    if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

    const savedNodes = [];
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
      };
      fs.writeFileSync(filePath, JSON.stringify(nodeData, null, 2), "utf-8");
      savedNodes.push({ id: safeId, name: node.name, type: node.type || "character" });
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

    return res.status(200).json({
      added: savedNodes.length,
      nodes: savedNodes,
      connectionsPatched: patchedConnectionCount,
    });
  } catch (err) {
    console.error("story-extract error:", err);
    return res.status(500).json({ error: err.message || "Extraction failed" });
  }
}

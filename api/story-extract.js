import OpenAI from "openai";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { htmlToMarkdown, MAMMOTH_OPTIONS, prepareDocxBuffer } from "./_docx-md.js";
import { deduplicateNodes, remapConnections } from "./dedup-nodes.js";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { extractTitleFromContent, normalizeWrappedProse } from "./_walk.js";
import { ensureDir } from "./_storygraph-io.js";

function hasFormattingTags(value) {
  if (typeof value !== "string" || !value) return { hasSpan: false, hasFont: false, hasMark: false };
  return {
    hasSpan: /<span\b[^>]*>/i.test(value),
    hasFont: /<font\b[^>]*color\s*=\s*['"][^'"]+['"][^>]*>/i.test(value),
    hasMark: /<mark\b[^>]*data-color\s*=\s*['"][^'"]+['"][^>]*>/i.test(value),
  };
}

function snippetAroundFormatting(value) {
  if (typeof value !== "string" || !value) return "";
  const re = /<mark\b[^>]*data-color\s*=\s*['"][^'"]+['"][^>]*>|<font\b[^>]*color\s*=\s*['"][^'"]+['"][^>]*>|<span\b[^>]*style\s*=\s*['"][^'"]*(?:color|background(?:-color)?)\s*:[^'"]*['"][^>]*>/i;
  const m = value.match(re);
  if (!m || typeof m.index !== "number") {
    return value.slice(0, 420);
  }
  const idx = m.index;
  const start = Math.max(0, idx - 220);
  const end = Math.min(value.length, idx + 220);
  return value.slice(start, end);
}

function appendWriteTrace(wsDir, req, phase, payload) {
  try {
    const traceFlag = req.query?.trace === "1" || req.body?.trace === 1 || req.body?.trace === "1";
    const sentinelPath = path.join(wsDir, "_notes_trace_on");
    const traceEnabled = traceFlag || fs.existsSync(sentinelPath);
    if (!traceEnabled) return;

    const hasAnyFmt = (f) => Boolean(f?.hasSpan || f?.hasFont || f?.hasMark);
    const isSuspicious = (() => {
      if (payload?.error) return true;
      if (phase === "STORY-EXTRACT-write" || phase === "STORY-EXTRACT-focused-write") {
        // If docx conversion produced non-empty markdown but no inline formatting tags,
        // keep a trace row for investigation.
        if (payload?.sourceType === "docx" && typeof payload?.incomingLength === "number" && payload.incomingLength > 0 && !hasAnyFmt(payload?.incomingFlags)) {
          return true;
        }
        return false;
      }
      return false;
    })();
    if (!isSuspicious) return;

    const tracePath = path.join(wsDir, "_notes_write_trace.log");
    const row = {
      ts: new Date().toISOString(),
      method: req.method,
      phase,
      workspace: req.body?.workspace || "",
      ua: req.headers["user-agent"] || "",
      referer: req.headers.referer || req.headers.referrer || "",
      ...payload,
    };
    fs.appendFileSync(tracePath, `${JSON.stringify(row)}\n`, "utf-8");
  } catch {
    // Non-fatal tracing.
  }
}

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
    data.updatedAt = Date.now();
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
    data.updatedAt = Date.now();
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
    let markdownContent = null; // formatted markdown, only set for docx
    if (type === "docx" && base64) {
      const buffer = Buffer.from(base64, "base64");
      const preparedBuffer = await prepareDocxBuffer(buffer);
      const [rawResult, htmlResult] = await Promise.all([
        mammoth.extractRawText({ buffer: preparedBuffer }),
        mammoth.convertToHtml({ buffer: preparedBuffer }, MAMMOTH_OPTIONS),
      ]);
      rawText = rawResult.value;
      markdownContent = normalizeWrappedProse(htmlToMarkdown(htmlResult.value));
    }

    rawText = normalizeWrappedProse(rawText.trim());
    if (!rawText) {
      return res.status(400).json({ error: "No text content found in the file." });
    }
    if (rawText.length > 100_000) {
      return res.status(400).json({ error: "File too large — please split into sections under 100 KB." });
    }

    // If the file content has a detectable title line, prefer it over the
    // filename-derived title the client sent.
    const contentTitle = extractTitleFromContent(rawText);
    if (contentTitle && req.body.title) {
      req.body.title = contentTitle;
    }

    // --- Load existing nodes as context so the AI doesn't duplicate them ---
    const workspace = req.body.workspace;
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }
    const wsDir = path.join(process.cwd(), "workspaces", workspace);
    const notesDir = path.join(wsDir, "notes");

    // --- Load workspace nodeTypes so extraction uses the correct type vocabulary ---
    let workspaceNodeTypes = null;
    try {
      const wsMetaPath = path.join(process.cwd(), "workspaces", workspace, "workspace.json");
      const wsMeta = JSON.parse(fs.readFileSync(wsMetaPath, "utf-8"));
      if (wsMeta.nodeTypes && typeof wsMeta.nodeTypes === "object" && Object.keys(wsMeta.nodeTypes).length > 0) {
        workspaceNodeTypes = wsMeta.nodeTypes;
      }
    } catch { /* use narrative defaults */ }
    const typeKeys = workspaceNodeTypes
      ? Object.keys(workspaceNodeTypes)
      : ["character", "location", "faction", "artifact", "event"];
    const typeList = typeKeys.join(" | ");
    const defaultType = typeKeys[0];
    const typeLabels = workspaceNodeTypes
      ? Object.values(workspaceNodeTypes).map((t) => t.label || t).join(", ")
      : "characters, locations, factions, artifacts, events";

    // Load existing nodes from graph-cache.json (single read) with N+1 fallback
    let existingNodes = [];
    const cachePath = path.join(wsDir, "graph-cache.json");
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        existingNodes = (cache.nodes || []).filter((n) => n.id && n.name).map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type || defaultType,
          excerpt: n.excerpt || "",
          notes: n.notes || "",
          aliases: n.aliases || [],
          context_summary: n.context_summary || "",
          disambiguation: n.disambiguation || "",
        }));
      } catch { /* fall through to N+1 scan */ }
    }
    if (existingNodes.length === 0 && fs.existsSync(notesDir)) {
      for (const file of fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
          if (data.id && data.name) {
            existingNodes.push({
              id: data.id, name: data.name, type: data.type || defaultType,
              excerpt: data.excerpt || "", notes: data.notes || "",
              aliases: data.aliases || [], context_summary: data.context_summary || "",
              disambiguation: data.disambiguation || "",
            });
          }
        } catch { /* skip malformed */ }
      }
    }
    const existingIdSet = new Set(existingNodes.map((n) => n.id));

    // --- Compute upload filename and folder path early so both the focused node
    //     and the later per-entity nodes share the same sourceFile value. ---
    const _uploadFilename = req.body.filename || `upload-${Date.now()}.md`;
    const _rawBasename = path.basename(_uploadFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeUploadFilename = _rawBasename.replace(/\.(txt|docx)$/i, ".md");
    const _folderName = (req.body.folderName || "").trim();
    const _safeFolder = _folderName
      ? _folderName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 60)
      : "";
    const uploadSourceFile = _safeFolder ? `${_safeFolder}/${safeUploadFilename}` : safeUploadFilename;

    // --- Prompt OpenAI with JSON mode ---
    const openai = new OpenAI({ apiKey });

    // ── Focused-note mode ─────────────────────────────────────────────────────
    // When the caller provides a `title`, pre-create a node for the document
    // itself (name = title, notes = raw text), then fall through to the normal
    // multi-entity extraction so characters/places/etc are still extracted and
    // linked to it.  The title node is added to existingNodes so the extraction
    // AI sees it as "already in the graph" and connects extracted entities to it.
    // focusedId/focusedTitle/focusedType are hoisted so the userPrompt and final
    // response can reference them after the if block.
    let focusedId = null;
    let focusedTitle = null;
    let focusedType = null;
    if (req.body.title && req.body.title.trim()) {
      focusedTitle = req.body.title.trim();
      focusedId = focusedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

      // Use the already-computed uploadSourceFile so folder uploads place the
      // focused node under the correct subfolder, not at workspace root.
      const focusedSourceFile = uploadSourceFile;

      // Ask gpt-4o-mini for a one-sentence excerpt, a type, and any connections
      // to nodes already in the graph.  Characters found in this pass are NOT
      // extracted yet — they come from the full extraction below.
      const focusedSystem = `You are a knowledge-graph assistant processing a single focused note.
The note is about the entity named "${focusedTitle}".
Return ONLY valid JSON with this exact schema:
{
  "excerpt": "One punchy sentence describing ${focusedTitle}",
  "type": "${typeList}",
  "connections": [
    { "target": "id_of_existing_entity", "label": "brief lowercase relationship (max 8 words)" }
  ]
}
Rules:
- "connections" may only reference entities already in the graph (ids listed in the user message)
- Omit "connections" or leave it [] if no existing entity is clearly mentioned
- "type" must be exactly one of: ${typeList}`;

      const focusedUser = `EXISTING GRAPH NODES:
${existingNodes.length > 0
  ? existingNodes.map((n) => `  id: "${n.id}"  name: "${n.name}"  type: ${n.type}`).join("\n")
  : "  (none yet)"}

NOTE CONTENT:
${rawText}`;

      let focusedResult = {};
      try {
        const focusedCompletion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: focusedSystem },
            { role: "user", content: focusedUser },
          ],
          temperature: 0.2,
        });
        focusedResult = JSON.parse(focusedCompletion.choices[0].message.content);
      } catch { /* non-fatal — proceed without excerpt */ }

      focusedType = typeKeys.includes(focusedResult.type) ? focusedResult.type : defaultType;
      const focusedConns = Array.isArray(focusedResult.connections)
        ? focusedResult.connections.filter((c) => c.target && existingIdSet.has(c.target))
        : [];

      ensureDir(notesDir);
      const existingFocused = loadNodeFile(notesDir, focusedId);

      if (existingFocused) {
        patchNodeContent(notesDir, focusedId, rawText, focusedResult.excerpt || "");
        if (focusedConns.length > 0) patchNodeConnections(notesDir, focusedId, focusedConns);
        // Always stamp documentNode + update sourceFile so this node is recognised
        // as the file owner even when it previously existed as a grey extracted node
        // (e.g. extracted from an earlier upload) with no documentNode flag.
        const reloaded = loadNodeFile(notesDir, focusedId);
        if (reloaded && (!reloaded.documentNode || reloaded.sourceFile !== focusedSourceFile)) {
          reloaded.documentNode = true;
          reloaded.sourceFile = focusedSourceFile;
          if (!reloaded.originSourceFile) reloaded.originSourceFile = focusedSourceFile;
          reloaded.updatedAt = Date.now();
          fs.writeFileSync(path.join(notesDir, `${focusedId}.json`), JSON.stringify(reloaded, null, 2), "utf-8");
        } else if (reloaded && !reloaded.originSourceFile) {
          reloaded.originSourceFile = reloaded.sourceFile || focusedSourceFile;
          reloaded.updatedAt = Date.now();
          fs.writeFileSync(path.join(notesDir, `${focusedId}.json`), JSON.stringify(reloaded, null, 2), "utf-8");
        }
      } else {
        const focusedNode = {
          id: focusedId,
          name: focusedTitle,
          type: focusedType,
          excerpt: focusedResult.excerpt || "",
          notes: rawText,
          connections: focusedConns,
          aliases: [],
          originSourceFile: focusedSourceFile,
          sourceFile: focusedSourceFile,
          documentNode: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fs.writeFileSync(path.join(notesDir, `${focusedId}.json`), JSON.stringify(focusedNode, null, 2), "utf-8");
      }

      // Add the title node to existingNodes so the full extraction below sees it
      // as already in the graph — extracted entities will connect to it naturally.
      if (!existingIdSet.has(focusedId)) {
        existingNodes.push({
          id: focusedId,
          name: focusedTitle,
          type: focusedType,
          excerpt: focusedResult.excerpt || "",
          notes: rawText,
          aliases: [],
          context_summary: "",
          disambiguation: "",
        });
        existingIdSet.add(focusedId);
      }

      // Save the raw file NOW so rebuildGraphCache (called at the end of the
      // main extraction) finds the sourceFile on disk and does not purge this node.
      const _focusedWriteDir = _safeFolder ? path.join(wsDir, _safeFolder) : wsDir;
      ensureDir(_focusedWriteDir);
      const focusedWritePath = path.join(_focusedWriteDir, safeUploadFilename);
      const focusedWriteContent = markdownContent ?? rawText;
      fs.writeFileSync(focusedWritePath, focusedWriteContent, "utf-8");
      appendWriteTrace(wsDir, req, "STORY-EXTRACT-focused-write", {
        filename: uploadSourceFile,
        sourceType: type || "text",
        incomingFlags: hasFormattingTags(focusedWriteContent),
        incomingSnippet: snippetAroundFormatting(focusedWriteContent),
        incomingLength: focusedWriteContent.length,
        destinationPath: path.relative(wsDir, focusedWritePath).replace(/\\/g, "/"),
      });

      // Fall through to the full multi-entity extraction ↓
    }
    // ── End focused-note mode ─────────────────────────────────────────────────

    const systemPrompt = `You are a narrative analyst. Your job is to extract named story elements from raw notes and automatically map every connection between them.

You will receive:
1. A list of elements ALREADY IN THE GRAPH (with their ids, names, types, and existing notes)
2. Raw notes to analyze

Your tasks:
- Identify all significant named entities: ${typeLabels}
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
      "type": "${typeList}",
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
    }${focusedId ? `\n\nDOCUMENT NODE — this text belongs to the node with id="${focusedId}" name="${focusedTitle}". Every extracted entity found in this text MUST include a connection to "${focusedId}" in its connections array with an appropriate label (e.g. "appears in", "featured in", "central to").` : ""}

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

    // uploadSourceFile / _safeFolder / safeUploadFilename were computed above (before the focused-note block).

    // --- Save each genuinely new node ---
    ensureDir(notesDir);

    const savedNodes = [];
    const nodesForSummary = []; // collect for concurrent context_summary generation
    for (const node of finalNodes) {
      if (!node.id || !node.name) continue;
      const safeId = node.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      const filePath = path.join(notesDir, `${safeId}.json`);
      const nodeData = {
        id: safeId,
        name: node.name,
        type: node.type || defaultType,
        excerpt: node.excerpt || "",
        connections: node.connections || [],
        notes: node.notes || "",
        aliases: node.aliases || [],
        originSourceFile: uploadSourceFile,
        sourceFile: uploadSourceFile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(nodeData, null, 2), "utf-8");
      savedNodes.push({ id: safeId, name: node.name, type: node.type || defaultType });
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
        const existingNode = loadNodeFile(notesDir, canonicalId);
        if (existingNode && !existingNode.originSourceFile) {
          existingNode.originSourceFile = existingNode.sourceFile || uploadSourceFile;
          existingNode.updatedAt = Date.now();
          fs.writeFileSync(
            path.join(notesDir, `${canonicalId}.json`),
            JSON.stringify(existingNode, null, 2),
            "utf-8"
          );
        }
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
    syncWorkspaceAfterWrite(workspace, notesDir);

    // --- Save source file to workspace folder for record-keeping ---
    const uploadsDir = _safeFolder
      ? path.join(wsDir, _safeFolder)
      : wsDir;
    ensureDir(uploadsDir);
    const uploadWritePath = path.join(uploadsDir, safeUploadFilename);
    const uploadWriteContent = markdownContent ?? rawText;
    fs.writeFileSync(uploadWritePath, uploadWriteContent, "utf-8");
    appendWriteTrace(wsDir, req, "STORY-EXTRACT-write", {
      filename: uploadSourceFile,
      sourceType: type || "text",
      incomingFlags: hasFormattingTags(uploadWriteContent),
      incomingSnippet: snippetAroundFormatting(uploadWriteContent),
      incomingLength: uploadWriteContent.length,
      destinationPath: path.relative(wsDir, uploadWritePath).replace(/\\/g, "/"),
    });

    // Prepend the focused/title node to the response so the upload-complete
    // screen shows it alongside the extracted entities.
    if (focusedId && focusedTitle && focusedType) {
      savedNodes.unshift({ id: focusedId, name: focusedTitle, type: focusedType });
    }

    return res.status(200).json({
      added: savedNodes.length,
      updated: updatedNodeCount,
      nodes: savedNodes,
      connectionsPatched: patchedConnectionCount,
    });
  } catch (err) {
    try {
      const workspace = req.body?.workspace;
      if (workspace && /^[a-z0-9-]+$/.test(workspace)) {
        const wsDir = path.join(process.cwd(), "workspaces", workspace);
        appendWriteTrace(wsDir, req, "STORY-EXTRACT-error", {
          sourceType: req.body?.type || "text",
          error: err?.message || "Extraction failed",
        });
      }
    } catch {
      // non-fatal debug tracing
    }
    console.error("story-extract error:", err);
    return res.status(500).json({ error: err.message || "Extraction failed" });
  }
}

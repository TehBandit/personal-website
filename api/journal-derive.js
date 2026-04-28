import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { deduplicateNodes, remapConnections } from "./dedup-nodes.js";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";
import { ensureDir } from "./_storygraph-io.js";

// ── Node-file helpers (mirrors story-extract.js) ──────────────────────────────

function loadNodeFile(notesDir, id) {
  const file = path.join(notesDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function patchNodeConnections(notesDir, nodeId, newConns) {
  const data = loadNodeFile(notesDir, nodeId);
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
    data.updatedAt = Date.now();
    fs.writeFileSync(path.join(notesDir, `${nodeId}.json`), JSON.stringify(data, null, 2), "utf-8");
  }
  return added;
}

function patchNodeContent(notesDir, nodeId, notesAppend, newExcerpt) {
  const data = loadNodeFile(notesDir, nodeId);
  if (!data) return false;
  let changed = false;
  if (notesAppend && notesAppend.trim() && !data.notes.includes(notesAppend.trim())) {
    data.notes = data.notes ? `${data.notes}\n\n${notesAppend.trim()}` : notesAppend.trim();
    changed = true;
  }
  if (newExcerpt && newExcerpt.trim() && newExcerpt.trim() !== data.excerpt) {
    data.excerpt = newExcerpt.trim();
    changed = true;
  }
  if (changed) {
    data.updatedAt = Date.now();
    fs.writeFileSync(path.join(notesDir, `${nodeId}.json`), JSON.stringify(data, null, 2), "utf-8");
  }
  return changed;
}

async function batchGenerateContextSummaries(openai, items) {
  const toSummarize = items.filter(({ excerpt, notes }) => (excerpt || "").trim() || (notes || "").trim());
  if (toSummarize.length === 0) return {};
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You will receive a JSON array of journal-extracted entities, each with an id, excerpt, and notes. " +
            "Return a JSON object where each key is the entity id and the value is a concise bullet-point " +
            "list of facts drawn from the journal context. Format each value as plain text with - bullets.",
        },
        { role: "user", content: JSON.stringify(toSummarize.map(({ id, excerpt, notes }) => ({ id, excerpt, notes }))) },
      ],
      temperature: 0.1,
      max_tokens: Math.min(300 * toSummarize.length, 4000),
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ── Derive-meta helpers (hash-based dedup) ────────────────────────────────────

const DERIVE_KEY = "journal-entries";
const JOURNAL_WORKSPACE_SLUG = "journal-hidden-workspace";

function isJournalDeriveAuthorized(req) {
  const configuredSecret = process.env.JOURNAL_DERIVE_SECRET;
  const requestSecret = req.headers["x-journal-derive-secret"];

  if (process.env.NODE_ENV === "production" && !configuredSecret) {
    return { ok: false, status: 503, error: "journal derive is not configured for production" };
  }

  if (configuredSecret && requestSecret !== configuredSecret) {
    return { ok: false, status: 401, error: "unauthorized journal derive request" };
  }

  return { ok: true };
}

function collectForceDeleteNodeIds(notesDir, entryRelPaths, priorNodeIds = []) {
  const ids = new Set((priorNodeIds || []).filter((id) => typeof id === "string" && id.trim()));
  if (!fs.existsSync(notesDir)) return ids;

  // Fallback when derive-meta is missing/incomplete: remove only nodes tied to journal files.
  if (ids.size > 0) return ids;
  for (const file of fs.readdirSync(notesDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
      const sourceFile = String(data?.sourceFile || "");
      const originSourceFile = String(data?.originSourceFile || "");
      const isJournalLinked = sourceFile.startsWith("journal/") || originSourceFile.startsWith("journal/") || entryRelPaths.has(sourceFile);
      if (isJournalLinked && data?.id) ids.add(String(data.id));
    } catch {
      // Ignore malformed files in cleanup fallback.
    }
  }
  return ids;
}

function normalizeConnectionList(connections, sourceId, knownNodeIds) {
  if (!Array.isArray(connections)) return [];
  const cleaned = [];
  const seenTargets = new Set();
  for (const conn of connections) {
    const target = String(conn?.target || "").trim();
    if (!target) continue;
    if (target === sourceId) continue;
    if (!knownNodeIds.has(target)) continue;
    if (seenTargets.has(target)) continue;
    seenTargets.add(target);
    cleaned.push({ target, label: String(conn?.label || "") || "references" });
  }
  return cleaned;
}

function loadDeriveIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return { items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return Array.isArray(parsed.items) ? parsed : { items: [] };
  } catch { return { items: [] }; }
}

function saveDeriveIndex(indexPath, index) {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

function getDefaultNodeType(workspace) {
  try {
    const wsJson = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, workspace, "workspace.json"), "utf-8"));
    const keys = Object.keys(wsJson.nodeTypes || {});
    if (keys.length > 0) return keys[0];
  } catch { /* fallback */ }
  return "event";
}

function extractDateFromJournalFilename(filename) {
  const m = String(filename || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function buildDefaultJournalTitle(dateKey) {
  if (!dateKey) return "Journal Entry";
  const [y, m, d] = dateKey.split("-").map((v) => Number.parseInt(v, 10));
  const dt = new Date(y, m - 1, d);
  const pretty = dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `Journal Entry - ${pretty}`;
}

function extractJournalTitle(fallbackDateKey) {
  return buildDefaultJournalTitle(fallbackDateKey);
}

function journalFilenameToNodeId(filename) {
  return String(filename || "")
    .replace(/\.(md|txt)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Find which journal entry first mentions a name ────────────────────────────
// sortedEntries: [{ relPath, content }] oldest → newest
function findFirstMentionEntry(name, aliases, sortedEntries) {
  const terms = [name, ...(aliases || [])].map((t) => t.toLowerCase());
  for (const entry of sortedEntries) {
    const hay = (entry.content || "").toLowerCase();
    if (terms.some((t) => hay.includes(t))) return entry.relPath;
  }
  // fallback: most recent entry
  return sortedEntries.at(-1)?.relPath ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = isJournalDeriveAuthorized(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server misconfiguration" });

    const { workspace, force } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }
    if (workspace !== JOURNAL_WORKSPACE_SLUG) {
      return res.status(400).json({ error: "journal derive only supports the hidden journal workspace" });
    }

    // ── Read journal entry files from disk ────────────────────────────────────
    const wsDir = path.join(WORKSPACES_DIR, workspace);
    const journalDir = path.join(wsDir, "journal");
    if (!fs.existsSync(journalDir)) {
      return res.status(400).json({ error: "No journal folder found in this workspace." });
    }

    // Load all journal .md files, sorted oldest → newest by filename.
    // Supports both `YYYY-MM-DD.md` and `journal-entry-YYYY-MM-DD.md`.
    const journalFiles = fs.readdirSync(journalDir)
      .filter((f) => f.endsWith(".md") && /(?:^|-)\d{4}-\d{2}-\d{2}/.test(f))
      .sort();

    if (journalFiles.length === 0) {
      return res.status(400).json({ error: "No journal entries found." });
    }

    // Build sorted entries with relative path and content
    const sortedEntries = journalFiles.map((filename) => {
      const absPath = path.join(journalDir, filename);
      let content = "";
      try { content = fs.readFileSync(absPath, "utf-8"); } catch { /* skip unreadable */ }
      const dateKey = extractDateFromJournalFilename(filename);
      const title = extractJournalTitle(dateKey);
      const nodeId = journalFilenameToNodeId(filename);
      return { filename, relPath: `journal/${filename}`, content, dateKey, title, nodeId };
    });

    // Combined text for hash + AI prompt
    const combinedText = sortedEntries
      .map((e) => e.content.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (!combinedText.trim()) {
      return res.status(400).json({ error: "Journal entries are empty." });
    }

    // ── Hash-based dedup ──────────────────────────────────────────────────────
    const contentHash = crypto.createHash("sha256").update(combinedText).digest("hex");
    const notesDir = path.join(wsDir, "notes");
    const deriveIndexPath = path.join(wsDir, "derive-meta.json");
    const deriveIndex = loadDeriveIndex(deriveIndexPath);

    const preservedDocumentTitles = new Map();
    const entryRelPaths = new Set(sortedEntries.map((entry) => entry.relPath));
    if (force) {
      const previousDerive = deriveIndex.items.find((i) => i.inputPath === DERIVE_KEY);
      deriveIndex.items = deriveIndex.items.filter((i) => i.inputPath !== DERIVE_KEY);

      for (const entry of sortedEntries) {
        const existing = loadNodeFile(notesDir, entry.nodeId);
        if (existing?.documentNode && typeof existing?.name === "string" && existing.name.trim()) {
          preservedDocumentTitles.set(entry.nodeId, existing.name.trim());
        }
      }

      // Force-refresh should clear only prior journal-derived/journal-linked nodes.
      if (fs.existsSync(notesDir)) {
        const deleteIds = collectForceDeleteNodeIds(notesDir, entryRelPaths, previousDerive?.nodeIds || []);
        for (const id of deleteIds) {
          try { fs.unlinkSync(path.join(notesDir, `${id}.json`)); } catch { /* non-fatal */ }
        }
      }
    }
    const cached = deriveIndex.items.find((i) => i.inputPath === DERIVE_KEY);
    if (cached && cached.sourceHash === contentHash) {
      return res.status(200).json({ alreadyDerived: true, derivedAt: cached.derivedAt, nodes: cached.nodeIds || [] });
    }

    // Materialize one document node per journal file so each entry has a stable
    // node identity (filename-stem id) and editable title source-of-truth in JSON.
    ensureDir(notesDir);
    const defaultNodeType = getDefaultNodeType(workspace);
    const documentNodeIdBySourceFile = new Map();
    const documentNodeIds = [];
    for (const entry of sortedEntries) {
      const existing = loadNodeFile(notesDir, entry.nodeId);
      const nodeData = {
        ...(existing || {}),
        id: entry.nodeId,
        name: existing?.name || preservedDocumentTitles.get(entry.nodeId) || entry.title,
        type: existing?.type || defaultNodeType,
        excerpt: existing?.excerpt || "",
        notes: existing?.notes || "",
        aliases: Array.isArray(existing?.aliases) ? existing.aliases : [],
        tags: Array.isArray(existing?.tags) ? existing.tags : [],
        connections: Array.isArray(existing?.connections) ? existing.connections : [],
        originSourceFile: existing?.originSourceFile || entry.relPath,
        sourceFile: entry.relPath,
        additionalSourceFiles: (existing?.additionalSourceFiles || []).filter((f) => f && f !== entry.relPath),
        documentNode: true,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (!nodeData.additionalSourceFiles || nodeData.additionalSourceFiles.length === 0) {
        delete nodeData.additionalSourceFiles;
      }
      fs.writeFileSync(path.join(notesDir, `${entry.nodeId}.json`), JSON.stringify(nodeData, null, 2), "utf-8");
      documentNodeIdBySourceFile.set(entry.relPath, entry.nodeId);
      documentNodeIds.push(entry.nodeId);
    }

    // ── Load existing graph nodes ─────────────────────────────────────────────
    let existingNodes = [];
    const cachePath = path.join(wsDir, "graph-cache.json");
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        existingNodes = (cache.nodes || []).filter((n) => n.id && n.name).map((n) => ({
          id: n.id, name: n.name, type: n.type || "person",
          aliases: n.aliases || [], excerpt: n.excerpt || "",
          notes: n.notes || "", context_summary: n.context_summary || "",
          disambiguation: n.disambiguation || "",
        }));
      } catch { /* fall through */ }
    }
    if (existingNodes.length === 0 && fs.existsSync(notesDir)) {
      for (const f of fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, f), "utf-8"));
          if (data.id && data.name) existingNodes.push({
            id: data.id, name: data.name, type: data.type || "person",
            aliases: data.aliases || [], excerpt: data.excerpt || "",
            notes: data.notes || "", context_summary: data.context_summary || "",
            disambiguation: data.disambiguation || "",
          });
        } catch { /* skip */ }
      }
    }
    const existingIdSet = new Set(existingNodes.map((n) => n.id));

    // ── Journal-specific prompt ───────────────────────────────────────────────
    const systemPrompt = `You are a thoughtful journal analyst building a personal knowledge graph from real diary entries.

Your job: extract every person, place, activity, habit, theme, emotion, and recurring topic — even mundane or brief ones. These are real daily journal entries, not fiction. Capture the full texture of the writer's life.

WHAT TO CAPTURE (be generous — err toward inclusion):
- People: anyone named or clearly described (friends, family, coworkers, partners, public figures)
- Places: anywhere visited, lived, worked, or longed for (cafés, cities, specific rooms, parks, online spaces)
- Activities & routines: running, cooking, reading a particular book, a game, a show, a workout, a commute
- Recurring themes & feelings: anxiety, excitement, loneliness, a creative project, a goal, a difficult period, gratitude
- Events: a trip, a job change, a birthday, a difficult conversation, a celebration, a milestone
- Objects of significance: a gift, a song, a book that mattered, a place of comfort

WHAT NOT TO CAPTURE:
- Generic pronouns with no clear referent
- Truly unnamed, zero-context throwaway references ("some person", "a thing")
- Duplicates — merge under the most specific name

Return ONLY valid JSON matching this exact schema:
{
  "nodes": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "person | place | activity | theme | event | object",
      "excerpt": "One-sentence description grounded in the journal text",
      "notes": "2–3 paragraphs — what the journal reveals about this, with entry context where helpful",
      "aliases": ["shorthand names used in entries"],
      "connections": [
        { "target": "id_of_related_entity", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ],
  "updates": [
    {
      "id": "id_of_existing_entity",
      "notes_append": "New information to add (omit if nothing new)",
      "excerpt": "Revised one-sentence description if this is sharper (omit if existing is fine)"
    }
  ],
  "existing_connections": [
    { "source": "existing_id", "target": "existing_or_new_id", "label": "brief lowercase relationship" }
  ]
}

ID rules:
- Existing roster nodes: use their EXACT id — never invent a new id for them
- New nodes: descriptive snake_case (e.g. "morning_runs", "coffee_shop_on_maple", "anxiety_about_work")
- Do NOT recreate existing entities — reference them via updates or connection targets only
- A first name alone that clearly refers to an existing roster node IS that node — use their exact id
- Connections should capture real relationships (appeared together, part of, caused, led to, etc.)`;

    // Pre-scan to surface mentioned existing nodes for richer context
    const combinedLower = combinedText.toLowerCase();
    const mentionedIds = new Set(
      existingNodes
        .filter((n) => [n.name, ...(n.aliases || [])].some((a) => combinedLower.includes(a.toLowerCase())))
        .map((n) => n.id)
    );

    const existingCtx = existingNodes.length > 0
      ? `\n\nEXISTING GRAPH NODES — do not recreate; use exact id in connection targets or updates:\n${
          existingNodes.map((n) => {
            const parts = [`  id: "${n.id}"  name: "${n.name}" (${n.type})${n.excerpt ? ` | ${n.excerpt}` : ""}`];
            if (n.aliases?.length) parts.push(`    aliases: ${n.aliases.join(", ")}`);
            if (n.disambiguation) parts.push(`    disambiguation: ${n.disambiguation}`);
            if (mentionedIds.has(n.id)) {
              if (n.context_summary) parts.push(`    context: ${n.context_summary}`);
              else if (n.notes) parts.push(`    notes: ${n.notes.slice(0, 400)}`);
            }
            return parts.join("\n");
          }).join("\n")
        }`
      : "";

    const userPrompt = `Extract all entities from the following journal entries.${existingCtx}\n\nJOURNAL ENTRIES:\n${combinedText}`;

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });

    let extracted;
    try {
      extracted = JSON.parse(completion.choices[0].message.content);
    } catch {
      return res.status(500).json({ error: "AI returned malformed JSON — please try again." });
    }

    const newNodes = extracted.nodes || [];
    const updates = extracted.updates || [];
    const existingConns = extracted.existing_connections || [];

    if (newNodes.length === 0 && updates.length === 0 && existingConns.length === 0) {
      return res.status(200).json({ nodesCreated: [], nodesUpdated: [], mentionsCreated: [] });
    }

    // ── Deduplicate against existing graph ────────────────────────────────────
    const { deduped, remapIds } = deduplicateNodes(newNodes, existingNodes);
    const finalNodes = remapConnections(deduped, remapIds);
    const newNodeIdSet = new Set(
      finalNodes
        .filter((node) => node?.id && node?.name)
        .map((node) => String(node.id).replace(/[^a-z0-9_-]/gi, "_").toLowerCase())
    );
    const knownNodeIds = new Set([...existingIdSet, ...newNodeIdSet, ...documentNodeIds]);

    // Collect orphaned connections from deduped (merged) nodes
    const orphanedBySource = new Map();
    for (const node of newNodes) {
      const canonicalId = remapIds.get(node.id);
      if (!canonicalId) continue;
      const conns = (node.connections || []).map((c) => ({ ...c, target: remapIds.get(c.target) ?? c.target }));
      if (conns.length > 0) {
        if (!orphanedBySource.has(canonicalId)) orphanedBySource.set(canonicalId, []);
        orphanedBySource.get(canonicalId).push(...conns);
      }
    }

    // ── Write notes/*.json — no .md files ─────────────────────────────────────
    ensureDir(notesDir);

    const savedNodes = [];
    const nodesForSummary = [];

    for (const node of finalNodes) {
      if (!node.id || !node.name) continue;
      const safeId = node.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();

      // sourceFile = first journal entry that mentions this entity
      const sourceFile = findFirstMentionEntry(node.name, node.aliases || [], sortedEntries);

      const nodeData = {
        id: safeId,
        name: node.name,
        type: node.type || "person",
        excerpt: node.excerpt || "",
        notes: node.notes || "",
        aliases: (node.aliases || []).filter((a) => typeof a === "string" && a.trim()),
        connections: normalizeConnectionList(node.connections || [], safeId, knownNodeIds),
        originSourceFile: sourceFile,
        sourceFile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const filePath = path.join(notesDir, `${safeId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(nodeData, null, 2), "utf-8");
      savedNodes.push({ id: safeId, name: node.name, type: node.type || "person" });
      nodesForSummary.push({ filePath, nodeData });

      const docNodeId = documentNodeIdBySourceFile.get(sourceFile);
      if (docNodeId && docNodeId !== safeId) {
        patchNodeConnections(notesDir, docNodeId, [{ target: safeId, label: "mentions" }]);
        patchNodeConnections(notesDir, safeId, [{ target: docNodeId, label: "mentioned in" }]);
      }
    }

    // ── Apply incremental updates to existing nodes ───────────────────────────
    let updatedNodeCount = 0;
    const updatedNodeIds = [];
    for (const update of updates) {
      if (!update.id) continue;
      const canonicalId = remapIds.get(update.id) ?? update.id;
      if (!existingIdSet.has(canonicalId)) continue;
      const patched = patchNodeContent(notesDir, canonicalId, update.notes_append || "", update.excerpt || "");
      if (patched) { updatedNodeCount++; updatedNodeIds.push(canonicalId); }
    }

    // ── Patch orphaned + explicit existing connections ────────────────────────
    for (const [sourceId, conns] of orphanedBySource) {
      if (!knownNodeIds.has(sourceId)) continue;
      const filtered = normalizeConnectionList(conns, sourceId, knownNodeIds);
      patchNodeConnections(notesDir, sourceId, filtered);
    }
    for (const conn of existingConns) {
      const sourceId = remapIds.get(conn.source) ?? conn.source;
      const targetId = remapIds.get(conn.target) ?? conn.target;
      if (!existingIdSet.has(sourceId)) continue;
      if (!knownNodeIds.has(targetId)) continue;
      patchNodeConnections(notesDir, sourceId, [{ target: targetId, label: conn.label || "" }]);
    }

    // ── Batch context_summary generation ─────────────────────────────────────
    const summaryItems = [
      ...nodesForSummary.map(({ nodeData }) => ({ id: nodeData.id, excerpt: nodeData.excerpt, notes: nodeData.notes })),
      ...updatedNodeIds
        .map((id) => { const nd = loadNodeFile(notesDir, id); return nd ? { id, excerpt: nd.excerpt || "", notes: nd.notes || "" } : null; })
        .filter(Boolean),
    ];
    const summaries = await batchGenerateContextSummaries(openai, summaryItems);

    for (const { filePath, nodeData } of nodesForSummary) {
      const summary = summaries[nodeData.id];
      if (!summary) continue;
      const stored = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      stored.context_summary = summary;
      fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf-8");
    }
    for (const nodeId of updatedNodeIds) {
      const summary = summaries[nodeId];
      if (!summary) continue;
      const nd = loadNodeFile(notesDir, nodeId);
      if (!nd) continue;
      nd.context_summary = summary;
      fs.writeFileSync(path.join(notesDir, `${nodeId}.json`), JSON.stringify(nd, null, 2), "utf-8");
    }

    // ── Update derive-meta (dedup index) ──────────────────────────────────────
    deriveIndex.items = deriveIndex.items.filter((i) => i.inputPath !== DERIVE_KEY);
    deriveIndex.items.push({
      inputPath: DERIVE_KEY,
      sourceHash: contentHash,
      derivedAt: new Date().toISOString(),
      nodeIds: [...new Set([...documentNodeIds, ...savedNodes.map((n) => n.id)])],
    });
    saveDeriveIndex(deriveIndexPath, deriveIndex);

    // ── Rebuild graph cache ───────────────────────────────────────────────────
    syncWorkspaceAfterWrite(workspace, notesDir);

    return res.status(200).json({
      nodesCreated: savedNodes,
      nodesUpdated: updatedNodeIds.map((id) => ({ id })),
      updatedCount: updatedNodeCount,
    });

  } catch (err) {
    console.error("journal-derive error:", err);
    return res.status(500).json({ error: err.message || "Journal derivation failed" });
  }
}

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import mammoth from "mammoth";
import { syncWorkspaceAfterWrite } from "./bump-version.js";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";
import { ensureDir } from "./_storygraph-io.js";
import { normalizeWrappedProse } from "./_walk.js";

const DERIVE_META_VERSION = 2;

function safeSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 60);
}

function uniqueSlug(base, usedSlugs) {
  if (!usedSlugs.has(base)) { usedSlugs.add(base); return base; }
  let n = 2;
  while (usedSlugs.has(`${base}_${n}`)) n++;
  const slug = `${base}_${n}`;
  usedSlugs.add(slug);
  return slug;
}

function safeInputFilename(filename) {
  const raw = path.basename((filename || "").trim() || `derive-${Date.now()}.md`);
  return raw
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.(txt|docx)$/i, ".md");
}

function uniqStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function uniqById(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeConnectionObjects(base, extra) {
  const out = [];
  const seen = new Set();
  const add = (conn) => {
    const target = String(conn?.target || conn?.target_id || "").trim();
    if (!target) return;
    const label = String(conn?.label || "").trim();
    const key = `${target.toLowerCase()}::${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ target_id: target, label });
  };
  for (const c of base || []) add(c);
  for (const c of extra || []) add(c);
  return out;
}

function mergeExistingConnectionObjects(base, extra) {
  const out = [];
  const seen = new Set();
  const add = (conn) => {
    const source = String(conn?.source || "").trim();
    const target = String(conn?.target || conn?.target_id || "").trim();
    if (!source || !target) return;
    const label = String(conn?.label || "").trim();
    const key = `${source.toLowerCase()}::${target.toLowerCase()}::${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ source, target, label });
  };
  for (const c of base || []) add(c);
  for (const c of extra || []) add(c);
  return out;
}

function toNarrativeParagraphs(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // Remove common markdown/list prefixes, then reflow line-broken prose.
  const noListPrefixes = raw
    .replace(/^[ \t]*[-*•]\s+/gm, "")
    .replace(/^[ \t]*\d+[.)]\s+/gm, "");

  const paragraphs = noListPrefixes
    .split(/\n\s*\n+/)
    .map((p) => p.split(/\n+/).map((line) => line.trim()).filter(Boolean).join(" ").trim())
    .filter(Boolean);

  return paragraphs.join("\n\n");
}

function mergeNarrativeNotes(prevText, nextText) {
  const prev = toNarrativeParagraphs(prevText || "");
  const next = toNarrativeParagraphs(nextText || "");
  if (!next) return prev;
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return `${prev}\n\n${next}`;
}

function mergeEntityRecords(base, extra) {
  const byId = new Map();
  for (const item of [...(base || []), ...(extra || [])]) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id) || {
      id,
      name: "",
      type: "character",
      excerpt: "",
      notes: "",
      aliases: [],
      connections: [],
      key_excerpts: [],
    };
    const nextExcerpt = String(item?.excerpt || "").trim();
    byId.set(id, {
      id,
      name: String(item?.name || prev.name || "").trim(),
      type: String(item?.type || prev.type || "character").trim() || "character",
      excerpt: nextExcerpt.length > prev.excerpt.length ? nextExcerpt : prev.excerpt,
      notes: mergeNarrativeNotes(prev.notes, item?.notes || ""),
      aliases: uniqStrings([...(prev.aliases || []), ...(item?.aliases || [])]),
      connections: mergeConnectionObjects(prev.connections || [], item?.connections || []),
      key_excerpts: uniqStrings([...(prev.key_excerpts || []), ...(item?.key_excerpts || [])]).slice(0, 12),
    });
  }
  return [...byId.values()];
}

async function synthesizeEntityNarratives(openai, items) {
  const payload = (items || []).map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    excerpt: item.excerpt || "",
    notes: toNarrativeParagraphs(item.notes || ""),
    key_excerpts: uniqStrings(item.key_excerpts || []).slice(0, 10),
    relationships: (item.connections || []).map((c) => ({
      target: c.target,
      targetName: c.targetName,
      label: c.label || "",
    })),
  }));

  if (payload.length === 0) return {};

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Rewrite each entity into a cohesive narrative summary. Return a JSON object where keys are entity ids and values are prose summaries. " +
            "Use complete sentences and flowing paragraphs. Integrate relationships naturally into the narrative context. " +
            "Do NOT output bullet points, numbered lists, or terse fact fragments. " +
            "Preserve concrete plot details from notes and key excerpts.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
      temperature: 0.15,
      max_tokens: Math.min(900 * payload.length, 12000),
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function mergeUpdateObjects(base, extra) {
  const byId = new Map();
  for (const item of [...(base || []), ...(extra || [])]) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id) || { id, notes_append: "", excerpt: "" };
    const notesAppend = toNarrativeParagraphs(item?.notes_append || "");
    const excerpt = String(item?.excerpt || "").trim();
    byId.set(id, {
      id,
      notes_append: notesAppend && notesAppend !== prev.notes_append
        ? [prev.notes_append, notesAppend].filter(Boolean).join("\n\n")
        : prev.notes_append,
      excerpt: excerpt || prev.excerpt,
    });
  }
  return [...byId.values()].filter((u) => u.notes_append || u.excerpt);
}

function mergeExtractionPayload(base, additions) {
  const baseNodes = Array.isArray(base?.entities) ? base.entities : [];
  const baseMentions = Array.isArray(base?.mentions) ? base.mentions : [];
  const baseUpdates = Array.isArray(base?.updates) ? base.updates : [];
  const baseExistingConns = Array.isArray(base?.existing_connections) ? base.existing_connections : [];

  const addNodes = Array.isArray(additions?.missing_entities) ? additions.missing_entities : [];
  const addMentions = Array.isArray(additions?.missing_mentions) ? additions.missing_mentions : [];
  const addUpdates = Array.isArray(additions?.updates_additional) ? additions.updates_additional : [];
  const addExistingConns = Array.isArray(additions?.existing_connections_additional)
    ? additions.existing_connections_additional
    : [];

  return {
    entities: mergeEntityRecords(baseNodes, addNodes),
    mentions: uniqById([...baseMentions, ...addMentions]).map((m) => ({
      ...m,
      connections: mergeConnectionObjects([], m.connections || []),
    })),
    updates: mergeUpdateObjects(baseUpdates, addUpdates),
    existing_connections: mergeExistingConnectionObjects(baseExistingConns, addExistingConns),
    node_enrichments: Array.isArray(additions?.node_enrichments) ? additions.node_enrichments : [],
  };
}

function mergeTextAppend(existingText, nextText) {
  return mergeNarrativeNotes(existingText, nextText);
}

function buildMajorSourceMarkdown({ excerpt, notes }) {
  const summary = String(excerpt || "").trim();
  const detail = toNarrativeParagraphs(notes || "");
  const lines = [];
  if (summary) {
    lines.push(summary, "");
  }
  if (detail) {
    lines.push(detail, "");
  }
  return toNarrativeParagraphs(lines.join("\n")).trim() + "\n";
}

function mergeSourceFileList(primary, extras) {
  const primaryClean = String(primary || "").trim();
  const all = [primaryClean, ...(extras || [])]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const item of all) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(item);
  }
  return {
    sourceFile: uniq[0] || "",
    additionalSourceFiles: uniq.slice(1),
  };
}

function loadDeriveIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return { version: DERIVE_META_VERSION, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    if (!Array.isArray(parsed.items)) return { version: DERIVE_META_VERSION, items: [] };
    return { version: DERIVE_META_VERSION, items: parsed.items };
  } catch {
    return { version: DERIVE_META_VERSION, items: [] };
  }
}

function saveDeriveIndex(indexPath, index) {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

function relinkDerivedNodesToPath({ notesDir, wsDir, nodeIds, newFolderSlug }) {
  const relinkedNodeIds = [];
  const newFolderAbs = path.join(wsDir, newFolderSlug);
  ensureDir(newFolderAbs);

  for (const nodeId of nodeIds || []) {
    const jsonPath = path.join(notesDir, `${nodeId}.json`);
    if (!fs.existsSync(jsonPath)) continue;

    let data;
    try { data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); }
    catch { continue; }

    const nextPrimary = `${newFolderSlug}/${nodeId}.md`;
    const prevPrimary = data.sourceFile || "";
    if (prevPrimary === nextPrimary) {
      relinkedNodeIds.push(nodeId);
      continue;
    }

    const allFiles = [prevPrimary, ...(data.additionalSourceFiles || [])].filter(Boolean);
    const prevCandidates = [...new Set([
      prevPrimary,
      ...allFiles,
      `${nodeId}.md`,
      `${nodeId}.txt`,
      ...(prevPrimary ? [prevPrimary.replace(/\.md$/i, ".txt"), prevPrimary.replace(/\.txt$/i, ".md")] : []),
    ].filter(Boolean))];

    const nextAbs = path.join(wsDir, nextPrimary);
    let moved = false;
    for (const rel of prevCandidates) {
      const abs = path.join(wsDir, rel);
      if (!fs.existsSync(abs)) continue;
      if (abs === nextAbs) { moved = true; break; }
      const nextDir = path.dirname(nextAbs);
      ensureDir(nextDir);
      try {
        fs.renameSync(abs, nextAbs);
        moved = true;
        break;
      } catch {
        // keep searching candidates
      }
    }

    if (!moved && !fs.existsSync(nextAbs)) {
      const fallback = toNarrativeParagraphs(data.notes || "") || String(data.excerpt || "").trim() || String(data.name || nodeId);
      try { fs.writeFileSync(nextAbs, fallback, "utf-8"); } catch { /* non-fatal */ }
    }

    if (!data.originSourceFile) data.originSourceFile = prevPrimary || nextPrimary;
    data.sourceFile = nextPrimary;
    const extras = [...new Set(allFiles.filter((f) => f && f !== nextPrimary))];
    if (extras.length) data.additionalSourceFiles = extras;
    else delete data.additionalSourceFiles;
    data.updatedAt = Date.now();

    try {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
      relinkedNodeIds.push(nodeId);
    } catch {
      // non-fatal
    }
  }

  return relinkedNodeIds;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server misconfiguration" });

    const { text, base64, type, workspace, folderName, filename, force } = req.body;

    // ── Validate workspace ────────────────────────────────────────────────────
    if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
      return res.status(400).json({ error: "Invalid workspace" });
    }
    if (!folderName || !/^[a-zA-Z0-9 _-]+$/.test(folderName)) {
      return res.status(400).json({ error: "Invalid folder name" });
    }

    // ── Extract raw text ─────────────────────────────────────────────────────
    let rawText = text || "";
    if (type === "docx" && base64) {
      const buffer = Buffer.from(base64, "base64");
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    }
    rawText = normalizeWrappedProse(rawText.trim());
    if (!rawText) return res.status(400).json({ error: "No text content found in the file." });

    // ── Compute content hash ─────────────────────────────────────────────────
    const contentHash = crypto.createHash("sha256").update(rawText).digest("hex");

    // ── Resolve paths ────────────────────────────────────────────────────────
    const wsDir = path.join(WORKSPACES_DIR, workspace);
    const notesDir = path.join(wsDir, "notes");
    const folderSlug = safeSlug(folderName);
    const safeFilename = safeInputFilename(filename);
    const inputPath = `${folderSlug}/${safeFilename}`;
    const rawFolder = path.join(wsDir, folderSlug);
    const metaPath = path.join(rawFolder, "_meta.json");
    const deriveIndexPath = path.join(wsDir, "derive-meta.json");

    // ── Path+hash dedupe / relink policy ─────────────────────────────────────
    const deriveIndex = loadDeriveIndex(deriveIndexPath);
    // When force=true, strip existing derive-meta for this path so we re-derive from scratch
    if (force) {
      deriveIndex.items = deriveIndex.items.filter((i) => i.inputPath !== inputPath);
    }
    const pathMatch = deriveIndex.items.find((i) => i.inputPath === inputPath);
    if (pathMatch && pathMatch.sourceHash === contentHash) {
      return res.status(200).json({
        alreadyDerived: true,
        folder: folderSlug,
        derivedAt: pathMatch.derivedAt,
        nodes: pathMatch.nodeIds || [],
      });
    }

    const hashMatch = deriveIndex.items.find((i) => i.sourceHash === contentHash);
    if ((!pathMatch || pathMatch.sourceHash !== contentHash) && hashMatch && hashMatch.inputPath !== inputPath) {
      ensureDir(notesDir);
      const relinkedNodeIds = relinkDerivedNodesToPath({
        notesDir,
        wsDir,
        nodeIds: hashMatch.nodeIds || [],
        newFolderSlug: folderSlug,
      });

      deriveIndex.items = deriveIndex.items.filter((i) => i.sourceHash !== contentHash && i.inputPath !== inputPath);
      const relinkEntry = {
        inputPath,
        folderName,
        folderSlug,
        sourceHash: contentHash,
        derivedAt: new Date().toISOString(),
        nodeIds: relinkedNodeIds,
      };
      deriveIndex.items.push(relinkEntry);
      saveDeriveIndex(deriveIndexPath, deriveIndex);
      ensureDir(rawFolder);
      fs.writeFileSync(metaPath, JSON.stringify(relinkEntry, null, 2), "utf-8");

      syncWorkspaceAfterWrite(workspace, notesDir);

      return res.status(200).json({
        alreadyDerived: true,
        relinked: true,
        folder: folderSlug,
        derivedAt: relinkEntry.derivedAt,
        nodes: relinkedNodeIds,
      });
    }

    // ── Load existing graph nodes from cache (single read) with N+1 fallback ─
    let existingNodes = [];
    const cachePath = path.join(wsDir, "graph-cache.json");
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        existingNodes = (cache.nodes || []).filter((n) => n.id && n.name).map((n) => ({
          id: n.id, name: n.name, type: n.type || "character",
          aliases: n.aliases || [], excerpt: n.excerpt || "",
          disambiguation: n.disambiguation || "",
        }));
      } catch { /* fall through to N+1 scan */ }
    }
    if (existingNodes.length === 0 && fs.existsSync(notesDir)) {
      for (const file of fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
          if (data.id && data.name) existingNodes.push({
            id: data.id, name: data.name, type: data.type || "character",
            aliases: data.aliases || [], excerpt: data.excerpt || "",
            disambiguation: data.disambiguation || "",
          });
        } catch { /* skip malformed */ }
      }
    }

    // Build name/alias → existing id map for merge detection
    const existingNameToId = new Map();
    for (const n of existingNodes) {
      existingNameToId.set(n.name.toLowerCase(), n.id);
      for (const alias of n.aliases) existingNameToId.set(alias.toLowerCase(), n.id);
    }

    // ── Prompt ───────────────────────────────────────────────────────────────
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are a narrative analyst extracting a comprehensive entity map from story text.

  Your job: maximize recall for important story content while preserving clean major/minor separation.

  MAJOR entities:
  - recurring, high-impact, or lore-critical people/places/factions/artifacts/events
  - MUST include robust notes covering concrete plot beats, motivations, conflicts, interactions, and outcomes from the text

  MINOR mentions:
  - one-off/background/supporting references that still matter for graph context
  - should remain lightweight and connected to major/existing nodes

Return ONLY valid JSON:
{
  "entities": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "notes": "Comprehensive narrative prose (minimum 8 sentences) with specific plot points, interactions, and concrete details from the text",
      "key_excerpts": ["important direct line or short passage from the source"],
      "aliases": ["alias1", "alias2"],
      "connections": [
        { "target_id": "exact_id_from_roster_or_this_batch", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ],
  "mentions": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "connections": [
        { "target_id": "exact_id_from_roster_or_this_batch", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ]
}

ID rules (CRITICAL for disambiguation):
- For EXISTING nodes in the roster below: use their EXACT id as shown — never invent a new id for them
- For NEW entities you are creating: invent a snake_case id (e.g. "maren_ashveil", "salt_warren")
- Connection target_id must be either an existing roster id OR the id you assigned to another entity/mention in this extraction
- If a partial name in the text (e.g. "Vane") could match multiple existing nodes, use the excerpt and context to pick the correct id

Other rules:
- Names must match the text exactly (proper capitalisation)
- Aliases should capture shorthand references (e.g. "Sable" for "Sable Voss")
- Do not invent entities not present in the text
- Do not include truly unnamed walk-ons (e.g. "a guard", "some merchants")
- Mentions should include connections when clear, but still include important one-off mentions even if no explicit edge is available in this excerpt
- If an existing graph node (listed below) appears in the text with meaningful new information, include it as a MAJOR entity using its EXACT existing id and name — the system will merge the new notes into the existing profile without duplicating it
- Write notes as narrative paragraphs only. Do NOT use bullet points, numbered lists, or checklist formatting in notes or notes_append fields.
- In notes, prefer complete sentences with explicit subjects and verbs, not shorthand fragments like "X enemy Y".`;

    const existingCtx = existingNodes.length > 0
      ? `\n\nEXISTING GRAPH NODES — use the exact id for any references to these in target_id fields:\n${existingNodes.map(n => {
          const parts = [`  id: "${n.id}"  name: "${n.name}" (${n.type})${n.excerpt ? ` | ${n.excerpt}` : ""}`];
          if (n.aliases?.length) parts.push(`    aliases: ${n.aliases.join(", ")}`);
          if (n.disambiguation) parts.push(`    disambiguation: ${n.disambiguation}`);
          return parts.join("\n");
        }).join("\n")}`
      : "";

    const userPrompt = `Extract all entities from the following text.${existingCtx}\n\nTEXT:\n${rawText}`;

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

    const firstPass = {
      entities: Array.isArray(extracted?.entities) ? extracted.entities : [],
      mentions: Array.isArray(extracted?.mentions) ? extracted.mentions : [],
      updates: Array.isArray(extracted?.updates) ? extracted.updates : [],
      existing_connections: Array.isArray(extracted?.existing_connections) ? extracted.existing_connections : [],
    };

    const coverageSystemPrompt = `You are a strict extraction QA pass. Review the draft extraction against source text.

Return ONLY valid JSON with this schema:
{
  "missing_entities": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "notes": "Detailed narrative notes (minimum 5 sentences) with concrete plot points and interactions",
      "key_excerpts": ["important direct line or short passage from the source"],
      "aliases": ["alias1"],
      "connections": [
        { "target_id": "exact_id_from_roster_or_this_batch", "label": "brief lowercase relationship" }
      ]
    }
  ],
  "missing_mentions": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "connections": [
        { "target_id": "exact_id_from_roster_or_this_batch", "label": "brief lowercase relationship" }
      ]
    }
  ],
  "node_enrichments": [
    {
      "id": "id_from_draft_or_existing_roster",
      "notes_append": "Additional high-value facts missing from draft notes",
      "excerpt": "Sharper excerpt only if materially better",
      "connections": [
        { "target_id": "exact_id_from_roster_or_this_batch", "label": "brief lowercase relationship" }
      ]
    }
  ],
  "updates_additional": [
    { "id": "existing_id", "notes_append": "net-new details", "excerpt": "optional improved excerpt" }
  ],
  "existing_connections_additional": [
    { "source": "existing_id", "target": "existing_or_new_id", "label": "brief lowercase relationship" }
  ]
}

Rules:
- Return additions/enrichments only; do not duplicate draft items
- Preserve major vs minor separation
- Prioritize missing plot points, interactions, turning points, and concrete details
- Write notes and notes_append as narrative paragraphs only (no bullets or numbered lists)
- Use complete sentences with clear grammar, not shorthand relation fragments
- Prefer capturing key excerpts that justify the narrative summary and then expand them into cohesive prose.`;

    let mergedExtraction = {
      ...firstPass,
      node_enrichments: [],
    };
    try {
      const coverageResp = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: coverageSystemPrompt },
          {
            role: "user",
            content:
              `SOURCE TEXT:\n${rawText}\n\n` +
              `EXISTING ROSTER:\n${existingCtx || "(none)"}\n\n` +
              `DRAFT EXTRACTION:\n${JSON.stringify(firstPass)}`,
          },
        ],
        temperature: 0.1,
      });
      const additions = JSON.parse(coverageResp.choices[0].message.content || "{}");
      mergedExtraction = mergeExtractionPayload(firstPass, additions);
    } catch {
      // Non-fatal: keep first-pass extraction if coverage QA fails.
    }

    const entities = mergedExtraction.entities || [];
    const mentions = mergedExtraction.mentions || [];
    const updates = mergedExtraction.updates || [];
    const existingConns = mergedExtraction.existing_connections || [];
    const nodeEnrichments = Array.isArray(mergedExtraction.node_enrichments) ? mergedExtraction.node_enrichments : [];
    if (entities.length === 0 && mentions.length === 0 && updates.length === 0 && existingConns.length === 0) {
      return res.status(200).json({ folder: folderSlug, nodesCreated: [], mentionsCreated: [] });
    }

    // ── Assign slugs ──────────────────────────────────────────────────────────
    const usedSlugs = new Set();
    // Reserve existing node IDs to avoid collisions
    for (const n of existingNodes) usedSlugs.add(n.id);

    const existingIdSet = new Set(existingNodes.map((n) => n.id));

    const resolveEntityId = (e, usedSlugs) => {
      // Priority 1: AI provided an id that matches an existing node exactly → merge
      if (e.id && existingIdSet.has(e.id)) return { ...e, _isExisting: true };
      // Priority 2: Name/alias match (graceful fallback for older-format responses)
      const existingId = existingNameToId.get(e.name.toLowerCase());
      if (existingId) return { ...e, id: existingId, _isExisting: true };
      // New entity: use AI-provided id (sanitised) or derive from name
      const baseSlug = e.id ? safeSlug(e.id) : safeSlug(e.name);
      const id = uniqueSlug(baseSlug, usedSlugs);
      return { ...e, id, _isExisting: false };
    };

    const entitiesWithIds = entities.map((e) => resolveEntityId(e, usedSlugs));
    const mentionsWithIds = mentions.map((m) => resolveEntityId(m, usedSlugs));

    if (nodeEnrichments.length > 0) {
      const enrichById = new Map();
      for (const item of nodeEnrichments) {
        const id = String(item?.id || "").trim();
        if (!id) continue;
        const prev = enrichById.get(id) || { notes_append: "", excerpt: "", connections: [] };
        enrichById.set(id, {
          notes_append: mergeTextAppend(prev.notes_append, item?.notes_append || ""),
          excerpt: String(item?.excerpt || prev.excerpt || "").trim(),
          connections: mergeConnectionObjects(prev.connections, item?.connections || []),
        });
      }
      for (const entity of entitiesWithIds) {
        const enrichment = enrichById.get(entity.id);
        if (!enrichment) continue;
        entity.notes = mergeTextAppend(entity.notes || "", enrichment.notes_append || "");
        if (!entity.excerpt && enrichment.excerpt) entity.excerpt = enrichment.excerpt;
        entity.connections = mergeConnectionObjects(entity.connections || [], enrichment.connections || []);
      }
    }

    // Build name→id map: current batch (major + minor) + existing graph nodes
    const nameToId = new Map();
    for (const n of existingNodes) {
      nameToId.set(n.name.toLowerCase(), n.id);
      for (const alias of (n.aliases || [])) nameToId.set(alias.toLowerCase(), n.id);
    }
    for (const e of entitiesWithIds) nameToId.set(e.name.toLowerCase(), e.id);
    for (const m of mentionsWithIds) nameToId.set(m.name.toLowerCase(), m.id);

    // Build a set of all IDs in this batch for target_id validation
    const batchIdSet = new Set([
      ...entitiesWithIds.map((e) => e.id),
      ...mentionsWithIds.map((m) => m.id),
    ]);

    // Helper: resolve connections for any entity/mention.
    // Prefers target_id (direct ID reference) over target_name (legacy name lookup).
    function resolveConnections(rawConns, selfId) {
      const seen = new Set();
      return (rawConns || [])
        .map((c) => {
          let targetId;
          // target_id: AI committed to a specific node id — use directly if valid
          if (c.target_id) {
            if (existingIdSet.has(c.target_id) || batchIdSet.has(c.target_id)) {
              targetId = c.target_id;
            }
          }
          // target_name: legacy fallback (graceful degradation)
          if (!targetId && c.target_name) {
            targetId = nameToId.get(c.target_name.toLowerCase());
          }
          if (!targetId || targetId === selfId) return null;
          if (seen.has(targetId)) return null;
          seen.add(targetId);
          return { target: targetId, label: c.label || "" };
        })
        .filter(Boolean);
    }

    const idToName = new Map();
    for (const n of existingNodes) idToName.set(n.id, n.name);
    for (const e of entitiesWithIds) idToName.set(e.id, e.name);
    for (const m of mentionsWithIds) idToName.set(m.id, m.name);

    const resolvedEntities = entitiesWithIds.map((entity) => {
      const resolvedConnections = resolveConnections(entity.connections, entity.id);
      return {
        ...entity,
        _resolvedConnections: resolvedConnections,
        _resolvedConnectionContext: resolvedConnections.map((c) => ({
          target: c.target,
          targetName: idToName.get(c.target) || c.target,
          label: c.label || "",
        })),
      };
    });

    const existingEntityState = new Map();
    for (const entity of resolvedEntities) {
      if (!entity._isExisting) continue;
      const jsonPath = path.join(notesDir, `${entity.id}.json`);
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        existingEntityState.set(entity.id, data);
      } catch {
        // Non-fatal: fall back to current extraction-only synthesis if read fails.
      }
    }

    const synthesizedNarratives = await synthesizeEntityNarratives(
      openai,
      resolvedEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        excerpt: entity.excerpt,
        notes: entity._isExisting
          ? mergeTextAppend(existingEntityState.get(entity.id)?.notes || "", entity.notes || "")
          : entity.notes,
        key_excerpts: entity.key_excerpts || [],
        connections: entity._resolvedConnectionContext,
      }))
    );

    // ── Write files ───────────────────────────────────────────────────────────
    ensureDir(rawFolder);
    ensureDir(notesDir);

    const createdNodes = [];
    const updatedNodes = [];
    const createdMentions = [];

    // ── Major entities ────────────────────────────────────────────────────────
    for (const entity of resolvedEntities) {
      const connections = entity._resolvedConnections || [];
      const narrativeNotes = toNarrativeParagraphs(
        synthesizedNarratives?.[entity.id] || entity.notes || ""
      );
      const mdContent = buildMajorSourceMarkdown({
        type: entity.type,
        excerpt: entity.excerpt,
        notes: narrativeNotes,
      });

      if (entity._isExisting) {
        // ── Existing node: write supplemental .md to new folder, patch the JSON ──
        fs.writeFileSync(path.join(rawFolder, `${entity.id}.md`), mdContent, "utf-8");

        const jsonPath = path.join(notesDir, `${entity.id}.json`);
        let existingData;
        try { existingData = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); }
        catch { continue; } // can't patch what we can't read

        if (!existingData.originSourceFile) {
          existingData.originSourceFile = existingData.sourceFile || `${folderSlug}/${entity.id}.md`;
        }

        // Keep node notes as merged narrative across all contributing files.
        const mergedNotes = mergeTextAppend(existingData.notes || "", narrativeNotes || "");
        if (mergedNotes && mergedNotes !== (existingData.notes || "")) {
          existingData.notes = mergedNotes;
        }
        if (entity.excerpt && entity.excerpt.trim()) {
          existingData.excerpt = entity.excerpt.trim();
        }
        if (Array.isArray(entity.aliases) && entity.aliases.length > 0) {
          existingData.aliases = uniqStrings([...(existingData.aliases || []), ...entity.aliases]);
        }

        // Rotate canonical sourceFile to the latest derived artifact while preserving
        // prior files as additionalSourceFiles so UI/file lookups remain complete.
        const currentDerivedSource = `${folderSlug}/${entity.id}.md`;
        const sourceMerge = mergeSourceFileList(currentDerivedSource, [
          existingData.sourceFile,
          ...(existingData.additionalSourceFiles || []),
        ]);
        existingData.sourceFile = sourceMerge.sourceFile;
        if (sourceMerge.additionalSourceFiles.length > 0) {
          existingData.additionalSourceFiles = sourceMerge.additionalSourceFiles;
        } else {
          delete existingData.additionalSourceFiles;
        }
        if (!existingData.originSourceFile) {
          existingData.originSourceFile = existingData.sourceFile;
        }

        // Patch new connections (skip duplicates)
        const existingTargets = new Set((existingData.connections || []).map((c) => c.target));
        for (const conn of connections) {
          if (!existingTargets.has(conn.target)) {
            existingData.connections.push(conn);
            existingTargets.add(conn.target);
          }
        }

        fs.writeFileSync(jsonPath, JSON.stringify(existingData, null, 2), "utf-8");
        updatedNodes.push({ id: entity.id, name: entity.name, type: entity.type || existingData.type || "character" });

      } else {
        // ── New entity: create .md + full .json ───────────────────────────────
        const sourceFile = `${folderSlug}/${entity.id}.md`;
        fs.writeFileSync(path.join(rawFolder, `${entity.id}.md`), mdContent, "utf-8");

        const nodeData = {
          id: entity.id,
          name: entity.name,
          type: entity.type || "character",
          excerpt: entity.excerpt || "",
          notes: narrativeNotes || "",
          aliases: (entity.aliases || []).filter((a) => typeof a === "string" && a.trim()),
          connections,
          originSourceFile: sourceFile,
          sourceFile,
        };
        fs.writeFileSync(
          path.join(notesDir, `${entity.id}.json`),
          JSON.stringify(nodeData, null, 2),
          "utf-8"
        );
        createdNodes.push({ id: entity.id, name: entity.name, type: entity.type || "character" });
      }
    }

    // ── Explicit updates for existing nodes (net-new facts from coverage + base pass) ──
    for (const update of updates) {
      const updateId = String(update?.id || "").trim();
      if (!updateId || !existingIdSet.has(updateId)) continue;
      const jsonPath = path.join(notesDir, `${updateId}.json`);
      let existingData;
      try { existingData = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); }
      catch { continue; }

      const nextNotes = mergeTextAppend(existingData.notes || "", update?.notes_append || "");
      if (nextNotes !== (existingData.notes || "")) existingData.notes = nextNotes;
      if (update?.excerpt && String(update.excerpt).trim()) {
        existingData.excerpt = String(update.excerpt).trim();
      }
      existingData.updatedAt = Date.now();
      fs.writeFileSync(jsonPath, JSON.stringify(existingData, null, 2), "utf-8");
      if (!updatedNodes.some((n) => n.id === updateId)) {
        updatedNodes.push({ id: existingData.id, name: existingData.name, type: existingData.type || "character" });
      }
    }

    // ── Existing→existing / existing→new connection additions ─────────────────
    for (const conn of existingConns) {
      const sourceId = String(conn?.source || "").trim();
      const targetId = String(conn?.target || "").trim();
      if (!sourceId || !targetId) continue;
      if (!existingIdSet.has(sourceId)) continue;
      if (!(existingIdSet.has(targetId) || batchIdSet.has(targetId))) continue;

      const jsonPath = path.join(notesDir, `${sourceId}.json`);
      let sourceData;
      try { sourceData = JSON.parse(fs.readFileSync(jsonPath, "utf-8")); }
      catch { continue; }

      sourceData.connections = sourceData.connections || [];
      const already = sourceData.connections.some((c) => c.target === targetId);
      if (!already && targetId !== sourceId) {
        sourceData.connections.push({ target: targetId, label: String(conn?.label || "").trim() });
        sourceData.updatedAt = Date.now();
        fs.writeFileSync(jsonPath, JSON.stringify(sourceData, null, 2), "utf-8");
      }
    }

    // ── Minor mentions → minimal .json only (no .md, no sourceFile → grey node) ──
    // Skip if the mention matched an existing node — it already has a JSON file.
    for (const mention of mentionsWithIds) {
      if (mention._isExisting) continue; // already exists — no new file needed
      const connections = resolveConnections(mention.connections, mention.id);
      const nodeData = {
        id: mention.id,
        name: mention.name,
        type: mention.type || "character",
        excerpt: mention.excerpt || "",
        notes: "",
        aliases: [],
        connections,
      };
      fs.writeFileSync(
        path.join(notesDir, `${mention.id}.json`),
        JSON.stringify(nodeData, null, 2),
        "utf-8"
      );
      createdMentions.push({ id: mention.id, name: mention.name, type: mention.type || "character" });
    }

    // ── Write _meta.json ─────────────────────────────────────────────────────
    const meta = {
      inputPath,
      sourceHash: contentHash,
      folderName,
      derivedAt: new Date().toISOString(),
      nodes: createdNodes.map((n) => n.id),
      updated: updatedNodes.map((n) => n.id),
      mentions: createdMentions.map((m) => m.id),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    // Keep a workspace-level dedupe index keyed by input path + hash.
    deriveIndex.items = deriveIndex.items.filter((i) => i.inputPath !== inputPath && i.sourceHash !== contentHash);
    deriveIndex.items.push({
      inputPath,
      folderName,
      folderSlug,
      sourceHash: contentHash,
      derivedAt: meta.derivedAt,
      nodeIds: createdNodes.map((n) => n.id),
    });
    saveDeriveIndex(deriveIndexPath, deriveIndex);

    // ── Rebuild graph cache ───────────────────────────────────────────────────
    syncWorkspaceAfterWrite(workspace, notesDir);

    return res.status(200).json({
      folder: folderSlug,
      nodesCreated: createdNodes,
      nodesUpdated: updatedNodes,
      mentionsCreated: createdMentions,
    });

  } catch (err) {
    console.error("story-derive error:", err);
    return res.status(500).json({ error: err.message || "Derivation failed" });
  }
}

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
      const fallback = `${(data.name || nodeId).toUpperCase()} — ${data.type || "character"} notes\n\n${data.notes || ""}`;
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

    const systemPrompt = `You are a narrative analyst extracting a comprehensive entity map from a story text.

Your job: identify every named entity in the text and classify each as MAJOR or MINOR.

MAJOR — entity has narrative agency, appears more than once, drives scenes, or is central to the story's world. Give them full notes.
MINOR — entity is mentioned once or twice, is background/supporting, or has no direct narrative action. Give them just enough to identify them.

Return ONLY valid JSON:
{
  "entities": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "notes": "2–4 paragraphs of prose notes — rich enough to stand alone as a reference file",
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
- Every mention MUST have at least one connection to a major entity or existing graph node — do not emit isolated mentions
- If an existing graph node (listed below) appears in the text with meaningful new information, include it as a MAJOR entity using its EXACT existing id and name — the system will merge the new notes into the existing profile without duplicating it`;

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

    const entities = extracted.entities || [];
    const mentions = extracted.mentions || [];
    if (entities.length === 0 && mentions.length === 0) {
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

    // Build name→id map: current batch (major + minor) + existing graph nodes
    const nameToId = new Map();
    for (const n of existingNodes) {
      nameToId.set(n.name.toLowerCase(), n.id);
      for (const alias of (n.aliases || [])) nameToId.set(alias.toLowerCase(), n.id);
    }
    for (const e of entitiesWithIds) nameToId.set(e.name.toLowerCase(), e.id);
    for (const m of mentionsWithIds) nameToId.set(m.name.toLowerCase(), m.id);

    // ── Write files ───────────────────────────────────────────────────────────
    ensureDir(rawFolder);
    ensureDir(notesDir);

    const createdNodes = [];
    const updatedNodes = [];
    const createdMentions = [];

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

    // ── Major entities ────────────────────────────────────────────────────────
    for (const entity of entitiesWithIds) {
      const connections = resolveConnections(entity.connections, entity.id);
      const mdContent = `${entity.name.toUpperCase()} — ${entity.type} notes\n\n${entity.notes || ""}`;

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

        // Append new notes (avoid duplicate content)
        if (entity.notes && entity.notes.trim() && !existingData.notes.includes(entity.notes.trim())) {
          existingData.notes = existingData.notes
            ? `${existingData.notes}\n\n${entity.notes.trim()}`
            : entity.notes.trim();
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
          notes: entity.notes || "",
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

    // ── Minor mentions → minimal .json only (no .md, no sourceFile → grey node) ──
    // Skip if the mention matched an existing node — it already has a JSON file.
    // Only write if the mention has at least one resolved connection — a stranded
    // grey node with no edges has no useful place in the graph.
    for (const mention of mentionsWithIds) {
      if (mention._isExisting) continue; // already exists — no new file needed
      const connections = resolveConnections(mention.connections, mention.id);
      if (connections.length === 0) continue;
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

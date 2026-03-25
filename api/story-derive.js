import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import mammoth from "mammoth";
import { bumpWorkspaceVersion, rebuildGraphCache } from "./bump-version.js";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server misconfiguration" });

    const { text, base64, type, workspace, folderName } = req.body;

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
    rawText = rawText.trim();
    if (!rawText) return res.status(400).json({ error: "No text content found in the file." });

    // ── Compute content hash ─────────────────────────────────────────────────
    const contentHash = crypto.createHash("sha256").update(rawText).digest("hex");

    // ── Resolve paths ────────────────────────────────────────────────────────
    const wsDir = path.join(WORKSPACES_DIR, workspace);
    const notesDir = path.join(wsDir, "notes");
    const folderSlug = safeSlug(folderName);
    const rawFolder = path.join(wsDir, folderSlug);
    const metaPath = path.join(rawFolder, "_meta.json");

    // ── Hash check for re-derivation ─────────────────────────────────────────
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (meta.sourceHash === contentHash) {
        return res.status(200).json({
          alreadyDerived: true,
          folder: folderSlug,
          derivedAt: meta.derivedAt,
          nodes: meta.nodes || [],
        });
      }
      // Different content — will overwrite, caller confirmed
    }

    // ── Load existing graph nodes for context ────────────────────────────────
    const existingNodes = [];
    if (fs.existsSync(notesDir)) {
      for (const file of fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notesDir, file), "utf-8"));
          if (data.id && data.name) existingNodes.push({
            id: data.id, name: data.name, type: data.type || "character",
            aliases: data.aliases || [],
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
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "notes": "2–4 paragraphs of prose notes — rich enough to stand alone as a reference file",
      "aliases": ["alias1", "alias2"],
      "connections": [
        { "target_name": "Other Entity Name", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ],
  "mentions": [
    {
      "name": "Display Name",
      "type": "character | location | faction | artifact | event",
      "excerpt": "One-sentence description",
      "connections": [
        { "target_name": "Other Entity Name", "label": "brief lowercase relationship (max 8 words)" }
      ]
    }
  ]
}

Rules:
- Names must match the text exactly (proper capitalisation)
- All connection target_names must be the display name of another entity in this same text (major or minor) OR an existing graph node listed below — ids will be assigned after
- Aliases should capture shorthand references (e.g. "Sable" for "Sable Voss")
- Do not invent entities not present in the text
- Do not include truly unnamed walk-ons (e.g. "a guard", "some merchants")
- Every mention MUST have at least one connection to a major entity or existing graph node — do not emit isolated mentions
- If an existing graph node (listed below) appears in the text with meaningful new information, include it as a MAJOR entity with its exact name — the system will merge the new notes into the existing profile without duplicating it`;

    const existingCtx = existingNodes.length > 0
      ? `\n\nEXISTING GRAPH NODES — if one of these appears in the text with new information, include it in "entities" using the exact same name and the system will merge automatically; otherwise reference them only as connection targets:\n${existingNodes.map(n => `  ${n.name} (${n.type})`).join("\n")}`
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

    const entitiesWithIds = entities.map((e) => {
      // Check if this entity matches an existing node by name or alias
      const existingId = existingNameToId.get(e.name.toLowerCase());
      if (existingId) return { ...e, id: existingId, _isExisting: true };
      const id = uniqueSlug(safeSlug(e.name), usedSlugs);
      return { ...e, id, _isExisting: false };
    });
    const mentionsWithIds = mentions.map((m) => {
      // If this mention matches an existing node, reuse that ID (no new grey node needed)
      const existingId = existingNameToId.get(m.name.toLowerCase());
      if (existingId) return { ...m, id: existingId, _isExisting: true };
      const id = uniqueSlug(safeSlug(m.name), usedSlugs);
      return { ...m, id, _isExisting: false };
    });

    // Build name→id map: current batch (major + minor) + existing graph nodes
    const nameToId = new Map();
    for (const n of existingNodes) {
      nameToId.set(n.name.toLowerCase(), n.id);
      for (const alias of (n.aliases || [])) nameToId.set(alias.toLowerCase(), n.id);
    }
    for (const e of entitiesWithIds) nameToId.set(e.name.toLowerCase(), e.id);
    for (const m of mentionsWithIds) nameToId.set(m.name.toLowerCase(), m.id);

    // ── Write files ───────────────────────────────────────────────────────────
    if (!fs.existsSync(rawFolder)) fs.mkdirSync(rawFolder, { recursive: true });
    if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

    const createdNodes = [];
    const updatedNodes = [];
    const createdMentions = [];

    // Helper: resolve connections for any entity/mention
    function resolveConnections(rawConns, selfId) {
      const seen = new Set();
      return (rawConns || [])
        .map((c) => {
          const targetId = nameToId.get((c.target_name || "").toLowerCase());
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
      sourceHash: contentHash,
      folderName,
      derivedAt: new Date().toISOString(),
      nodes: createdNodes.map((n) => n.id),
      updated: updatedNodes.map((n) => n.id),
      mentions: createdMentions.map((m) => m.id),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    // ── Rebuild graph cache ───────────────────────────────────────────────────
    rebuildGraphCache(workspace, notesDir);
    bumpWorkspaceVersion(workspace);

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

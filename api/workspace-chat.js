/**
 * workspace-chat.js
 * RAG chat endpoint for a workspace.
 * POST /api/workspace-chat
 * Body: { workspace: string, messages: [{role, content}], rebuildIndex?: boolean }
 *
 * Streams an SSE response:
 *   data: {"type":"token","content":"..."}\n\n   — one per streamed token
 *   data: {"type":"citations","sources":[...]}\n\n — final event with up to 5 sources
 *   data: {"type":"done"}\n\n
 *
 * ⚠ Production note: embedding cache uses fs.writeFileSync into workspaces/ — localhost only.
 */

import OpenAI from "openai";
import { validateTextField } from "./guardrails.js";
import { getEmbeddingCache, cosineSimilarity } from "./workspace-embed.js";

const openai = new OpenAI();

const SYSTEM_PROMPT = `You are an intelligent assistant embedded in StoryGraph, a fiction writing and worldbuilding tool.
You may ONLY answer questions using the story notes provided in the context below.
You must NEVER draw on your general training knowledge, external facts, or anything not present in those notes — even if you know the answer from the real world.
If the notes do not contain enough information to answer the question, say so explicitly: tell the user that the information is not in the notes.
Do not invent facts about characters, places, or events that aren't in the notes.
Be concise but thorough.

Inline citation format:
Whenever a sentence draws from a specific note, place a citation marker immediately after it — [1] for the first source you introduce, [2] for the second distinct source, and so on.
Do not reuse the same number for a different source. Do not number sources in the order they appear in the context — number them in the order you first cite them in your response.

At the very end of your response, on its own line, write a CITED line declaring which node ID maps to each number. Use this exact format:
CITED: nodeId_for_1, nodeId_for_2

Rules for the CITED line:
- List node IDs in the same order as their citation numbers ([1], [2], ...)
- Use only node IDs from the context headings (e.g. [id: sable_voss])
- Only include nodes whose content you genuinely used — do not list every node in the context
- You may cite as few as 1 or as many as 5, but never more than 5
- If no notes were relevant, write: CITED: none
- The CITED line must be the very last line of your response, preceded by a blank line`;

const CONTRADICTION_PROMPT = `You are reviewing a set of worldbuilding and story notes for internal consistency.
Your ONLY task is to identify factual contradictions, timeline inconsistencies, or logical conflicts within the notes provided.
Look for:
- Characters described differently across notes (age, appearance, status, allegiances, backstory, motivations)
- Events described in conflicting ways or impossible order
- Relationships, alliances, or enmities that contradict each other
- Locations or objects described inconsistently
- Any facts stated one way in one note and a different way in another

For each contradiction found, clearly state:
1. The conflicting claims
2. Which notes they come from

If no contradictions are found, say so clearly and briefly — do not invent issues that aren't there.
Do NOT use any external knowledge — only compare the notes against each other.

Inline citation format: cite each note you reference as [1], [2], etc. in the order you first use them.
At the very end of your response, on its own line:
CITED: nodeId_1, nodeId_2, ...
If no contradictions found: CITED: none`;

const SUMMARIZE_PROMPT = `You are an assistant in StoryGraph, a fiction writing and worldbuilding tool.
Your task is to write a concise summary of the story note provided in the context.
Focus on the most important details: who or what the subject is, their key traits, role in the story, and any notable relationships, backstory, or events.
Keep the summary to 3–5 sentences. Write in a neutral, informative tone.
Do not invent facts that are not in the notes. Do not use inline citation markers in the body text.
At the very end of your response, on its own line, write:
CITED: nodeId_for_the_note
Use only the node ID from the context heading (e.g. [id: sable_voss]).`;

// ---------------------------------------------------------------------------
// Workspace metadata — computed from cache chunks, no extra I/O needed
// ---------------------------------------------------------------------------

/**
 * Build a per-node metadata summary from the embedding cache.
 * Returns:
 *   nodes: Map<nodeId, { name, type, wordCount, text, tags, excerpt }>
 *   totalNotes: number
 *   byType: Map<type, nodeId[]>
 */
function computeWorkspaceMeta(cache) {
  if (!cache?.chunks?.length) return null;
  const nodes = new Map();
  for (const chunk of cache.chunks) {
    if (!nodes.has(chunk.nodeId)) {
      nodes.set(chunk.nodeId, {
        name: chunk.nodeName,
        type: chunk.nodeType || "character",
        wordCount: 0,
        text: "",
        tags: chunk.tags || [],
        excerpt: chunk.excerpt || "",
      });
    }
    const n = nodes.get(chunk.nodeId);
    // Accumulate raw text (strip the "Name: " prefix added during chunking)
    const raw = chunk.text.startsWith(chunk.nodeName + ": ")
      ? chunk.text.slice(chunk.nodeName.length + 2)
      : chunk.text;
    n.text += (n.text ? " " : "") + raw;
    n.wordCount += raw.split(/\s+/).filter(Boolean).length;
  }
  const byType = new Map();
  for (const [id, n] of nodes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type).push(id);
  }
  return { nodes, totalNotes: nodes.size, byType };
}

// Tool schemas for gpt-4o-mini intent classification
const META_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_workspace_summary",
      description: "Get the total number of notes in the workspace and a breakdown by type.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notes_by_word_count",
      description: "Find notes above, below, or between specific word count thresholds. Also handles requests for the longest or shortest notes.",
      parameters: {
        type: "object",
        properties: {
          min: { type: "number", description: "Minimum word count (inclusive). Omit for no lower bound." },
          max: { type: "number", description: "Maximum word count (inclusive). Omit for no upper bound." },
          sort: { type: "string", enum: ["asc", "desc"], description: "'desc' for longest first (default), 'asc' for shortest first." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_references_from",
      description: "Find which other notes are referenced or mentioned inside a specific note. Use this when the question asks what a particular note or entity references, links to, mentions, or talks about — i.e. outgoing references FROM a note. Do NOT use this when asking which notes mention a given term (use get_notes_mentioning for that).",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "The name of the note to inspect for outgoing references." },
        },
        required: ["subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notes_mentioning",
      description: "Find notes that mention one or more specific terms, names, or phrases — i.e. incoming references TO a term. When multiple terms are given, a note must mention all of them to match. Do NOT use this when asking what a particular note itself references or links to (use get_references_from for that). Do NOT use this for tag-based queries (use get_notes_by_tag for that).",
      parameters: {
        type: "object",
        properties: {
          terms: { type: "array", items: { type: "string" }, description: "Terms to search for. A note must contain every term to be included." },
        },
        required: ["terms"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notes_by_type",
      description: "List all notes of a specific type (character, location, faction, artifact, event, etc.), or list all types with counts if no type is specified.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "The note type to filter by. Omit to list all types." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notes_by_tag",
      description: "Find all notes that have a specific tag applied. Use this for any query asking to list, find, or show nodes/notes with a given tag or label (e.g. 'list all nodes tagged veldmoor', 'show me nodes with the tag important'). Do NOT use get_notes_mentioning for tag-based queries.",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "The tag to filter by (exact match, case-insensitive)." },
        },
        required: ["tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tags",
      description: "List all tags used across notes, with the number of notes each tag appears in.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sparse_notes",
      description: "Find notes that are underdeveloped, sparse, stubs, or have very little content written. Optionally specify a word count threshold.",
      parameters: {
        type: "object",
        properties: {
          threshold: { type: "number", description: "Word count below which a note is considered sparse. Defaults to 60." },
        },
        required: [],
      },
    },
  },
];

/**
 * Use gpt-4o-mini tool-calling to classify whether the query is a metadata
 * question. If so, execute the appropriate handler against the pre-computed
 * workspace meta and return a plain-text answer string.
 * Returns null if the query is not a metadata question.
 */
async function resolveMetaQuery(query, meta) {
  if (!meta) return null;
  const { nodes, totalNotes, byType } = meta;
  const nodeList = [...nodes.values()];

  // Ask gpt-4o-mini to classify intent — cheap, fast, no streaming needed
  const intentRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: query }],
    tools: META_TOOLS,
    tool_choice: "auto",
    temperature: 0,
    max_tokens: 100,
  });

  const toolCall = intentRes.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null; // not a meta query — fall through to RAG

  let args = {};
  try { args = JSON.parse(toolCall.function.arguments); } catch {}
  const name = toolCall.function.name;

  // ── get_workspace_summary ──────────────────────────────────────────────────
  if (name === "get_workspace_summary") {
    const typeSummary = [...byType.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([t, ids]) => `${ids.length} ${t}${ids.length !== 1 ? "s" : ""}`)
      .join(", ");
    return `You have **${totalNotes}** notes in this workspace (${typeSummary}).`;
  }

  // ── get_notes_by_word_count ────────────────────────────────────────────────
  if (name === "get_notes_by_word_count") {
    const { min, max, sort = "desc" } = args;
    let matches = nodeList.slice();
    if (min != null) matches = matches.filter((n) => n.wordCount >= min);
    if (max != null) matches = matches.filter((n) => n.wordCount <= max);
    matches.sort((a, b) => sort === "asc" ? a.wordCount - b.wordCount : b.wordCount - a.wordCount);
    const label =
      min != null && max != null ? `between ${min} and ${max} words` :
      min != null ? `over ${min} words` :
      max != null ? `under ${max} words` :
      "sorted by word count";
    if (matches.length === 0) return `No notes are ${label}.`;
    const lines = matches.map((n) => `- **${n.name}** — ${n.wordCount} words`);
    return `**${matches.length}** note${matches.length !== 1 ? "s" : ""} ${label}:\n\n${lines.join("\n")}`;
  }

  // ── get_references_from ───────────────────────────────────────────────────
  if (name === "get_references_from") {
    const subject = (args.subject || "").toLowerCase().trim();
    if (!subject) return null;
    // Find the subject node
    const subjectNode = nodeList.find((n) => n.name.toLowerCase() === subject)
      || nodeList.find((n) => n.name.toLowerCase().includes(subject));
    if (!subjectNode) return `No note named "${args.subject}" was found.`;
    // Scan the subject note's text for names of other nodes
    const bodyLower = subjectNode.text.toLowerCase();
    const referenced = nodeList.filter((n) => {
      if (n.name.toLowerCase() === subjectNode.name.toLowerCase()) return false;
      return bodyLower.includes(n.name.toLowerCase());
    });
    if (referenced.length === 0) return `**${subjectNode.name}** doesn't appear to reference any other notes by name.`;
    const names = referenced.map((n) => `**${n.name}** (${n.type})`).join(", ");
    return `**${subjectNode.name}** references **${referenced.length}** other note${referenced.length !== 1 ? "s" : ""}: ${names}.`;
  }

  // ── get_notes_mentioning ───────────────────────────────────────────────────
  if (name === "get_notes_mentioning") {
    const terms = (args.terms || []).map((t) => t.toLowerCase());
    if (terms.length === 0) return null;
    const matches = nodeList.filter((n) => {
      const body = n.text.toLowerCase();
      const nm = n.name.toLowerCase();
      return terms.every((term) => body.includes(term) || nm.includes(term));
    });
    const termStr = (args.terms || []).map((t) => `"${t}"`).join(" and ");
    if (matches.length === 0) return `No notes mention ${termStr}.`;
    const names = matches.map((n) => `**${n.name}**`).join(", ");
    return `**${matches.length}** note${matches.length !== 1 ? "s" : ""} mention ${termStr}: ${names}.`;
  }

  // ── get_notes_by_type ─────────────────────────────────────────────────────
  if (name === "get_notes_by_type") {
    const filterType = args.type?.toLowerCase();
    if (filterType) {
      const entry = [...byType.entries()].find(([t]) => t.toLowerCase() === filterType || t.toLowerCase().startsWith(filterType));
      const ids = entry?.[1] ?? [];
      if (ids.length === 0) return `No notes of type "${args.type}" found.`;
      const names = ids.map((id) => `**${nodes.get(id)?.name}**`).filter(Boolean).join(", ");
      return `**${ids.length}** ${args.type} note${ids.length !== 1 ? "s" : ""}: ${names}.`;
    }
    const lines = [...byType.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([t, ids]) => {
        const names = ids.map((id) => nodes.get(id)?.name).filter(Boolean);
        return `**${t}** (${ids.length}): ${names.join(", ")}`;
      });
    return `Notes by type:\n\n${lines.join("\n")}`;
  }

  // ── get_notes_by_tag ─────────────────────────────────────────────────────
  if (name === "get_notes_by_tag") {
    const tag = (args.tag || "").toLowerCase().trim();
    if (!tag) return null;
    const matches = nodeList.filter((n) => (n.tags || []).some((t) => t.toLowerCase() === tag));
    if (matches.length === 0) return `No notes are tagged "${args.tag}".`;
    const lines = matches.map((n) => `- **${n.name}** (${n.type})`).join("\n");
    return `**${matches.length}** note${matches.length !== 1 ? "s" : ""} tagged "${args.tag}":\n\n${lines}`;
  }

  // ── get_tags ───────────────────────────────────────────────────────────────
  if (name === "get_tags") {
    const tagCount = new Map();
    for (const n of nodeList) for (const t of (n.tags || [])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (tagCount.size === 0) return "No tags found across your notes.";
    const lines = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `- **${t}** (${c} note${c !== 1 ? "s" : ""})`);
    return `All tags in this workspace:\n\n${lines.join("\n")}`;
  }

  // ── get_sparse_notes ──────────────────────────────────────────────────────
  if (name === "get_sparse_notes") {
    const threshold = args.threshold ?? 60;
    const sparse = nodeList
      .filter((n) => n.wordCount < threshold)
      .sort((a, b) => a.wordCount - b.wordCount)
      .slice(0, 10);
    if (sparse.length === 0) return `All notes appear to have substantial content (${threshold}+ words each).`;
    const lines = sparse.map((n) => `- **${n.name}** (${n.type}) — ${n.wordCount} words`);
    return `Notes with sparse content (under ${threshold} words):\n\n${lines.join("\n")}\n\nThese may be worth expanding.`;
  }

  return null;
}

/**
 * Build a compact workspace stats block to inject into the system prompt
 * so GPT can answer incidental meta questions during RAG conversations.
 */
function buildMetaContext(meta) {
  if (!meta) return "";
  const { nodes, totalNotes, byType } = meta;
  const nodeList = [...nodes.values()];
  const typeSummary = [...byType.entries()].map(([t, ids]) => `${ids.length} ${t}s`).join(", ");
  const sorted = nodeList.slice().sort((a, b) => b.wordCount - a.wordCount);
  const top3 = sorted.slice(0, 3).map((n) => `${n.name} (${n.wordCount}w)`).join(", ");
  const sparse = nodeList.filter((n) => n.wordCount < 60).map((n) => n.name);
  const allNames = nodeList.map((n) => n.name).join(", ");
  return `\n\n---\n## Workspace Statistics (auto-generated, use for meta questions)\n` +
    `Total notes: ${totalNotes} (${typeSummary})\n` +
    `All note names: ${allNames}\n` +
    `Longest notes: ${top3}\n` +
    (sparse.length ? `Notes with sparse content (<60 words): ${sparse.join(", ")}\n` : "") +
    `---`;
}

const TOP_K = 8;             // retrieve top-K chunks
const MIN_SCORE = 0.2;       // discard chunks below this cosine similarity
const RELEVANCE_GATE = 0.3;  // if best chunk is below this, skip GPT and reply inline
const MAX_CITATIONS = 5;     // unique nodes to cite (model-declared)
const MAX_HISTORY = 10;      // max prior messages to include (pairs)

// ---------------------------------------------------------------------------
// Retrieve relevant chunks via cosine similarity
// ---------------------------------------------------------------------------

async function retrieve(cache, queryText) {
  if (!cache || cache.chunks.length === 0) return [];

  // Embed the query
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: queryText,
  });
  const queryVec = res.data[0].embedding;

  // Score all chunks
  const scored = cache.chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryVec, chunk.embedding),
  }));

  // Sort descending, filter by threshold, take top K
  scored.sort((a, b) => b.score - a.score);
  const passing = scored.filter((c) => c.score >= MIN_SCORE);
  // Always include at least 3 chunks even if below threshold (for short/vague queries)
  return (passing.length >= 3 ? passing : scored).slice(0, TOP_K);
}

// ---------------------------------------------------------------------------
// Build citation list from model-declared node IDs
// ---------------------------------------------------------------------------

/**
 * Parse the CITED: line from the end of the model's response.
 * Returns { cleanContent: string, citedIds: string[] }
 */
function parseCitedLine(content) {
  const lines = content.trimEnd().split("\n");
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine.startsWith("CITED:")) {
    return { cleanContent: content, citedIds: [] };
  }
  const raw = lastLine.slice(6).trim();
  const citedIds = raw === "none" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
  // Strip the CITED line (and any preceding blank line) from displayed content
  let clean = lines.slice(0, -1).join("\n");
  if (clean.endsWith("\n")) clean = clean.slice(0, -1);
  return { cleanContent: clean.trimEnd(), citedIds };
}

/**
 * Build citation objects from model-declared IDs, cross-referenced with retrieved chunks.
 */
function buildCitations(chunks, citedIds) {
  if (!citedIds || citedIds.length === 0) return [];
  // Build a lookup from nodeId → chunk metadata
  const byNodeId = new Map();
  for (const chunk of chunks) {
    if (!byNodeId.has(chunk.nodeId)) byNodeId.set(chunk.nodeId, chunk);
  }
  const citations = [];
  for (const id of citedIds.slice(0, MAX_CITATIONS)) {
    const chunk = byNodeId.get(id);
    if (!chunk) continue; // model hallucinated an ID — skip
    citations.push({
      nodeId: chunk.nodeId,
      nodeName: chunk.nodeName,
      nodeType: chunk.nodeType,
      excerpt: chunk.excerpt,
      tags: chunk.tags || [],
    });
  }
  return citations;
}

// ---------------------------------------------------------------------------
// Build context block from retrieved chunks
// ---------------------------------------------------------------------------

function buildContext(chunks) {
  // Group by nodeId so the same node's chunks appear together
  const byNode = new Map();
  for (const chunk of chunks) {
    if (!byNode.has(chunk.nodeId)) byNode.set(chunk.nodeId, []);
    byNode.get(chunk.nodeId).push(chunk);
  }

  const sections = [];
  for (const [, nodeChunks] of byNode) {
    const first = nodeChunks[0];
    const texts = nodeChunks.map((c) => c.text).join("\n");
    // Include the node ID in the heading so the model can reference it in CITED:
    sections.push(`### ${first.nodeName} [id: ${first.nodeId}] (${first.nodeType})\n${texts}`);
  }
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { workspace, messages, graphNodeIds, graphPathHint, mode } = req.body || {};

  // Validate workspace
  if (!workspace || typeof workspace !== "string" || !/^[a-z0-9_-]+$/i.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  // Validate graphNodeIds if provided (array of safe id strings)
  const pinnedNodeIds = Array.isArray(graphNodeIds)
    ? graphNodeIds.filter((id) => typeof id === "string" && /^[a-z0-9_-]+$/i.test(id)).slice(0, 20)
    : [];
  const hasPinnedNodes = pinnedNodeIds.length > 0;

  // Validate messages array
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  // Validate the most recent user message
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return res.status(400).json({ error: "Last message must be from user" });
  }

  const validation = validateTextField(lastMessage.content, "message", 2000);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const userQuery = validation.value;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if present

  try {
    // Load or build embedding cache
    let cache;
    try {
      cache = await getEmbeddingCache(workspace);
    } catch (embedErr) {
      console.error("[workspace-chat] embed cache error:", embedErr);
      sseEvent(res, { type: "error", message: "Failed to load knowledge base. Try rebuilding the index." });
      res.end();
      return;
    }

    const meta = computeWorkspaceMeta(cache);

    // ── Contradiction check mode ────────────────────────────────────────────
    if (mode === "contradiction") {
      // Gather first chunk per node for broad coverage (no similarity filter needed)
      const seenNodes = new Set();
      const broadChunks = [];
      for (const chunk of (cache?.chunks ?? [])) {
        if (!seenNodes.has(chunk.nodeId)) {
          seenNodes.add(chunk.nodeId);
          broadChunks.push(chunk);
        }
        if (broadChunks.length >= 30) break;
      }
      if (broadChunks.length === 0) {
        sseEvent(res, { type: "token", content: "No notes found in the knowledge base. Build the index first." });
        sseEvent(res, { type: "citations", sources: [] });
        sseEvent(res, { type: "done" });
        res.end();
        return;
      }
      const context = buildContext(broadChunks);
      const systemContent = `${CONTRADICTION_PROMPT}\n\n---\n## Story Notes\n\n${context}\n---`;
      const contradictionStream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userQuery },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 2048,
      });
      let accContent = "";
      for await (const chk of contradictionStream) {
        const delta = chk.choices[0]?.delta?.content;
        if (delta) { accContent += delta; sseEvent(res, { type: "token", content: delta }); }
      }
      const { cleanContent, citedIds } = parseCitedLine(accContent);
      const citations = buildCitations(broadChunks, citedIds);
      if (cleanContent !== accContent) sseEvent(res, { type: "correction", content: cleanContent });
      sseEvent(res, { type: "citations", sources: citations });
      sseEvent(res, { type: "done" });
      res.end();
      return;
    }

    // ── Summarize mode ──────────────────────────────────────────────────────
    if (mode === "summarize") {
      let summaryChunks;
      if (hasPinnedNodes) {
        const pinnedSet = new Set(pinnedNodeIds);
        summaryChunks = (cache?.chunks ?? []).filter((c) => pinnedSet.has(c.nodeId));
      } else {
        summaryChunks = await retrieve(cache, userQuery);
      }
      if (!summaryChunks?.length) {
        sseEvent(res, { type: "token", content: "I couldn't find any notes to summarize. Try rebuilding the index first." });
        sseEvent(res, { type: "citations", sources: [] });
        sseEvent(res, { type: "done" });
        res.end();
        return;
      }
      const sumContext = buildContext(summaryChunks);
      const sumSystemContent = `${SUMMARIZE_PROMPT}\n\n---\n## Story Notes\n\n${sumContext}\n---`;
      const sumStream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: sumSystemContent },
          { role: "user", content: userQuery },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 512,
      });
      let accContent = "";
      for await (const chk of sumStream) {
        const delta = chk.choices[0]?.delta?.content;
        if (delta) { accContent += delta; sseEvent(res, { type: "token", content: delta }); }
      }
      const { cleanContent, citedIds } = parseCitedLine(accContent);
      const citations = buildCitations(summaryChunks, citedIds);
      if (cleanContent !== accContent) sseEvent(res, { type: "correction", content: cleanContent });
      sseEvent(res, { type: "citations", sources: citations });
      sseEvent(res, { type: "done" });
      res.end();
      return;
    }

    // ── Pure metadata query intercept (no GPT needed) ─────────────────────
    // IMPORTANT: skip this fast-path when the user came from a graph/path action.
    // Those questions often name several nodes ("Trace the connection from A to B
    // through C and D"), which the metadata classifier can misread as a
    // get_notes_mentioning query and incorrectly answer with "No notes mention…"
    // before the pinned graph context is ever used.
    if (!hasPinnedNodes && !graphPathHint) {
      const metaAnswer = await resolveMetaQuery(userQuery, meta);
      if (metaAnswer) {
        sseEvent(res, { type: "token", content: metaAnswer });
        sseEvent(res, { type: "citations", sources: [] });
        sseEvent(res, { type: "done" });
        res.end();
        return;
      }
    }

    // Retrieve relevant chunks
    let chunks = await retrieve(cache, userQuery);

    // If the user is following up on a graph query, force-include all chunks
    // for the pinned node IDs (path/neighbor nodes the graph identified)
    if (hasPinnedNodes) {
      const pinnedSet = new Set(pinnedNodeIds);
      const forcedChunks = cache.chunks
        .filter((c) => pinnedSet.has(c.nodeId))
        .map((c) => ({ ...c, score: c.score ?? 1 }));
      // Merge: forced chunks first, then any additional retrieved chunks not already covered
      const forcedKeys = new Set(forcedChunks.map((c) => `${c.nodeId}:${c.chunkIndex}`));
      const extra = chunks.filter((c) => !forcedKeys.has(`${c.nodeId}:${c.chunkIndex}`));
      chunks = [...forcedChunks, ...extra];
    }

    // Pre-flight relevance gate: skip when we have pinned graph nodes
    // (those are already known-relevant from the graph result)
    // short-circuit without calling GPT so it can't fall back on training data
    const bestScore = chunks.length > 0 ? (chunks[0].score ?? 1) : 0;
    if (!hasPinnedNodes && bestScore < RELEVANCE_GATE) {
      sseEvent(res, { type: "token", content: "I couldn't find any information about that in your notes. Try asking something related to the characters, locations, or events in your story." });
      sseEvent(res, { type: "citations", sources: [] });
      sseEvent(res, { type: "done" });
      res.end();
      return;
    }

    const context = buildContext(chunks);

    // Build message history (trim to MAX_HISTORY pairs to control tokens)
    const history = messages.slice(-(MAX_HISTORY * 2 + 1), -1); // all but the last user message
    const filteredHistory = history.filter((m) => m.role === "user" || m.role === "assistant");

    const graphContextNote = hasPinnedNodes
      ? `\n\nThe user has been exploring graph connections between story elements. ${graphPathHint ? `The graph shows a path: ${graphPathHint}.` : ""} The notes below include the nodes involved in that connection. Explain how these elements relate to each other based on the notes.`
      : "";

    const metaBlock = buildMetaContext(meta);
    const systemContent = context
      ? `${SYSTEM_PROMPT}${metaBlock}${graphContextNote}\n\n---\n## Relevant Story Notes\n\n${context}\n---`
      : `${SYSTEM_PROMPT}${metaBlock}`;

    const apiMessages = [
      { role: "system", content: systemContent },
      ...filteredHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userQuery },
    ];

    // Stream GPT-4o response — accumulate full content to parse CITED: at the end
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: apiMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    });

    let accContent = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accContent += delta;
        sseEvent(res, { type: "token", content: delta });
      }
    }

    // Parse the CITED: line declared by the model, build selective citations
    const { cleanContent, citedIds } = parseCitedLine(accContent);
    const citations = buildCitations(chunks, citedIds);

    // If the model added a CITED: line, send a correction event so the frontend
    // can strip it from the displayed message
    if (cleanContent !== accContent) {
      sseEvent(res, { type: "correction", content: cleanContent });
    }

    // Send citations as final event
    sseEvent(res, { type: "citations", sources: citations });
    sseEvent(res, { type: "done" });
    res.end();
  } catch (err) {
    console.error("[workspace-chat] error:", err);
    // Try to send an error event if headers were already sent
    try {
      sseEvent(res, { type: "error", message: "An error occurred while generating the response." });
      res.end();
    } catch {
      res.end();
    }
  }
}

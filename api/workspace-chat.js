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

  const { workspace, messages, rebuildIndex } = req.body || {};

  // Validate workspace
  if (!workspace || typeof workspace !== "string" || !/^[a-z0-9_-]+$/i.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

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

    // Retrieve relevant chunks
    const chunks = await retrieve(cache, userQuery);

    // Pre-flight relevance gate: if the best chunk isn't relevant enough,
    // short-circuit without calling GPT so it can't fall back on training data
    const bestScore = chunks.length > 0 ? chunks[0].score : 0;
    if (bestScore < RELEVANCE_GATE) {
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

    const systemContent = context
      ? `${SYSTEM_PROMPT}\n\n---\n## Relevant Story Notes\n\n${context}\n---`
      : SYSTEM_PROMPT;

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

/**
 * editor-assist.js
 * In-editor AI writing assistant.
 * POST /api/editor-assist
 * Body: {
 *   action:    "rephrase" | "expand" | "shorten" | "continuity" | "custom"
 *   text:      string   — the selected passage
 *   context:   string   — surrounding text / full document (optional, truncated server-side)
 *   workspace: string   — workspace slug (for voice/style notes)
 *   custom:    string   — user-typed instruction when action === "custom"
 * }
 *
 * Streams SSE:
 *   data: {"type":"token","content":"..."}\n\n
 *   data: {"type":"done"}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 */

import OpenAI from "openai";
import { validateTextField } from "./guardrails.js";

const openai = new OpenAI();

// Max characters we'll send as context to keep token usage reasonable
const MAX_CONTEXT_CHARS = 6000;
const MAX_SELECTION_CHARS = 4000;

const ACTION_PROMPTS = {
  rephrase: `You are a fiction writing assistant. Rephrase the highlighted passage to improve clarity, flow, or prose quality — keeping the exact same meaning, events, and character voice. Output ONLY the rephrased text with no preamble, explanation, or surrounding quotes.`,

  expand: `You are a fiction writing assistant. Expand the highlighted passage with more sensory detail, interiority, or scene-setting. Stay true to the existing tone and character voice. Output ONLY the expanded text — do not add a heading, preamble, or explanation.`,

  shorten: `You are a fiction writing assistant. Condense the highlighted passage. Remove redundancy and tighten the prose while preserving all essential meaning and voice. Output ONLY the shortened text, no preamble.`,

  continuity: `You are a fiction writing assistant and continuity editor. Review the highlighted passage in the context of the surrounding document. Identify any continuity issues, contradictions, timeline problems, or inconsistencies between the passage and the surrounding context. Be specific — quote the conflicting details. If no issues are found, say so briefly. Output ONLY your analysis, no preamble.`,

  custom: `You are a fiction writing assistant embedded in a document editor. Follow the user's instruction exactly as applied to the highlighted passage. Output ONLY the result — no preamble, no explanation, no surrounding quotes unless the user explicitly asked for them.`,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, text, context = "", workspace, custom = "" } = req.body || {};

  // Validate action
  if (!ACTION_PROMPTS[action]) {
    return res.status(400).json({ error: "Invalid action" });
  }

  // Validate & sanitize inputs — validateTextField handles injection, length, control chars
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  const textResult = validateTextField(text, "text", MAX_SELECTION_CHARS);
  if (!textResult.ok) return res.status(400).json({ error: textResult.error });
  const cleanText = textResult.value;

  const contextResult = validateTextField(context, "context", MAX_CONTEXT_CHARS);
  // context is optional — ignore validation failure gracefully
  const cleanContext = contextResult.ok ? contextResult.value : "";

  const customResult = validateTextField(custom, "custom", 400);
  if (action === "custom" && !customResult.ok) return res.status(400).json({ error: customResult.error });
  const cleanCustom = customResult.ok ? customResult.value : "";

  // Build messages
  const systemPrompt = action === "custom"
    ? `${ACTION_PROMPTS.custom}\n\nUser instruction: ${cleanCustom}`
    : ACTION_PROMPTS[action];

  const userMessage = cleanContext
    ? `[Surrounding document context]\n${cleanContext}\n\n[Highlighted passage]\n${cleanText}`
    : `[Highlighted passage]\n${cleanText}`;

  // Stream SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: "token", content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message ?? "AI request failed" })}\n\n`);
    res.end();
  }
}

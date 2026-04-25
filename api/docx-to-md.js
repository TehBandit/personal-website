/**
 * docx-to-md.js
 * Converts an uploaded .docx file to formatted Markdown.
 * POST /api/docx-to-md
 *
 * Body: { base64: string, workspace: string }
 * Returns: { markdown: string }
 *
 * Images embedded in the docx are preserved as base64 data URIs
 * (![](data:image/png;base64,...)) so they display in the editor without
 * any server-side file management.
 */
import mammoth from "mammoth";
import { htmlToMarkdown, MAMMOTH_OPTIONS, prepareDocxBuffer } from "./_docx-md.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, workspace } = req.body ?? {};

  if (!base64 || typeof base64 !== "string") {
    return res.status(400).json({ error: "Missing document data" });
  }
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }
  if (base64.length > 20_000_000) {
    return res.status(413).json({ error: "Document too large" });
  }

  try {
    const buffer = Buffer.from(base64, "base64");
    const preparedBuffer = await prepareDocxBuffer(buffer);
    const result = await mammoth.convertToHtml({ buffer: preparedBuffer }, MAMMOTH_OPTIONS);
    const markdown = htmlToMarkdown(result.value);

    if (!markdown) {
      return res.status(400).json({ error: "No text content found in document" });
    }

    // Debug mode: pass ?debug=1 to also get the raw mammoth HTML
    if (req.query?.debug === "1") {
      return res.status(200).json({ markdown, _mammothHtml: result.value });
    }

    return res.status(200).json({ markdown });
  } catch (err) {
    console.error("docx-to-md error:", err);
    return res.status(500).json({ error: "Failed to convert document" });
  }
}

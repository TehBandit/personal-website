import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const dir = path.join(process.cwd(), "notes-raw");
  const { filename } = req.query;

  // Sanitise: only bare filenames, no path traversal, only .txt
  if (!filename || filename.includes("/") || filename.includes("\\") || !filename.endsWith(".txt")) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  const filePath = path.join(dir, filename);

  // ── GET: read file ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ filename, content });
  }

  // ── POST: create new file ───────────────────────────────────────────────────
  if (req.method === "POST") {
    if (fs.existsSync(filePath)) return res.status(409).json({ error: "File already exists" });
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, req.body?.content ?? "", "utf-8");
    return res.status(201).json({ filename });
  }

  // ── PUT: save existing file ─────────────────────────────────────────────────
  if (req.method === "PUT") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = req.body?.content ?? "";
    fs.writeFileSync(filePath, content, "utf-8");
    return res.status(200).json({ filename });
  }

  // ── DELETE: remove file ─────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    fs.unlinkSync(filePath);
    return res.status(200).json({ filename });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

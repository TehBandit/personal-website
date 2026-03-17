import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const dir = path.join(process.cwd(), "notes-raw");
  if (!fs.existsSync(dir)) return res.status(200).json({ files: [] });

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((filename) => {
      const stat = fs.statSync(path.join(dir, filename));
      return { filename, mtime: stat.mtimeMs };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ files });
}

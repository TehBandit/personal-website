import fs from "fs";
import path from "path";

export default function handler(req, res) {
  // Return the most recent modification time across all notes JSON files.
  // The frontend polls this; when the value changes it silently reloads the graph.
  const notesDir = path.join(process.cwd(), "notes");

  let latest = 0;
  if (fs.existsSync(notesDir)) {
    for (const f of fs.readdirSync(notesDir)) {
      if (!f.endsWith(".json")) continue;
      const mtime = fs.statSync(path.join(notesDir, f)).mtimeMs;
      if (mtime > latest) latest = mtime;
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ version: latest });
}

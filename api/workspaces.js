import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

// Only allow lowercase letters, numbers, and hyphens — prevents path traversal
function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug) && slug.length <= 80;
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // ── GET: list all workspaces ──────────────────────────────────────────────
  if (req.method === "GET") {
    if (!fs.existsSync(WORKSPACES_DIR)) {
      return res.status(200).json({ workspaces: [] });
    }

    const workspaces = fs
      .readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && validSlug(d.name))
      .map((d) => {
        const metaPath = path.join(WORKSPACES_DIR, d.name, "workspace.json");
        let name = d.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
          } catch { /* use derived name */ }
        }
        return { slug: d.name, name };
      });

    return res.status(200).json({ workspaces });
  }

  // ── POST: create a new workspace ─────────────────────────────────────────
  if (req.method === "POST") {
    const { name } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const trimmed = name.trim().substring(0, 80);
    // Derive slug: lowercase, replace spaces/underscores with hyphens, strip other chars
    const slug = trimmed
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!validSlug(slug)) {
      return res.status(400).json({ error: "Could not derive a valid slug from that name" });
    }

    const workspaceDir = path.join(WORKSPACES_DIR, slug);
    if (fs.existsSync(workspaceDir)) {
      return res.status(409).json({ error: "A workspace with that name already exists" });
    }

    fs.mkdirSync(path.join(workspaceDir, "notes"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "notes-raw"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({ name: trimmed, slug }, null, 2),
      "utf-8"
    );

    return res.status(201).json({ slug, name: trimmed });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

import fs from "fs";
import path from "path";

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

// Only allow lowercase letters, numbers, and hyphens — prevents path traversal
function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug) && slug.length <= 80;
}

const WORKSPACE_PRESETS = {
  narrative: {
    character: { color: "#60a5fa", label: "Character" },
    location:  { color: "#34d399", label: "Location"  },
    faction:   { color: "#fb923c", label: "Faction"   },
    artifact:  { color: "#c084fc", label: "Artifact"  },
  },
  notes: {
    topic:   { color: "#60a5fa", label: "Topic"   },
    source:  { color: "#34d399", label: "Source"  },
    person:  { color: "#fb923c", label: "Person"  },
    concept: { color: "#c084fc", label: "Concept" },
  },
  journaling: {
    entry:      { color: "#60a5fa", label: "Entry"      },
    person:     { color: "#34d399", label: "Person"     },
    place:      { color: "#fb923c", label: "Place"      },
    reflection: { color: "#c084fc", label: "Reflection" },
  },
  universal: {
    entity:   { color: "#60a5fa", label: "Entity"   },
    event:    { color: "#34d399", label: "Event"    },
    idea:     { color: "#fb923c", label: "Idea"     },
    document: { color: "#c084fc", label: "Document" },
  },
  custom: {
    entity:   { color: "#60a5fa", label: "Entity"   },
    event:    { color: "#34d399", label: "Event"    },
    idea:     { color: "#fb923c", label: "Idea"     },
    document: { color: "#c084fc", label: "Document" },
  },
};

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
        let nodeTypes = null;
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
            if (meta.nodeTypes && typeof meta.nodeTypes === "object") nodeTypes = meta.nodeTypes;
          } catch { /* use derived name */ }
        }
        return { slug: d.name, name, nodeTypes };
      });

    return res.status(200).json({ workspaces });
  }

  // ── POST: create a new workspace ─────────────────────────────────────────
  if (req.method === "POST") {
    const { name, preset = "narrative" } = req.body || {};
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
    const nodeTypes = WORKSPACE_PRESETS[preset] ?? WORKSPACE_PRESETS.narrative;
    fs.writeFileSync(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({ name: trimmed, slug, nodeTypes }, null, 2),
      "utf-8"
    );

    return res.status(201).json({ slug, name: trimmed, nodeTypes });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

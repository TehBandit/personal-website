import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // ── GET: list all workspaces ──────────────────────────────────────────────
  if (req.method === "GET") {
    const includeHidden = req.query?.includeHidden === "1";
    if (!fs.existsSync(WORKSPACES_DIR)) {
      return res.status(200).json({ workspaces: [] });
    }

    const dirs = fs
      .readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && validSlug(d.name));

    const workspaces = (await Promise.all(dirs.map(async (d) => {
      const metaPath = path.join(WORKSPACES_DIR, d.name, "workspace.json");
      let name = d.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      let nodeTypes = null;
      let hidden = false;
      try {
        const raw = await fs.promises.readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw);
        if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
        if (meta.nodeTypes && typeof meta.nodeTypes === "object") nodeTypes = meta.nodeTypes;
        hidden = meta.hidden === true;
      } catch { /* use derived name */ }
      return { slug: d.name, name, nodeTypes, hidden };
    })))
      .filter((ws) => includeHidden || !ws.hidden)
      .map((ws) => ({
        slug: ws.slug,
        name: ws.name,
        nodeTypes: ws.nodeTypes,
        ...(ws.hidden ? { hidden: true } : {}),
      }));

    return res.status(200).json({ workspaces });
  }

  // ── POST: create a new workspace ─────────────────────────────────────────
  if (req.method === "POST") {
    const { name, preset = "narrative", hidden = false, desiredSlug } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const trimmed = name.trim().substring(0, 80);
    // Derive slug: lowercase, replace spaces/underscores with hyphens, strip other chars
    const derivedSlug = trimmed
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const slug = typeof desiredSlug === "string" && desiredSlug.trim()
      ? desiredSlug.trim().toLowerCase()
      : derivedSlug;

    if (!validSlug(slug)) {
      return res.status(400).json({ error: "Could not derive a valid slug from that name" });
    }

    const workspaceDir = path.join(WORKSPACES_DIR, slug);
    if (fs.existsSync(workspaceDir)) {
      return res.status(409).json({ error: "A workspace with that name already exists" });
    }

    fs.mkdirSync(workspaceDir, { recursive: true });
    const nodeTypes = WORKSPACE_PRESETS[preset] ?? WORKSPACE_PRESETS.narrative;
    fs.writeFileSync(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({ name: trimmed, slug, nodeTypes, hidden: hidden === true }, null, 2),
      "utf-8"
    );

    return res.status(201).json({ slug, name: trimmed, nodeTypes });
  }

  // ── PATCH: add a new node type to a workspace's config ──────────────────
  if (req.method === "PATCH") {
    const { slug } = req.query || {};
    if (!slug || !validSlug(slug)) {
      return res.status(400).json({ error: "Invalid workspace slug" });
    }
    const workspaceDir = path.join(WORKSPACES_DIR, slug);
    if (!fs.existsSync(workspaceDir)) {
      return res.status(404).json({ error: "Workspace not found" });
    }
    const metaPath = path.join(workspaceDir, "workspace.json");
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch {
      return res.status(500).json({ error: "Could not read workspace config" });
    }
    const { addType } = req.body || {};
    if (!addType || typeof addType !== "object") {
      return res.status(400).json({ error: "addType is required" });
    }
    const { key, color, label } = addType;
    if (!key || typeof key !== "string" || !/^[a-z0-9_]+$/.test(key.trim()) || key.trim().length > 40) {
      return res.status(400).json({ error: "type key must be lowercase letters, digits or underscores" });
    }
    const trimmedKey = key.trim();
    // If nodeTypes was never written (legacy workspace), seed from the narrative
    // preset so existing nodes (character, location, faction, artifact) are not
    // silently discarded when the first custom type is added.
    if (!meta.nodeTypes) meta.nodeTypes = { ...WORKSPACE_PRESETS.narrative };
    if (meta.nodeTypes[trimmedKey]) {
      return res.status(409).json({ error: "Type already exists" });
    }
    const trimmedLabel = (typeof label === "string" && label.trim())
      ? label.trim().substring(0, 40)
      : trimmedKey.charAt(0).toUpperCase() + trimmedKey.slice(1);
    const safeColor = (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim()))
      ? color.trim()
      : "#94a3b8";
    meta.nodeTypes[trimmedKey] = { color: safeColor, label: trimmedLabel };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    return res.status(200).json({ nodeTypes: meta.nodeTypes });
  }

  // ── DELETE: remove a workspace entirely ──────────────────────────────────
  if (req.method === "DELETE") {
    const { slug } = req.query || {};
    if (!slug || !validSlug(slug)) {
      return res.status(400).json({ error: "Invalid workspace slug" });
    }

    const workspaceDir = path.join(WORKSPACES_DIR, slug);
    if (!fs.existsSync(workspaceDir)) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    fs.rmSync(workspaceDir, { recursive: true, force: true });
    return res.status(200).json({ deleted: slug });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const META_CACHE_TTL_MS = 5000;
const timelineMetaCache = new Map(); // workspace -> { versionToken, expiresAt, sortedMeta }

function extractDateFromJournalFilename(filename) {
  const match = String(filename || "").match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function buildJournalEntryTitle(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return "Journal Entry";
  const [year, month, day] = String(dateKey).split("-").map((part) => Number.parseInt(part, 10));
  const dt = new Date(year, month - 1, day);
  return `Journal Entry - ${dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

function buildPreview(content) {
  const text = String(content || "")
    .replace(/^#\s+.*$/m, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return "No text";
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

function resolveNodeTitleMap(wsDir) {
  const map = new Map();
  const cachePath = path.join(wsDir, "graph-cache.json");
  if (!fs.existsSync(cachePath)) return map;

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    for (const node of (cached?.nodes || [])) {
      if (!node?.id || !node?.name) continue;
      map.set(String(node.id), String(node.name));
    }
  } catch {
    return map;
  }

  return map;
}

function compareJournalEntriesMeta(a, b) {
  return b.date.localeCompare(a.date) || b.mtime - a.mtime || String(a.filename).localeCompare(String(b.filename));
}

async function readWorkspaceVersionToken(wsDir) {
  const versionFile = path.join(wsDir, "notes-version.json");
  try {
    const raw = await fs.promises.readFile(versionFile, "utf-8");
    const parsed = JSON.parse(raw);
    return String(parsed?.version ?? "").trim() || null;
  } catch {
    return null;
  }
}

async function buildSortedJournalMeta(journalDir, nodeTitleById) {
  const dirents = await fs.promises.readdir(journalDir, { withFileTypes: true });

  const entryFiles = dirents
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => /\.(md|txt)$/i.test(name))
    .filter((name) => Boolean(extractDateFromJournalFilename(name)));

  const metaEntries = await Promise.all(
    entryFiles.map(async (name) => {
      const absPath = path.join(journalDir, name);
      const filename = `journal/${name}`;
      const date = extractDateFromJournalFilename(name);
      const nodeId = name
        .replace(/\.(md|txt)$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      try {
        const stat = await fs.promises.stat(absPath);
        return {
          absPath,
          filename,
          date,
          title: nodeTitleById.get(nodeId) || buildJournalEntryTitle(date),
          mtime: Number(stat?.mtimeMs || 0),
        };
      } catch {
        return null;
      }
    })
  );

  return metaEntries.filter(Boolean).sort(compareJournalEntriesMeta);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const workspace = req.query.workspace;
  const dateFilter = String(req.query.date || "").trim();
  const offset = Math.max(0, Number.parseInt(String(req.query.offset || "0"), 10) || 0);
  const requestedLimit = Number.parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, requestedLimit));
  if (!workspace || !/^[a-z0-9-]+$/.test(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  const wsDir = path.join(WORKSPACES_DIR, workspace);
  const journalDir = path.join(wsDir, "journal");

  if (!fs.existsSync(journalDir)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ entries: [] });
  }

  const nodeTitleById = resolveNodeTitleMap(wsDir);

  const versionToken = await readWorkspaceVersionToken(wsDir);
  const cached = timelineMetaCache.get(workspace);
  const canUseCached = Boolean(
    cached
    && (
      (versionToken && cached.versionToken === versionToken)
      || (!versionToken && cached.expiresAt > Date.now())
    )
  );

  let sortedMeta;
  if (canUseCached) {
    sortedMeta = cached.sortedMeta;
  } else {
    try {
      sortedMeta = await buildSortedJournalMeta(journalDir, nodeTitleById);
    } catch {
      return res.status(500).json({ error: "Unable to read journal directory" });
    }
    timelineMetaCache.set(workspace, {
      versionToken,
      expiresAt: Date.now() + META_CACHE_TTL_MS,
      sortedMeta,
    });
  }

  const filteredMeta = dateFilter
    ? sortedMeta.filter((entry) => entry.date === dateFilter)
    : sortedMeta;

  const pageMeta = filteredMeta.slice(offset, offset + limit);
  const nextOffset = offset + pageMeta.length;
  const hasMore = nextOffset < filteredMeta.length;

  // Second pass: read content only for the requested page.
  const sliced = await Promise.all(
    pageMeta.map(async (entry) => {
      try {
        const content = await fs.promises.readFile(entry.absPath, "utf-8");
        return {
          filename: entry.filename,
          date: entry.date,
          title: entry.title,
          preview: buildPreview(content),
          mtime: entry.mtime,
        };
      } catch {
        return null;
      }
    })
  );

  const entries = sliced.filter(Boolean);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    entries,
    page: { offset, limit, hasMore, nextOffset, total: filteredMeta.length },
  });
}

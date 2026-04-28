import fs from "fs";
import path from "path";
import { WORKSPACES_DIR } from "./_storygraph-paths.js";
import { ensureWorkspaceSummary } from "./_workspace-summary.js";

const JOURNAL_WORKSPACE_SLUG = "journal-hidden-workspace";
const JOURNAL_FILE_PATH = "journal/journal.md";

function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug) && slug.length <= 80;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeStreak(timestamps) {
  const daysSet = new Set(timestamps.map(startOfDay));
  if (!daysSet.size) return { current: 0, longest: 0 };
  const sorted = [...daysSet].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 86400000 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const today = startOfDay(Date.now());
  let cur = 0;
  let check = daysSet.has(today) ? today : today - 86400000;
  while (daysSet.has(check)) {
    cur++;
    check -= 86400000;
  }
  return { current: cur, longest };
}

function readWorkspaceList() {
  if (!fs.existsSync(WORKSPACES_DIR)) return [];
  return fs
    .readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && validSlug(d.name))
    .map((d) => {
      const metaPath = path.join(WORKSPACES_DIR, d.name, "workspace.json");
      let name = d.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      let hidden = false;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
          hidden = meta.hidden === true;
        } catch {
          // Keep derived defaults.
        }
      }
      return { slug: d.name, name, hidden };
    })
    .filter((w) => !w.hidden)
    .map(({ slug, name }) => ({ slug, name }));
}

async function buildJournalEntryMap() {
  const wsDir = path.join(WORKSPACES_DIR, JOURNAL_WORKSPACE_SLUG);
  const journalDir = path.join(wsDir, "journal");
  if (!fs.existsSync(journalDir)) return {};

  let names;
  try {
    names = await fs.promises.readdir(journalDir);
  } catch {
    return {};
  }

  const map = {};
  for (const name of names) {
    const filename = `journal/${name}`;
    if (!/\.(md|txt)$/i.test(name)) continue;
    if (filename === JOURNAL_FILE_PATH) continue;
    const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const [year, month, day] = m[1].split("-").map((part) => Number.parseInt(part, 10));
    const ts = startOfDay(new Date(year, month - 1, day).getTime());
    map[ts] = 1;
  }

  return map;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    res.setHeader("Cache-Control", "public, max-age=10, s-maxage=30, stale-while-revalidate=120");

    const workspaces = readWorkspaceList();
    const summaries = workspaces
      .map((ws) => ensureWorkspaceSummary(ws.slug))
      .filter(Boolean);

    const allActivityDays = new Set();
    for (const summary of summaries) {
      for (const day of Object.keys(summary?.stats?.activityDayMap || {})) {
        allActivityDays.add(Number(day));
      }
    }

    const totalNodes = summaries.reduce((sum, d) => sum + Number(d?.stats?.nodeCount || 0), 0);
    const totalLinks = summaries.reduce((sum, d) => sum + Number(d?.stats?.linkCount || 0), 0);
    const totalFiles = summaries.reduce((sum, d) => sum + Number(d?.stats?.fileCount || 0), 0);
    const streak = computeStreak([...allActivityDays]);
    const weekly = {
      nodesAdded: summaries.reduce((sum, d) => sum + Number(d?.stats?.nodesThisWeek || 0), 0),
      edits: summaries.reduce((sum, d) => sum + Number(d?.stats?.editsThisWeek || 0), 0),
      filesModified: summaries.reduce((sum, d) => sum + Number(d?.stats?.filesThisWeek || 0), 0),
    };

    const createdAtMap = {};
    for (const summary of summaries) {
      const map = summary?.stats?.createdAtMap || {};
      for (const [day, count] of Object.entries(map)) {
        createdAtMap[day] = (createdAtMap[day] || 0) + Number(count || 0);
      }
    }

    const journalEntryMap = await buildJournalEntryMap();

    const docs = summaries
      .flatMap((summary) =>
        (summary?.recentDocs || []).map((doc) => ({
          wsSlug: summary.workspace.slug,
          wsName: summary.workspace.name,
          filename: doc.filename,
          title: doc.title || "",
          mtime: doc.mtime,
          preview: doc.preview || "",
        }))
      )
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 12);

    const stats = { totalNodes, totalLinks, totalFiles, streak, weekly, createdAtMap, journalEntryMap };

    return res.status(200).json({ workspaces, docs, stats });
  } catch {
    return res.status(500).json({ error: "Unable to load Story Graph home data" });
  }
}

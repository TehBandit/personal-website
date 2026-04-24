import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Network, FileText, Clock, Flame, Link2, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import Header from "../components/Header.jsx";

const BG        = "#0f0f1a";
const CARD_BG   = "#161624";
const BORDER    = "rgba(255,255,255,0.08)";
const MUTED     = "rgba(255,255,255,0.35)";
const TEXT      = "rgba(255,255,255,0.88)";
const PREVIEW_LIMIT = 300;
const CACHE_TTL     = 60_000; // 60 s

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeStreak(timestamps) {
  const daysSet = new Set(timestamps.map(startOfDay));
  if (!daysSet.size) return { current: 0, longest: 0 };
  const sorted = [...daysSet].sort((a, b) => a - b);
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 86400000 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const today = startOfDay(Date.now());
  let cur = 0, check = daysSet.has(today) ? today : today - 86400000;
  while (daysSet.has(check)) { cur++; check -= 86400000; }
  return { current: cur, longest };
}

const HEAT_LEVELS = [
  "rgba(255,255,255,0.06)",
  "rgba(96,165,250,0.28)",
  "rgba(96,165,250,0.55)",
  "rgba(96,165,250,0.78)",
  "#60a5fa",
];
function heatColor(count) {
  if (!count) return HEAT_LEVELS[0];
  if (count === 1) return HEAT_LEVELS[1];
  if (count <= 3) return HEAT_LEVELS[2];
  if (count <= 6) return HEAT_LEVELS[3];
  return HEAT_LEVELS[4];
}

// Module-level cache — survives SPA navigation, cleared on demand
const _cache = { data: null, fetchedAt: 0 };
export function invalidateHomeCache() { _cache.fetchedAt = 0; }

async function fetchHomeData() {
  const wsRes  = await fetch("/api/workspaces");
  const wsJson = await wsRes.json();
  const workspaces = wsJson.workspaces || [];

  // For each workspace fetch the file list (mtimes) and graph cache (previews) in
  // parallel — two requests per workspace instead of N+1 file-content fetches.
  const wsData = await Promise.all(
    workspaces.map(async (ws) => {
      const [files, graphJson] = await Promise.all([
        fetch(`/api/notes-raw-list?workspace=${encodeURIComponent(ws.slug)}`)
          .then((r) => r.json())
          .then((d) => d.files || [])
          .catch(() => []),
        fetch(`/api/story-notes?workspace=${encodeURIComponent(ws.slug)}&summary=1`)
          .then((r) => r.ok ? r.json() : { nodes: [] })
          .catch(() => ({ nodes: [] })),
      ]);

      // Build filename → filePreview map from the graph cache.
      // Only nodes that own a dedicated raw file carry filePreview; others are skipped.
      const previewMap = new Map();
      const activityTimestamps = [];
      const wsCreatedTimestamps = [];
      let wsNodeCount = 0;
      let wsLinkCount = (graphJson.links || []).length;
      let wsNodesThisWeek = 0;
      let wsEditsThisWeek = 0;
      const weekAgo = Date.now() - 7 * 86400000;
      for (const node of (graphJson.nodes || [])) {
        wsNodeCount++;
        const ts = Math.max(node.createdAt || 0, node.updatedAt || 0);
        if (ts) activityTimestamps.push(ts);
        if (node.createdAt) wsCreatedTimestamps.push(node.createdAt);
        if (node.createdAt && node.createdAt >= weekAgo) wsNodesThisWeek++;
        else if (node.updatedAt && node.updatedAt >= weekAgo) wsEditsThisWeek++;
        if (node.filePreview === undefined) continue;
        if (node.sourceFile && !previewMap.has(node.sourceFile))
          previewMap.set(node.sourceFile, node.filePreview);
        for (const sf of (node.additionalSourceFiles || []))
          if (!previewMap.has(sf)) previewMap.set(sf, node.filePreview);
      }

      const wsFilesThisWeek = files.filter((f) => f.mtime >= weekAgo).length;
      return { ws, files, previewMap, activityTimestamps, wsCreatedTimestamps, wsNodeCount, wsLinkCount, wsNodesThisWeek, wsEditsThisWeek, wsFilesThisWeek };
    })
  );

  // Aggregate stats across all workspaces
  const allTimestamps = wsData.flatMap((d) => d.activityTimestamps);
  const totalNodes = wsData.reduce((s, d) => s + d.wsNodeCount, 0);
  const totalLinks = wsData.reduce((s, d) => s + d.wsLinkCount, 0);
  const totalFiles = wsData.reduce((s, d) => s + d.files.length, 0);
  const streak = computeStreak(allTimestamps);
  const weeklyNodesAdded = wsData.reduce((s, d) => s + d.wsNodesThisWeek, 0);
  const weeklyEdits = wsData.reduce((s, d) => s + d.wsEditsThisWeek, 0);
  const weeklyFilesModified = wsData.reduce((s, d) => s + d.wsFilesThisWeek, 0);
  const weekly = { nodesAdded: weeklyNodesAdded, edits: weeklyEdits, filesModified: weeklyFilesModified };

  // Build createdAt day map across all workspaces (plain object for serialisability)
  const createdAtMap = {};
  for (const ts of wsData.flatMap((d) => d.wsCreatedTimestamps)) {
    const day = startOfDay(ts);
    createdAtMap[day] = (createdAtMap[day] || 0) + 1;
  }

  const stats = { totalNodes, totalLinks, totalFiles, streak, weekly, createdAtMap };

  // Flatten, sort by mtime, take top 12
  const top = wsData
    .flatMap(({ ws, files, previewMap }) =>
      files.map((f) => ({ wsSlug: ws.slug, wsName: ws.name, ...f, previewMap }))
    )
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 12);

  // Resolve previews from cache — no per-doc network requests
  const docs = top.map(({ wsSlug, wsName, filename, mtime, previewMap }) => {
    const raw = previewMap.get(filename);
    const preview = raw !== undefined
      ? (raw.length > PREVIEW_LIMIT ? raw.slice(0, PREVIEW_LIMIT).trimEnd() + "…" : raw)
      : "";
    return { wsSlug, wsName, filename, mtime, preview };
  });

  return { workspaces, docs, stats };
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function stripExt(name) {
  return name.replace(/\.(md|txt)$/, "");
}

function basename(p) {
  return p.split("/").pop();
}

/** workspace/folder/sub — no spaces, no trailing slash */
function pathLabel(wsName, filename) {
  const dir = filename.includes("/") ? filename.split("/").slice(0, -1).join("/") : null;
  return dir ? `${wsName}/${dir}` : wsName;
}

// ── Compact calendar heatmap (inline with stats strip) ────────────────────
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW_SHORT  = ["S","M","T","W","T","F","S"];
const CELL = 20; // px per day cell
const CELL_GAP = 3;

function CalendarHeatmap({ createdAtMap }) {
  const today   = new Date();
  const curYear = today.getFullYear();
  const [month, setMonth] = useState(today.getMonth());
  const [hover, setHover] = useState(null);

  const todayTs   = startOfDay(today.getTime());
  const firstDow  = new Date(curYear, month, 1).getDay();
  const totalDays = new Date(curYear, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    const ts       = startOfDay(new Date(curYear, month, d).getTime());
    const isFuture = ts > todayTs;
    const count    = isFuture ? 0 : (createdAtMap?.[ts] || 0);
    cells.push({ day: d, ts, count, isFuture });
  }

  const gridWidth = 7 * CELL + 6 * CELL_GAP;

  return (
    <div
      style={{
        backgroundColor: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "12px 14px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: gridWidth }}>
        <button
          onClick={() => setMonth((m) => (m === 0 ? 11 : m - 1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: "0 2px", display: "flex", alignItems: "center" }}
        ><ChevronLeft size={13} /></button>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT, textAlign: "center", flex: 1, letterSpacing: "0.02em" }}>
          {MONTH_FULL[month]} {curYear}
        </span>
        <button
          onClick={() => setMonth((m) => (m === 11 ? 0 : m + 1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: "0 2px", display: "flex", alignItems: "center" }}
        ><ChevronRight size={13} /></button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: CELL_GAP }}>
        {DOW_SHORT.map((d, i) => (
          <div key={i} style={{ width: CELL, textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.22)", userSelect: "none", fontWeight: 600 }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: CELL_GAP }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} style={{ width: CELL, height: CELL }} />;
          const isToday   = cell.ts === todayTs;
          const dateLabel = new Date(curYear, month, cell.day).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
          return (
            <div
              key={cell.ts}
              style={{
                width: CELL, height: CELL, borderRadius: 3,
                backgroundColor: cell.isFuture ? "rgba(255,255,255,0.03)" : heatColor(cell.count),
                border: isToday ? "1px solid rgba(96,165,250,0.7)" : "1px solid transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9,
                fontWeight: isToday ? 700 : 400,
                color: cell.isFuture
                  ? "rgba(255,255,255,0.12)"
                  : cell.count > 2
                  ? "rgba(255,255,255,0.9)"
                  : "rgba(255,255,255,0.38)",
                userSelect: "none",
                cursor: "default",
              }}
              onMouseEnter={(e) => {
                if (cell.isFuture) return;
                setHover({
                  label: cell.count
                    ? `${cell.count} node${cell.count !== 1 ? "s" : ""} added on ${dateLabel}`
                    : `No nodes on ${dateLabel}`,
                  x: e.clientX, y: e.clientY,
                });
              }}
              onMouseLeave={() => setHover(null)}
            >
              {cell.day}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div style={{ position: "fixed", left: hover.x + 12, top: hover.y - 36, backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#fff", pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap" }}>
          {hover.label}
        </div>
      )}
    </div>
  );
}

export default function StoryGraphHome() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState(_cache.data?.workspaces ?? []);
  const [recentDocs, setRecentDocs] = useState(_cache.data?.docs ?? []);
  const [stats, setStats] = useState(_cache.data?.stats ?? null);
  const [loadingDocs, setLoadingDocs] = useState(!_cache.data);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const age = Date.now() - _cache.fetchedAt;
    // Re-fetch if stale OR if cache is missing createdAtMap (old format)
    if (_cache.data && age < CACHE_TTL && _cache.data.stats?.createdAtMap) return;

    setLoadingDocs(true);
    fetchHomeData()
      .then(({ workspaces, docs, stats }) => {
        if (!mounted.current) return;
        _cache.data = { workspaces, docs, stats };
        _cache.fetchedAt = Date.now();
        setWorkspaces(workspaces);
        setRecentDocs(docs);
        setStats(stats);
        setLoadingDocs(false);
      })
      .catch(() => { if (mounted.current) setLoadingDocs(false); });

    return () => { mounted.current = false; };
  }, []);

  const openWorkspace = (slug) => navigate(`/storygraph/graph?workspace=${encodeURIComponent(slug)}`);
  const openDoc = (wsSlug, filename) => navigate(
    `/storygraph/graph?workspace=${encodeURIComponent(wsSlug)}&file=${encodeURIComponent(filename)}`
  );

  return (
    <div className="dark-scroll min-h-screen flex flex-col" style={{ backgroundColor: BG, color: TEXT }}>
      <Header />

        <div className="flex-1 w-full px-16 py-10">
        {/* Branding */}
        <div className="flex items-center gap-3 mb-10">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{ width: 40, height: 40, backgroundColor: "rgba(96,165,250,0.15)" }}
          >
            <Network size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Story Graph</h1>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              Select a workspace or pick up where you left off
            </p>
          </div>
        </div>

        {/* Stats strip + inline calendar */}
        {stats && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 40 }}>
            {/* Left: 2×2 stat grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flexShrink: 0 }}>
              {/* Streak */}
              <div
                style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}
              >
                <Flame size={18} style={{ color: stats.streak.current > 0 ? "#fb923c" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: stats.streak.current > 0 ? "#fb923c" : "rgba(255,255,255,0.25)" }}>
                    {stats.streak.current > 0 ? `${stats.streak.current}d` : "—"}
                  </p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Writing streak</p>
                  {stats.streak.longest > 0 && (
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.18)" }}>Best: {stats.streak.longest}d</p>
                  )}
                  {/* Current-week activity dots: S M T W T F S */}
                  {(() => {
                    const DOW = ["S","M","T","W","T","F","S"];
                    const now = new Date();
                    const todayDow = now.getDay(); // 0=Sun
                    const todayTs2 = startOfDay(now.getTime());
                    return (
                      <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "flex-end" }}>
                        {DOW.map((label, i) => {
                          const offsetDays = i - todayDow;
                          const dayTs = todayTs2 + offsetDays * 86400000;
                          const isFuture = offsetDays > 0;
                          const isToday = offsetDays === 0;
                          const active = !isFuture && (stats.createdAtMap?.[dayTs] > 0);
                          return (
                            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                              <div style={{
                                width: 7, height: 7, borderRadius: "50%",
                                backgroundColor: isFuture
                                  ? "rgba(255,255,255,0.07)"
                                  : active
                                  ? "#fb923c"
                                  : "rgba(255,255,255,0.13)",
                                boxShadow: active ? "0 0 4px rgba(251,146,60,0.55)" : "none",
                                flexShrink: 0,
                              }} />
                              <span style={{
                                fontSize: 8,
                                fontWeight: isToday ? 700 : 400,
                                color: isToday ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.22)",
                                lineHeight: 1,
                              }}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Nodes */}
              <div
                style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}
              >
                <Network size={18} style={{ color: "#60a5fa", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#60a5fa" }}>{stats.totalNodes.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Total nodes</p>
                </div>
              </div>

              {/* Connections */}
              <div
                style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}
              >
                <Link2 size={18} style={{ color: "#a78bfa", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#a78bfa" }}>{stats.totalLinks.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Connections</p>
                </div>
              </div>

              {/* Files */}
              <div
                style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}
              >
                <FileText size={18} style={{ color: "#34d399", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#34d399" }}>{stats.totalFiles.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Files</p>
                </div>
              </div>
            </div>

            {/* Right: compact calendar */}
            <CalendarHeatmap createdAtMap={stats.createdAtMap} />
          </div>
        )}

        {/* Weekly summary */}
        {stats?.weekly && (stats.weekly.nodesAdded > 0 || stats.weekly.edits > 0 || stats.weekly.filesModified > 0) && (
          <div
            className="flex items-center gap-3 mb-8 px-5 py-3 rounded-xl"
            style={{ backgroundColor: "rgba(96,165,250,0.07)", border: "1px solid rgba(96,165,250,0.18)" }}
          >
            <TrendingUp size={16} style={{ color: "#60a5fa", flexShrink: 0 }} />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
              <span className="font-semibold text-white">This week: </span>
              {[
                stats.weekly.nodesAdded > 0 && `${stats.weekly.nodesAdded} node${stats.weekly.nodesAdded !== 1 ? "s" : ""} added`,
                stats.weekly.edits > 0 && `${stats.weekly.edits} node${stats.weekly.edits !== 1 ? "s" : ""} edited`,
                stats.weekly.filesModified > 0 && `${stats.weekly.filesModified} file${stats.weekly.filesModified !== 1 ? "s" : ""} modified`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        )}

        {/* Workspaces */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>
            Workspaces
          </h2>
          {workspaces.length === 0 ? (
            <p className="text-sm" style={{ color: MUTED }}>No workspaces found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {workspaces.map((ws) => (
                <button
                  key={ws.slug}
                  onClick={() => openWorkspace(ws.slug)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.05)",
                    color: TEXT,
                    border: `1px solid ${BORDER}`,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)")}
                >
                  <Network size={13} className="text-blue-400" />
                  {ws.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Recent Documents */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>
            Recent Documents
          </h2>
          {loadingDocs ? (
            <p className="text-sm" style={{ color: MUTED }}>Loading…</p>
          ) : recentDocs.length === 0 ? (
            <p className="text-sm" style={{ color: MUTED }}>No documents yet.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              {recentDocs.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => openDoc(doc.wsSlug, doc.filename)}
                  className="flex flex-col gap-2 p-4 rounded-xl text-left transition-colors"
                  style={{
                    backgroundColor: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    minHeight: "180px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(96,165,250,0.3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = BORDER)}
                >
                  {/* path label */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText size={11} style={{ color: MUTED, flexShrink: 0 }} />
                    <span className="text-xs truncate" style={{ color: MUTED }}>
                      {pathLabel(doc.wsName, doc.filename)}
                    </span>
                  </div>

                  {/* filename */}
                  <span className="text-sm font-semibold leading-snug" style={{ color: TEXT }}>
                    {stripExt(basename(doc.filename))}
                  </span>

                  {/* preview */}
                  {doc.preview && (
                    <p
                      className="text-xs leading-relaxed flex-1"
                      style={{
                        color: "rgba(255,255,255,0.45)",
                        display: "-webkit-box",
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {doc.preview}
                    </p>
                  )}

                  {/* timestamp */}
                  <div className="flex items-center gap-1 mt-auto pt-1" style={{ color: MUTED }}>
                    <Clock size={10} />
                    <span className="text-xs">{timeAgo(doc.mtime)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

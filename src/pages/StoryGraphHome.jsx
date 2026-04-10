import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Network, FileText, Clock } from "lucide-react";
import Header from "../components/Header.jsx";

const BG        = "#0f0f1a";
const CARD_BG   = "#161624";
const BORDER    = "rgba(255,255,255,0.08)";
const MUTED     = "rgba(255,255,255,0.35)";
const TEXT      = "rgba(255,255,255,0.88)";
const PREVIEW_LIMIT = 300;
const CACHE_TTL     = 60_000; // 60 s

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
        fetch(`/api/story-notes?workspace=${encodeURIComponent(ws.slug)}`)
          .then((r) => r.ok ? r.json() : { nodes: [] })
          .catch(() => ({ nodes: [] })),
      ]);

      // Build filename → filePreview map from the graph cache.
      // Only nodes that own a dedicated raw file carry filePreview; others are skipped.
      const previewMap = new Map();
      for (const node of (graphJson.nodes || [])) {
        if (node.filePreview === undefined) continue;
        if (node.sourceFile && !previewMap.has(node.sourceFile))
          previewMap.set(node.sourceFile, node.filePreview);
        for (const sf of (node.additionalSourceFiles || []))
          if (!previewMap.has(sf)) previewMap.set(sf, node.filePreview);
      }

      return { ws, files, previewMap };
    })
  );

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

  return { workspaces, docs };
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

export default function StoryGraphHome() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState(_cache.data?.workspaces ?? []);
  const [recentDocs, setRecentDocs] = useState(_cache.data?.docs ?? []);
  const [loadingDocs, setLoadingDocs] = useState(!_cache.data);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const age = Date.now() - _cache.fetchedAt;
    if (_cache.data && age < CACHE_TTL) return; // cache is fresh — nothing to do

    setLoadingDocs(true);
    fetchHomeData()
      .then(({ workspaces, docs }) => {
        if (!mounted.current) return;
        _cache.data = { workspaces, docs };
        _cache.fetchedAt = Date.now();
        setWorkspaces(workspaces);
        setRecentDocs(docs);
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

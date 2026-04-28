import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Network, GitFork, X } from "lucide-react";
import FilesEditor from "../components/FilesEditor.jsx";
import CalendarHeatmap from "../components/CalendarHeatmap.jsx";
import { requestJson } from "../utils/storygraphApi.js";
import { useStoryGraphTheme } from "../contexts/StoryGraphThemeContext.jsx";
import {
  JOURNAL_ENTRY_DIR,
  JOURNAL_GRAPH_WORKSPACE_NAME,
  JOURNAL_GRAPH_WORKSPACE_SLUG,
  JOURNAL_LEGACY_FILE_PATH,
  JOURNAL_WORKSPACE_NAME,
  JOURNAL_WORKSPACE_SLUG,
  buildJournalEntryTitle,
  buildJournalEntryFilename,
  formatJournalDateKey,
  parseJournalEntries,
  serializeJournalEntryFileContent,
} from "../utils/journal.js";

const EMPTY_GRAPH = { nodes: [], links: [] };
const JOURNAL_TIMELINE_PAGE_SIZE = 60;


function previewText(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "No text";
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function formatDateLong(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return dateKey;
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  const dt = new Date(year, month - 1, day);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function StoryGraphJournal() {
  const { theme } = useStoryGraphTheme();
  const { colors } = theme;
  const BG = colors.bg;
  const CARD_BG = colors.surface;
  const TEXT = colors.text;
  const MUTED = colors.muted;
  const BORDER = colors.border;

  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [error, setError] = useState("");
  const [journalGraphData, setJournalGraphData] = useState(EMPTY_GRAPH);
  const [entries, setEntries] = useState([]);
  const [timelinePage, setTimelinePage] = useState({ offset: 0, nextOffset: 0, hasMore: false, total: 0 });
  const [selectedFilename, setSelectedFilename] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [timelineHydrated, setTimelineHydrated] = useState(false);
  const [loadingOlderEntries, setLoadingOlderEntries] = useState(false);
  const [visualizing, setVisualizing] = useState(false);
  const [visualizeProgress, setVisualizeProgress] = useState("");
  const [visualizeError, setVisualizeError] = useState("");

  const navigate = useNavigate();
  const filesEditorApiRef = useRef(null);
  const timelineListRef = useRef(null);
  const entryArticleRefs = useRef(new Map());
  const filesChangeRefreshTimerRef = useRef(null);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date) || String(b.filename).localeCompare(String(a.filename))),
    [entries]
  );

  const mergeTimelineEntries = useCallback((currentEntries, incomingEntries) => {
    const map = new Map();
    for (const entry of currentEntries || []) {
      if (!entry?.filename) continue;
      map.set(entry.filename, entry);
    }
    for (const entry of incomingEntries || []) {
      if (!entry?.filename) continue;
      map.set(entry.filename, entry);
    }
    return [...map.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || String(b.filename).localeCompare(String(a.filename))
    );
  }, []);

  const ensureJournalWorkspace = useCallback(async () => {
    try {
      const existing = await requestJson("/api/workspaces", {
        query: { includeHidden: "1" },
      }).catch(() => null);
      const found = Array.isArray(existing?.workspaces)
        && existing.workspaces.some((ws) => ws?.slug === JOURNAL_WORKSPACE_SLUG);
      if (found) return true;

      await requestJson("/api/workspaces", {
        method: "POST",
        body: {
          name: JOURNAL_WORKSPACE_NAME,
          desiredSlug: JOURNAL_WORKSPACE_SLUG,
          preset: "journaling",
          hidden: true,
        },
      });
      return true;
    } catch (err) {
      const alreadyExists = String(err?.message || "").includes("already exists");
      return alreadyExists;
    }
  }, []);

  const ensureJournalGraphWorkspace = useCallback(async () => {
    try {
      const existing = await requestJson("/api/workspaces", {
        query: { includeHidden: "1" },
      }).catch(() => null);
      const found = Array.isArray(existing?.workspaces)
        && existing.workspaces.some((ws) => ws?.slug === JOURNAL_GRAPH_WORKSPACE_SLUG);
      if (found) return true;

      await requestJson("/api/workspaces", {
        method: "POST",
        body: {
          name: JOURNAL_GRAPH_WORKSPACE_NAME,
          desiredSlug: JOURNAL_GRAPH_WORKSPACE_SLUG,
          preset: "journaling",
          hidden: true,
        },
      });
      return true;
    } catch (err) {
      const alreadyExists = String(err?.message || "").includes("already exists");
      return alreadyExists;
    }
  }, []);

  const loadJournalGraph = useCallback(async () => {
    const graph = await requestJson("/api/story-notes", {
      query: { workspace: JOURNAL_GRAPH_WORKSPACE_SLUG },
    }).catch(() => ({ nodes: [] }));
    const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    setJournalGraphData({ nodes: graphNodes, links: [] });
    return graphNodes;
  }, []);

  const loadJournalTimelinePage = useCallback(async ({
    offset = 0,
    append = false,
    limit = JOURNAL_TIMELINE_PAGE_SIZE,
    date = "",
  } = {}) => {
    const timeline = await requestJson("/api/journal-timeline", {
      query: {
        workspace: JOURNAL_WORKSPACE_SLUG,
        offset,
        limit,
        ...(date ? { date } : {}),
      },
    }).catch(() => ({ entries: [], page: { offset, nextOffset: offset, hasMore: false, total: 0 } }));

    const page = timeline?.page || {};
    const incomingEntries = (Array.isArray(timeline?.entries) ? timeline.entries : []).map((entry) => ({
      filename: String(entry?.filename || ""),
      date: String(entry?.date || ""),
      title: String(entry?.title || ""),
      preview: String(entry?.preview || ""),
      mtime: Number(entry?.mtime || 0),
    }));

    setTimelinePage({
      offset: Number(page?.offset || offset),
      nextOffset: Number(page?.nextOffset || (offset + incomingEntries.length)),
      hasMore: Boolean(page?.hasMore),
      total: Number(page?.total || incomingEntries.length),
    });

    setEntries((prev) => (append ? mergeTimelineEntries(prev, incomingEntries) : incomingEntries));
    return incomingEntries;
  }, [mergeTimelineEntries]);

  const createEntryFileForDate = useCallback(async (dateKey, existingFilenames = []) => {
    const filename = buildJournalEntryFilename(dateKey, existingFilenames);
    const content = serializeJournalEntryFileContent(dateKey, "");
    await requestJson("/api/notes-raw-file", {
      method: "POST",
      query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
      body: { content, name: `Journal Entry - ${dateKey}` },
    });
    return filename;
  }, []);

  const ensureJournalEntriesAndLoadTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    setError("");
    try {
      // Load graph in parallel; timeline render should not wait on it.
      loadJournalGraph().catch(() => {});
      let loadedEntries = await loadJournalTimelinePage();
      let timelineMutated = false;

      if (loadedEntries.length === 0) {
        // Migrate old aggregate journal file into one file per entry when present.
        try {
          const legacy = await requestJson("/api/notes-raw-file", {
            query: { workspace: JOURNAL_WORKSPACE_SLUG, filename: JOURNAL_LEGACY_FILE_PATH },
          });
          const legacyEntries = parseJournalEntries(String(legacy?.content || ""));
          const created = new Set();
          for (const entry of legacyEntries) {
            const filename = buildJournalEntryFilename(entry.date, created);
            created.add(filename);
            await requestJson("/api/notes-raw-file", {
              method: "POST",
              query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
              body: {
                content: serializeJournalEntryFileContent(entry.date, entry.content || ""),
                name: `Journal Entry - ${entry.date}`,
              },
            });
          }
          timelineMutated = legacyEntries.length > 0;
        } catch {
          // No legacy file present; we'll create today's entry below.
        }
      }

      if (loadedEntries.length === 0) {
        const today = formatJournalDateKey();
        await createEntryFileForDate(today);
        timelineMutated = true;
      }

      if (timelineMutated) {
        loadedEntries = await loadJournalTimelinePage();
      }

      setSelectedFilename((prev) => {
        if (prev && loadedEntries.some((entry) => entry.filename === prev)) return prev;
        return loadedEntries[0]?.filename || "";
      });
    } catch {
      setError("Unable to load journal timeline.");
    } finally {
      setTimelineHydrated(true);
      setLoadingTimeline(false);
    }
  }, [createEntryFileForDate, loadJournalGraph, loadJournalTimelinePage]);

  const refreshEntriesFromDisk = useCallback(async () => {
    const limit = Math.max(JOURNAL_TIMELINE_PAGE_SIZE, entries.length || JOURNAL_TIMELINE_PAGE_SIZE);
    const nextEntries = await loadJournalTimelinePage({ offset: 0, append: false, limit });
    await loadJournalGraph();

    if (!nextEntries.some((entry) => entry.filename === selectedFilename)) {
      setSelectedFilename(nextEntries[0]?.filename || "");
    }
  }, [entries.length, loadJournalTimelinePage, loadJournalGraph, selectedFilename]);

  useEffect(() => {
    let active = true;
    ensureJournalWorkspace()
      .then((ok) => {
        if (!active) return;
        setWorkspaceReady(ok);
        if (!ok) setError("Unable to initialize private journal workspace.");
      })
      .catch(() => {
        if (!active) return;
        setError("Unable to initialize private journal workspace.");
      });

    return () => {
      active = false;
    };
  }, [ensureJournalWorkspace]);

  useEffect(() => {
    if (!workspaceReady) return;
    ensureJournalEntriesAndLoadTimeline();
  }, [workspaceReady, ensureJournalEntriesAndLoadTimeline]);

  const handleFilesEditorReady = useCallback((api) => {
    filesEditorApiRef.current = api;
    if (selectedFilename) api?.openFileByName?.(selectedFilename);
  }, [selectedFilename]);

  useEffect(() => {
    if (!isEditorOpen || !workspaceReady || !selectedFilename) return;
    filesEditorApiRef.current?.openFileByName?.(selectedFilename);
  }, [isEditorOpen, workspaceReady, selectedFilename]);

  const ensureEntryFileForDate = useCallback(async (date) => {
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : formatJournalDateKey();
    const existing = sortedEntries.find((entry) => entry.date === safeDate);
    if (existing) return existing.filename;

    const dateLookup = await requestJson("/api/journal-timeline", {
      query: { workspace: JOURNAL_WORKSPACE_SLUG, date: safeDate, offset: 0, limit: 20 },
    }).catch(() => ({ entries: [] }));
    const existingFromDisk = Array.isArray(dateLookup?.entries) ? dateLookup.entries : [];
    if (existingFromDisk.length > 0) {
      const filename = String(existingFromDisk[0]?.filename || "");
      if (filename) {
        setEntries((prev) => mergeTimelineEntries(prev, [{
          filename,
          date: safeDate,
          title: String(existingFromDisk[0]?.title || ""),
          preview: String(existingFromDisk[0]?.preview || ""),
          mtime: Number(existingFromDisk[0]?.mtime || 0),
        }]));
        return filename;
      }
    }

    let createdFilename = "";
    try {
      createdFilename = await createEntryFileForDate(
        safeDate,
        sortedEntries.map((entry) => entry.filename)
      );
    } catch {
      // Handle race/collision defensively: reload and use any now-existing entry for that date.
      const racedEntries = await loadJournalTimelinePage({
        offset: 0,
        append: false,
        limit: Math.max(JOURNAL_TIMELINE_PAGE_SIZE, entries.length || JOURNAL_TIMELINE_PAGE_SIZE),
      });
      const racedExisting = racedEntries.find((entry) => entry.date === safeDate);
      if (racedExisting) return racedExisting.filename;
      throw new Error("create-failed");
    }

    await loadJournalTimelinePage({
      offset: 0,
      append: false,
      limit: Math.max(JOURNAL_TIMELINE_PAGE_SIZE, entries.length + 1),
    });
    return createdFilename;
  }, [createEntryFileForDate, entries.length, loadJournalTimelinePage, mergeTimelineEntries, sortedEntries]);

  const loadOlderEntries = useCallback(async () => {
    if (loadingOlderEntries || !timelinePage.hasMore) return;
    setLoadingOlderEntries(true);
    try {
      await loadJournalTimelinePage({ offset: timelinePage.nextOffset, append: true });
    } finally {
      setLoadingOlderEntries(false);
    }
  }, [loadingOlderEntries, loadJournalTimelinePage, timelinePage.hasMore, timelinePage.nextOffset]);

  const jumpToDate = useCallback(async (date) => {
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : formatJournalDateKey();
    setSearchQuery("");
    try {
      const filename = await ensureEntryFileForDate(safeDate);
      setSelectedFilename(filename);
    } catch {
      setError("Unable to create journal entry.");
    }
  }, [ensureEntryFileForDate]);

  const selectEntry = useCallback((entry) => {
    setSelectedFilename(entry.filename);
    setIsEditorOpen(true);
  }, []);

  const deriveJournalGraph = useCallback(async (force = false) => {
    const deriveSecret = import.meta.env.VITE_JOURNAL_DERIVE_SECRET;
    await requestJson("/api/journal-derive", {
      method: "POST",
      headers: deriveSecret ? { "x-journal-derive-secret": String(deriveSecret) } : undefined,
      body: {
        workspace: JOURNAL_GRAPH_WORKSPACE_SLUG,
        sourceWorkspace: JOURNAL_WORKSPACE_SLUG,
        ...(force ? { force: true } : {}),
      },
    });
  }, []);

  const openJournalGraph = useCallback(async () => {
    if (visualizing || sortedEntries.length === 0) return;
    setVisualizing(true);
    setVisualizeError("");
    setVisualizeProgress("Checking existing graph\u2026");
    try {
      const graphReady = await ensureJournalGraphWorkspace();
      if (!graphReady) throw new Error("Unable to initialize journal graph workspace.");
      const currentNodes = await loadJournalGraph().catch(() => []);
      const hasExistingGraph = Array.isArray(currentNodes) && currentNodes.length > 0;
      if (!hasExistingGraph) {
        setVisualizeProgress("No graph found. Building from scratch\u2026");
        await deriveJournalGraph(true);
        await loadJournalGraph();
      }
      navigate(`/storygraph/graph?workspace=${encodeURIComponent(JOURNAL_GRAPH_WORKSPACE_SLUG)}`);
    } catch (err) {
      setVisualizeError(String(err?.message || "Unable to visualize journal entries."));
    } finally {
      setVisualizing(false);
      setVisualizeProgress("");
    }
  }, [visualizing, sortedEntries.length, ensureJournalGraphWorkspace, loadJournalGraph, deriveJournalGraph, navigate]);

  const refreshJournalGraph = useCallback(async () => {
    if (visualizing || sortedEntries.length === 0) return;
    setVisualizing(true);
    setVisualizeError("");
    setVisualizeProgress("Rebuilding graph from scratch\u2026");
    try {
      const graphReady = await ensureJournalGraphWorkspace();
      if (!graphReady) throw new Error("Unable to initialize journal graph workspace.");
      await deriveJournalGraph(true);
      await loadJournalGraph();
      navigate(`/storygraph/graph?workspace=${encodeURIComponent(JOURNAL_GRAPH_WORKSPACE_SLUG)}`);
    } catch (err) {
      setVisualizeError(String(err?.message || "Unable to refresh journal graph."));
    } finally {
      setVisualizing(false);
      setVisualizeProgress("");
    }
  }, [visualizing, sortedEntries.length, ensureJournalGraphWorkspace, deriveJournalGraph, loadJournalGraph, navigate]);

  const hasJournalGraphNodes = journalGraphData.nodes.length > 0;

  const handleJournalFilesChange = useCallback(() => {
    if (!workspaceReady) return;
    if (filesChangeRefreshTimerRef.current) clearTimeout(filesChangeRefreshTimerRef.current);
    filesChangeRefreshTimerRef.current = setTimeout(() => {
      refreshEntriesFromDisk().catch(() => {
        // Non-fatal; journal UI keeps existing content if a refresh fails.
      });
      filesChangeRefreshTimerRef.current = null;
    }, 250);
  }, [workspaceReady, refreshEntriesFromDisk]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedEntries;
    return sortedEntries.filter((entry) => {
      const hay = `${entry.date}\n${entry.title || ""}\n${entry.preview || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedEntries, searchQuery]);

  const journalEntryMap = useMemo(() => {
    const map = {};
    for (const entry of sortedEntries) {
      const [y, m, d] = entry.date.split("-").map((part) => Number.parseInt(part, 10));
      const ts = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
      map[ts] = 1;
    }
    return map;
  }, [sortedEntries]);

  // On journal page we don't currently load global node-created heat data,
  // so render neutral heat cells and overlay journal notches.
  const createdAtMap = useMemo(() => ({}), []);

  useEffect(() => {
    const requestedDate = searchParams.get("date");
    if (!requestedDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return;
    if (!workspaceReady || loadingTimeline || !timelineHydrated) return;
    jumpToDate(requestedDate);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("date");
      return next;
    }, { replace: true });
  }, [searchParams, workspaceReady, loadingTimeline, timelineHydrated, jumpToDate, setSearchParams]);

  useEffect(() => {
    if (!selectedFilename) return;
    const listEl = timelineListRef.current;
    const entryEl = entryArticleRefs.current.get(selectedFilename);
    if (!listEl || !entryEl) return;
    requestAnimationFrame(() => {
      entryEl.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [selectedFilename, filteredEntries]);

  useEffect(() => {
    return () => {
      if (filesChangeRefreshTimerRef.current) clearTimeout(filesChangeRefreshTimerRef.current);
    };
  }, []);

  return (
    <div className="dark-scroll min-h-screen flex flex-col" style={{ backgroundColor: BG, color: TEXT, fontFamily: theme.fontFamily }}>

      {/* Visualize loading overlay */}
      {visualizing && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backgroundColor: colors.overlay, backdropFilter: "blur(8px)" }}
        >
          <GitFork size={36} className="mb-6" style={{ transform: "rotate(180deg)", color: colors.accent }} />
          <p className="text-lg font-semibold mb-2" style={{ color: colors.textStrong }}>Visualizing Journal</p>
          <p style={{ fontSize: 13, color: MUTED }}>{visualizeProgress}</p>
          <div
            style={{
              marginTop: 28,
              width: 200,
              height: 3,
              borderRadius: 99,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 99,
                backgroundColor: colors.accent,
                animation: "journal-progress-pulse 1.8s ease-in-out infinite",
                width: "60%",
              }}
            />
          </div>
          <style>{`@keyframes journal-progress-pulse { 0%,100%{opacity:0.4;transform:scaleX(0.6) translateX(-30%)} 50%{opacity:1;transform:scaleX(1) translateX(0%)} }`}</style>
        </div>
      )}

      <div
        className="flex items-center gap-3 px-6 py-3 border-b"
        style={{ borderColor: BORDER }}
      >
        <Link
          to="/storygraph"
          className="flex items-center gap-2 transition-opacity hover:opacity-75"
          title="Back to Story Graph home"
        >
          <Network size={20} style={{ color: colors.accent }} />
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: colors.textStrong }}>Story Graph</h1>
        </Link>
      </div>

      <div className="flex-1 w-full px-16 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: colors.textStrong }}>Journal</h1>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "20% minmax(0, 80%)",
            gap: 20,
            height: "calc(100vh - 250px)",
            minHeight: 520,
            width: "100%",
            overflow: "hidden",
          }}
        >
          <section style={{ minWidth: 0, overflowY: "auto", paddingRight: 4 }}>
            <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 8 }}>Calendar</label>
            <CalendarHeatmap
              createdAtMap={createdAtMap}
              journalEntryMap={journalEntryMap}
              onJournalDayClick={(dateKey) => {
                jumpToDate(dateKey);
              }}
            />

            <label style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 22, marginBottom: 8 }}>Search</label>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries"
              style={{
                width: "100%",
                background: "transparent",
                color: TEXT,
                fontSize: 13,
                padding: "6px 0",
                border: "none",
                borderBottom: `1px solid ${BORDER}`,
                outline: "none",
              }}
            />

            <button
              onClick={() => jumpToDate(formatJournalDateKey())}
              style={{
                marginTop: 18,
                padding: "6px 0",
                fontSize: 12,
                background: "transparent",
                color: TEXT,
                border: "none",
                borderBottom: `1px solid ${BORDER}`,
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
              }}
            >
              Jump to today
            </button>

            <button
              onClick={openJournalGraph}
              disabled={visualizing || sortedEntries.length === 0}
              style={{
                marginTop: 28,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "9px 0",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: `1px solid ${colors.accent}`,
                backgroundColor: colors.accentSoft,
                color: colors.accentStrong,
                cursor: visualizing || sortedEntries.length === 0 ? "default" : "pointer",
                opacity: sortedEntries.length === 0 ? 0.4 : 1,
                transition: "background-color 150ms ease",
              }}
              onMouseEnter={(e) => { if (!visualizing && sortedEntries.length > 0) e.currentTarget.style.backgroundColor = colors.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colors.accentSoft; }}
            >
              <GitFork size={14} style={{ transform: "rotate(180deg)" }} />
              Visualize Journal
            </button>

            {hasJournalGraphNodes && (
              <button
                onClick={refreshJournalGraph}
                disabled={visualizing || sortedEntries.length === 0}
                style={{
                  marginTop: 8,
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "9px 0",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.2)",
                  backgroundColor: "rgba(148,163,184,0.06)",
                  color: "rgba(148,163,184,0.8)",
                  cursor: visualizing || sortedEntries.length === 0 ? "default" : "pointer",
                  opacity: sortedEntries.length === 0 ? 0.4 : 1,
                  transition: "background-color 150ms ease",
                }}
                onMouseEnter={(e) => { if (!visualizing && sortedEntries.length > 0) e.currentTarget.style.backgroundColor = "rgba(148,163,184,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(148,163,184,0.06)"; }}
              >
                <GitFork size={14} style={{ transform: "rotate(180deg)" }} />
                Refresh Graph
              </button>
            )}

            {visualizeError && (
              <p style={{ fontSize: 11, color: colors.danger, marginTop: 8, textAlign: "center" }}>{visualizeError}</p>
            )}
          </section>

          <section style={{ minWidth: 0, overflowY: "auto", paddingRight: 6 }}>
            {loadingTimeline && (
              <p style={{ fontSize: 12, color: MUTED }}>
                Loading journal entries...
              </p>
            )}

            {!loadingTimeline && filteredEntries.length === 0 && (
              <p style={{ fontSize: 12, color: MUTED }}>
                No matching entries.
              </p>
            )}

            {!loadingTimeline && filteredEntries.length > 0 && (
              <div
                ref={timelineListRef}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24% minmax(0, 76%)",
                  columnGap: 22,
                  alignItems: "start",
                }}
              >
                {filteredEntries.map((entry) => (
                  <div key={`row-${entry.filename}`} style={{ display: "contents" }}>
                    <button
                      onClick={() => selectEntry(entry)}
                      className="text-left"
                      style={{
                        padding: "7px 0",
                        fontSize: 13,
                        background: "transparent",
                        border: "none",
                        color: selectedFilename === entry.filename ? TEXT : MUTED,
                        cursor: "pointer",
                      }}
                    >
                      {formatDateLong(entry.date)}
                    </button>

                    <article
                      key={`entry-${entry.filename}`}
                      ref={(el) => {
                        if (el) entryArticleRefs.current.set(entry.filename, el);
                        else entryArticleRefs.current.delete(entry.filename);
                      }}
                      onClick={() => selectEntry(entry)}
                      style={{
                        marginBottom: 28,
                        cursor: "pointer",
                      }}
                    >
                      <h2
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          margin: 0,
                          color: selectedFilename === entry.filename ? TEXT : "rgba(255,255,255,0.78)",
                        }}
                      >
                        {entry.title || buildJournalEntryTitle(entry.date)}
                      </h2>
                      <div style={{ height: 1, margin: "8px 0 12px", backgroundColor: "rgba(255,255,255,0.2)" }} />
                      <p
                        style={{
                          margin: 0,
                          fontSize: 14,
                          lineHeight: 1.7,
                          color: "rgba(255,255,255,0.78)",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.preview?.trim() || previewText(entry.preview)}
                      </p>
                    </article>
                  </div>
                ))}
              </div>
            )}

            {!loadingTimeline && filteredEntries.length > 0 && timelinePage.hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
                <button
                  onClick={loadOlderEntries}
                  disabled={loadingOlderEntries}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 7,
                    border: "1px solid rgba(148,163,184,0.3)",
                    background: "rgba(148,163,184,0.08)",
                    color: "rgba(255,255,255,0.84)",
                    fontSize: 12,
                    cursor: loadingOlderEntries ? "default" : "pointer",
                    opacity: loadingOlderEntries ? 0.7 : 1,
                  }}
                >
                  {loadingOlderEntries ? "Loading..." : "Load older entries"}
                </button>
              </div>
            )}

            {!loadingTimeline && filteredEntries.length > 0 && !timelinePage.hasMore && (
              <p style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.32)", padding: "8px 0 4px" }}>
                Reached end of journal entries
              </p>
            )}

            {error && <p style={{ fontSize: 11, color: colors.danger, marginTop: 10 }}>{error}</p>}
          </section>
        </div>

        {isEditorOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              style={{ backgroundColor: colors.overlay }}
              onMouseDown={() => setIsEditorOpen(false)}
            />
            <aside
              className="fixed top-0 right-0 bottom-0 z-50"
              style={{
                width: "min(44vw, 760px)",
                backgroundColor: CARD_BG,
                border: `1px solid ${BORDER}`,
                borderRight: "none",
                borderTop: "none",
                borderBottom: "none",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                boxShadow: "-24px 0 48px rgba(0,0,0,0.45)",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                <p style={{ margin: 0, fontSize: 13, color: TEXT }}>
                  {selectedFilename || "Journal Entry"}
                </p>
                <button
                  onClick={() => setIsEditorOpen(false)}
                  className="p-1 rounded"
                  style={{ color: MUTED }}
                  title="Close editor"
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                {workspaceReady ? (
                  <FilesEditor
                    graphData={journalGraphData}
                    workspace={JOURNAL_WORKSPACE_SLUG}
                    hotbarOnly
                    onReady={handleFilesEditorReady}
                    onFilesChange={handleJournalFilesChange}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center" style={{ color: MUTED, fontSize: 13 }}>
                    Initializing journal workspace...
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

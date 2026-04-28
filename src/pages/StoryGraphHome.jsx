/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Network, FileText, Clock, Flame, Link2, TrendingUp } from "lucide-react";
import Header from "../components/Header.jsx";
import CalendarHeatmap from "../components/CalendarHeatmap.jsx";
import { requestJson } from "../utils/storygraphApi.js";
import {
  JOURNAL_ENTRY_DIR,
  JOURNAL_FILE_PATH,
  JOURNAL_WORKSPACE_NAME,
  JOURNAL_WORKSPACE_SLUG,
  buildJournalEntryTitle,
  extractDateFromJournalFilename,
  formatJournalDateKey,
  getJournalEntryByDate,
  parseJournalEntryFileContent,
  serializeJournalEntryFileContent,
} from "../utils/journal.js";

const BG        = "#0f0f1a";
const CARD_BG   = "#161624";
const BORDER    = "rgba(255,255,255,0.08)";
const MUTED     = "rgba(255,255,255,0.35)";
const TEXT      = "rgba(255,255,255,0.88)";
const PREVIEW_LIMIT = 300;
const CACHE_TTL     = 60_000; // 60 s
const JOURNAL_AUTOSAVE_MS = 900;
const TOP_ROW_PANEL_MIN_HEIGHT = 280;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Module-level cache — survives SPA navigation, cleared on demand
const _cache = { data: null, fetchedAt: 0 };
export function invalidateHomeCache() { _cache.fetchedAt = 0; }

async function fetchHomeData() {
  const data = await requestJson("/api/storygraph-home");
  return {
    workspaces: Array.isArray(data?.workspaces) ? data.workspaces : [],
    docs: Array.isArray(data?.docs) ? data.docs : [],
    stats: data?.stats ?? null,
  };
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

function humanizeFilename(filename) {
  return stripExt(basename(filename || ""))
    .replace(/[+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** workspace/folder/sub — no spaces, no trailing slash */
function pathLabel(wsName, filename) {
  const dir = filename.includes("/") ? filename.split("/").slice(0, -1).join("/") : null;
  return dir ? `${wsName}/${dir}` : wsName;
}

function formatJournalHeadingDate(dateInput = new Date()) {
  return new Date(dateInput).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function StoryGraphHome() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState(_cache.data?.workspaces ?? []);
  const [recentDocs, setRecentDocs] = useState(_cache.data?.docs ?? []);
  const [stats, setStats] = useState(_cache.data?.stats ?? null);
  const [loadingDocs, setLoadingDocs] = useState(!_cache.data);
  const [journalWorkspaceReady, setJournalWorkspaceReady] = useState(false);
  const [todayJournalFilename, setTodayJournalFilename] = useState("");
  const [journalText, setJournalText] = useState("");
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalError, setJournalError] = useState("");
  const [journalSavedAt, setJournalSavedAt] = useState(0);
  const journalHydratedRef = useRef(false);
  const journalLastSavedTextRef = useRef("");
  const journalAutosaveTimerRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const age = Date.now() - _cache.fetchedAt;
    // Re-fetch if stale OR if cache is missing calendar maps (old format)
    if (_cache.data && age < CACHE_TTL && _cache.data.stats?.createdAtMap && _cache.data.stats?.journalEntryMap) return;

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

  useEffect(() => {
    let active = true;
    ensureJournalWorkspace().then((ok) => {
      if (!active) return;
      setJournalWorkspaceReady(ok);
      if (!ok) setJournalError("Unable to initialize private journal workspace.");
    });
    return () => {
      active = false;
    };
  }, [ensureJournalWorkspace]);

  // Fast path: load today's entry directly from a dedicated endpoint.
  // This avoids the full notes-raw-list scan on hard refresh when today's file exists.
  useEffect(() => {
    let active = true;
    const todayKey = formatJournalDateKey();

    setJournalLoading(true);
    setJournalError("");
    setJournalSavedAt(0);

    requestJson("/api/journal-today", {
      query: { workspace: JOURNAL_WORKSPACE_SLUG, date: todayKey },
    })
      .then((data) => {
        if (!active) return;
        if (!data?.found) return;

        const filename = String(data?.filename || "");
        const raw = String(data?.content || "");
        const parsed = parseJournalEntryFileContent(raw, todayKey, filename);
        const loadedText = parsed.content || "";

        setTodayJournalFilename(filename);
        setJournalText(loadedText);
        journalLastSavedTextRef.current = loadedText;
        journalHydratedRef.current = true;
        setJournalLoading(false);
      })
      .catch(() => {
        // Non-fatal: legacy/list fallback below will still hydrate.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!journalWorkspaceReady) return;
    if (journalHydratedRef.current) {
      setJournalLoading(false);
      return;
    }
    let active = true;
    const todayKey = formatJournalDateKey();

    setJournalLoading(true);
    setJournalError("");
    setJournalSavedAt(0);

    (async () => {
      try {
        const list = await requestJson("/api/notes-raw-list", {
          query: { workspace: JOURNAL_WORKSPACE_SLUG },
        }).catch(() => ({ files: [] }));

        const files = Array.isArray(list?.files) ? list.files : [];
        const todaysFiles = files
          .filter((file) => {
            const filename = String(file?.filename || "");
            if (!filename.startsWith(`${JOURNAL_ENTRY_DIR}/`)) return false;
            if (!/\.(md|txt)$/i.test(filename)) return false;
            return extractDateFromJournalFilename(filename) === todayKey;
          })
          .sort((a, b) => Number(b?.mtime || 0) - Number(a?.mtime || 0));

        if (todaysFiles.length > 0) {
          const filename = String(todaysFiles[0]?.filename || "");
          const data = await requestJson("/api/notes-raw-file", {
            query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
          });
          if (!active) return;
          const raw = String(data?.content || "");
          const parsed = parseJournalEntryFileContent(raw, todayKey, filename);
          const loadedText = parsed.content || "";
          setTodayJournalFilename(filename);
          setJournalText(loadedText);
          journalLastSavedTextRef.current = loadedText;
          journalHydratedRef.current = true;
          setJournalLoading(false);
          return;
        }

        // Legacy fallback: read aggregate journal file and migrate today's entry
        // into a per-day file so all screens stay aligned on the same source of truth.
        // Avoid a guaranteed 404 by checking whether the legacy file exists first.
        const hasLegacyJournalFile = files.some((f) => String(f?.filename || "") === JOURNAL_FILE_PATH);
        const legacy = hasLegacyJournalFile
          ? await requestJson("/api/notes-raw-file", {
              query: { workspace: JOURNAL_WORKSPACE_SLUG, filename: JOURNAL_FILE_PATH },
            }).catch(() => null)
          : null;
        const legacyRaw = String(legacy?.content || "");
        const todayEntry = legacy ? getJournalEntryByDate(legacyRaw, todayKey) : null;
        const loadedText = todayEntry?.content || "";

        if (todayEntry) {
          const filename = `${JOURNAL_ENTRY_DIR}/journal-entry-${todayKey}.md`;
          const content = serializeJournalEntryFileContent(todayKey, loadedText);
          await requestJson("/api/notes-raw-file", {
            method: "POST",
            query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
            body: { content, name: buildJournalEntryTitle(todayKey) },
          }).catch(async (err) => {
            const alreadyExists = String(err?.message || "").includes("already exists");
            if (!alreadyExists) throw err;
            await requestJson("/api/notes-raw-file", {
              method: "PUT",
              query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
              body: { content },
            });
          });
          if (!active) return;
          setTodayJournalFilename(filename);
        } else {
          if (!active) return;
          setTodayJournalFilename("");
        }

        if (!active) return;
        setJournalText(loadedText);
        journalLastSavedTextRef.current = loadedText;
        journalHydratedRef.current = true;
        setJournalLoading(false);
      } catch {
        if (!active) return;
        setJournalError("Unable to load journal entry.");
        setJournalLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [journalWorkspaceReady]);

  const saveTodayJournalEntry = useCallback(async (nextText = journalText) => {
    if (!journalWorkspaceReady) return;

    const ready = await ensureJournalWorkspace();
    if (!ready) {
      setJournalError("Unable to initialize private journal workspace.");
      return;
    }

    const todayKey = formatJournalDateKey();
    const filename = todayJournalFilename || `${JOURNAL_ENTRY_DIR}/journal-entry-${todayKey}.md`;
    const nextContent = serializeJournalEntryFileContent(todayKey, nextText);

    setJournalSaving(true);
    setJournalError("");
    setJournalSavedAt(0);
    try {
      if (todayJournalFilename) {
        await requestJson("/api/notes-raw-file", {
          method: "PUT",
          query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
          body: { content: nextContent },
        });
      } else {
        await requestJson("/api/notes-raw-file", {
          method: "POST",
          query: { workspace: JOURNAL_WORKSPACE_SLUG, filename },
          body: { content: nextContent, name: buildJournalEntryTitle(todayKey) },
        });
      }
      invalidateHomeCache();
      setTodayJournalFilename(filename);
      journalLastSavedTextRef.current = nextText;
      setJournalSavedAt(Date.now());
    } catch {
      setJournalError("Unable to save journal entry.");
    } finally {
      setJournalSaving(false);
    }
  }, [journalWorkspaceReady, todayJournalFilename, journalText, ensureJournalWorkspace]);

  useEffect(() => {
    if (!journalWorkspaceReady || journalLoading || !journalHydratedRef.current) return;
    if (journalSaving) return;
    if (journalText === journalLastSavedTextRef.current) return;

    if (journalAutosaveTimerRef.current) clearTimeout(journalAutosaveTimerRef.current);
    journalAutosaveTimerRef.current = setTimeout(() => {
      saveTodayJournalEntry(journalText);
    }, JOURNAL_AUTOSAVE_MS);

    return () => {
      if (journalAutosaveTimerRef.current) clearTimeout(journalAutosaveTimerRef.current);
    };
  }, [journalWorkspaceReady, journalLoading, journalSaving, journalText, saveTodayJournalEntry]);

  const openWorkspace = (slug) => navigate(`/storygraph/graph?workspace=${encodeURIComponent(slug)}`);
  const openDoc = (wsSlug, filename) => navigate(
    `/storygraph/graph?workspace=${encodeURIComponent(wsSlug)}&file=${encodeURIComponent(filename)}`
  );
  const openJournalPage = () => {
    navigate("/storygraph/journal");
  };
  const openJournalPageForDate = useCallback((dateKey) => {
    navigate(`/storygraph/journal?date=${encodeURIComponent(dateKey)}`);
  }, [navigate]);

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
          <div className="grid grid-cols-1 xl:grid-cols-12" style={{ gap: 22, marginBottom: 40, alignItems: "stretch" }}>
            <div className="xl:col-span-3" style={{ minHeight: TOP_ROW_PANEL_MIN_HEIGHT, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignContent: "start" }}>
                <div
                  style={{
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    minHeight: 76,
                  }}
                >
                <Flame size={18} style={{ color: stats.streak.current > 0 ? "#fb923c" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: stats.streak.current > 0 ? "#fb923c" : "rgba(255,255,255,0.25)" }}>
                    {stats.streak.current > 0 ? `${stats.streak.current}d` : "—"}
                  </p>
                  <p style={{ fontSize: 11, marginTop: 4, color: MUTED }}>Writing streak</p>
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

                <div
                  style={{
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    minHeight: 76,
                  }}
                >
                <Network size={18} style={{ color: "#60a5fa", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#60a5fa" }}>{stats.totalNodes.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Total nodes</p>
                </div>
                </div>

                <div
                  style={{
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    minHeight: 76,
                  }}
                >
                <Link2 size={18} style={{ color: "#a78bfa", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#a78bfa" }}>{stats.totalLinks.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Connections</p>
                </div>
                </div>

                <div
                  style={{
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    minHeight: 76,
                  }}
                >
                <FileText size={18} style={{ color: "#34d399", flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#34d399" }}>{stats.totalFiles.toLocaleString()}</p>
                  <p style={{ fontSize: 11, marginTop: 3, color: MUTED }}>Files</p>
                </div>
                </div>
            </div>

            <div className="xl:col-span-3" style={{ minHeight: TOP_ROW_PANEL_MIN_HEIGHT, display: "flex", alignItems: "flex-start" }}>
              <CalendarHeatmap
                createdAtMap={stats.createdAtMap}
                journalEntryMap={stats.journalEntryMap}
                onJournalDayClick={openJournalPageForDate}
              />
            </div>

            <div className="xl:col-span-6">
              <div
                style={{
                  minHeight: TOP_ROW_PANEL_MIN_HEIGHT,
                  padding: "6px 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button
                      onClick={openJournalPage}
                      disabled={!journalWorkspaceReady}
                      className="text-left"
                      style={{
                        fontSize: 24,
                        fontWeight: 600,
                        lineHeight: 1.15,
                        color: "rgba(255,255,255,0.94)",
                        letterSpacing: "-0.02em",
                        cursor: journalWorkspaceReady ? "pointer" : "default",
                        background: "none",
                        border: "none",
                        padding: 0,
                      }}
                    >
                      <span>Journal Entry - </span>
                      <span style={{ fontStyle: "italic" }}>{formatJournalHeadingDate()}</span>
                    </button>
                  </div>

                  <button
                    onClick={openJournalPage}
                    disabled={!journalWorkspaceReady}
                    className="text-xs"
                    style={{
                      color: "rgba(255,255,255,0.48)",
                      backgroundColor: "transparent",
                      border: "none",
                      padding: "4px 0",
                      cursor: journalWorkspaceReady ? "pointer" : "default",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Open Journal Page
                  </button>
                </div>

                <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

                <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
                  {!journalLoading && !journalText.trim() && (
                    <p
                      style={{
                        position: "absolute",
                        top: 2,
                        left: 0,
                        right: 0,
                        margin: 0,
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 15,
                        lineHeight: 1.7,
                        fontStyle: "italic",
                        pointerEvents: "none",
                      }}
                    >
                      No journal entry yet for today. Add one now...
                    </p>
                  )}
                  <textarea
                    value={journalText}
                    onChange={(e) => setJournalText(e.target.value)}
                    disabled={journalLoading || !journalWorkspaceReady}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      minHeight: 168,
                      maxHeight: 204,
                      overflowY: "auto",
                      resize: "none",
                      backgroundColor: "transparent",
                      border: "none",
                      padding: "0 0 6px",
                      color: "rgba(255,255,255,0.92)",
                      fontSize: 15,
                      lineHeight: 1.7,
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    {journalLoading
                      ? "Loading..."
                      : journalSaving
                      ? "Autosaving..."
                      : journalSavedAt
                      ? `Saved ${timeAgo(journalSavedAt)}`
                      : ""}
                  </span>
                </div>

                {journalError && (
                  <p style={{ fontSize: 11, color: "#fca5a5", margin: 0 }}>{journalError}</p>
                )}
              </div>
            </div>
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
                    {String(doc.title || "").trim() || humanizeFilename(doc.filename)}
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

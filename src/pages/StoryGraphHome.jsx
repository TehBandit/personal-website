/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Network, FileText, Clock, Flame, TrendingUp, Plus, GitBranch, Zap, ChevronRight, BookOpen, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import Header from "../components/Header.jsx";
import CalendarHeatmap from "../components/CalendarHeatmap.jsx";
import StoryGraphThemeMenu from "../components/StoryGraphThemeMenu.jsx";
import { TYPE_PRESETS } from "../constants/nodeTypes.js";
import { requestJson } from "../utils/storygraphApi.js";
import { useStoryGraphTheme } from "../contexts/StoryGraphThemeContext.jsx";
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

const CACHE_TTL     = 60_000; // 60 s
const JOURNAL_AUTOSAVE_MS = 900;

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
  const { theme } = useStoryGraphTheme();
  const { colors } = theme;
  const BG = colors.bg;
  const CARD_BG = colors.surface;
  const CARD_ALT = colors.surfaceAlt;
  const MUTED = colors.softText;
  const TEXT = colors.text;

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
  const homeCreateRef = useRef(null);
  const [homeCreateOpen, setHomeCreateOpen] = useState(false);
  const [homeCreateStep, setHomeCreateStep] = useState("preset"); // preset | name
  const [homeCreatePreset, setHomeCreatePreset] = useState(null);
  const [homeCreateName, setHomeCreateName] = useState("");

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
  const closeHomeCreate = useCallback(() => {
    setHomeCreateOpen(false);
    setHomeCreateStep("preset");
    setHomeCreatePreset(null);
    setHomeCreateName("");
  }, []);

  const createWorkspaceFromHome = useCallback(async () => {
    const trimmed = String(homeCreateName || "").trim();
    if (!trimmed) return;
    try {
      const created = await requestJson("/api/workspaces", {
        method: "POST",
        body: { name: trimmed, preset: homeCreatePreset || "narrative" },
      });
      const next = {
        slug: String(created?.slug || ""),
        name: String(created?.name || trimmed),
        nodeTypes: created?.nodeTypes || null,
      };
      if (!next.slug) throw new Error("Could not create workspace.");

      setWorkspaces((prev) => {
        if (prev.some((ws) => ws.slug === next.slug)) return prev;
        const merged = [...prev, next].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        _cache.data = {
          workspaces: merged,
          docs: _cache.data?.docs ?? recentDocs,
          stats: _cache.data?.stats ?? stats,
        };
        _cache.fetchedAt = Date.now();
        return merged;
      });

      closeHomeCreate();
      navigate(`/storygraph/graph?workspace=${encodeURIComponent(next.slug)}`);
    } catch (err) {
      window.alert(String(err?.message || "Unable to create workspace."));
    }
  }, [homeCreateName, homeCreatePreset, closeHomeCreate, navigate, recentDocs, stats]);

  useEffect(() => {
    if (!homeCreateOpen) return;
    const handler = (e) => {
      if (homeCreateRef.current && !homeCreateRef.current.contains(e.target)) {
        closeHomeCreate();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [homeCreateOpen, closeHomeCreate]);

  const openJournalPage = () => navigate("/storygraph/journal");
  const openJournalPageForDate = useCallback((dateKey) => {
    navigate(`/storygraph/journal?date=${encodeURIComponent(dateKey)}`);
  }, [navigate]);

  return (
    <div className="dark-scroll min-h-screen flex flex-col" style={{ backgroundColor: BG, color: TEXT, fontFamily: theme.fontFamily }}>
      <Header />

      <main className="max-w-[1400px] mx-auto w-full px-8 py-10 space-y-10">
        <div className="flex justify-end">
          <StoryGraphThemeMenu />
        </div>

        {/* Top row: Metrics + Calendar + Journal */}
        {stats ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Metrics column */}
            <div className="lg:col-span-3 space-y-4">
              {/* Streak card */}
              <div className="rounded-2xl p-5" style={{ backgroundColor: CARD_ALT }}>
                <div className="flex items-center gap-2 mb-3">
                  <Flame size={16} style={{ color: stats.streak.current > 0 ? colors.warning : colors.softText }} />
                  <span className="text-sm" style={{ color: colors.muted }}>Writing Streak</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-4xl font-bold" style={{ color: stats.streak.current > 0 ? colors.textStrong : colors.softText }}>
                    {stats.streak.current > 0 ? stats.streak.current : "\u2014"}
                  </span>
                  {stats.streak.current > 0 && (
                    <span style={{ color: colors.muted }}>days</span>
                  )}
                </div>
                {stats.streak.longest > 0 && (
                  <div className="text-sm mb-4" style={{ color: colors.softText }}>
                    Best: {stats.streak.longest} days
                  </div>
                )}
                {/* Week activity bars */}
                {(() => {
                  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
                  const now = new Date();
                  const todayDow = now.getDay();
                  const todayTs2 = startOfDay(now.getTime());
                  return (
                    <div style={{ display: "flex", gap: 6 }}>
                      {DOW.map((label, i) => {
                        const offsetDays = i - todayDow;
                        const dayTs = todayTs2 + offsetDays * 86400000;
                        const isFuture = offsetDays > 0;
                        const active = !isFuture && (stats.createdAtMap?.[dayTs] > 0);
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                            <span className="text-xs" style={{ color: colors.softText }}>{label}</span>
                            <div
                              className="w-full rounded-full"
                              style={{
                                height: 6,
                                backgroundColor: isFuture
                                  ? colors.borderSoft
                                  : active
                                  ? colors.warning
                                  : colors.border,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <GitBranch size={16} />, value: stats.totalNodes, label: "Nodes", color: colors.accent },
                  { icon: <Zap size={16} />, value: stats.totalLinks, label: "Links", color: colors.warning },
                  { icon: <FileText size={16} />, value: stats.totalFiles, label: "Files", color: colors.success },
                ].map(({ icon, value, label, color }) => (
                  <div key={label} className="rounded-xl p-3" style={{ backgroundColor: CARD_ALT }}>
                    <div className="mb-2" style={{ color: colors.muted }}>{icon}</div>
                    <div className="text-xl font-bold mb-0.5" style={{ color }}>{value?.toLocaleString() ?? "\u2014"}</div>
                    <div className="text-xs" style={{ color: colors.softText }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calendar column */}
            <div className="lg:col-span-3 flex flex-col">
              <div
                className="rounded-2xl flex-1 flex flex-col"
                style={{ backgroundColor: CARD_ALT, padding: "20px 16px" }}
              >
                <CalendarHeatmap
                  createdAtMap={stats.createdAtMap}
                  journalEntryMap={stats.journalEntryMap}
                  onJournalDayClick={openJournalPageForDate}
                />
              </div>
            </div>

            {/* Journal column */}
            <div className="lg:col-span-6">
              <div
                className="rounded-3xl p-6 h-full flex flex-col"
                style={{ background: `linear-gradient(to bottom right, ${CARD_ALT}, ${CARD_BG})` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-sm mb-1" style={{ color: colors.softText }}>Today&apos;s Journal</div>
                    <button
                      onClick={openJournalPage}
                      disabled={!journalWorkspaceReady}
                      className="text-left"
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: colors.textStrong,
                        letterSpacing: "-0.01em",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: journalWorkspaceReady ? "pointer" : "default",
                      }}
                    >
                      {formatJournalHeadingDate()}
                    </button>
                  </div>
                  <button
                    onClick={openJournalPage}
                    disabled={!journalWorkspaceReady}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl transition-colors"
                    style={{
                      color: colors.muted,
                      background: "none",
                      border: "none",
                      cursor: journalWorkspaceReady ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.borderSoft)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <BookOpen size={16} />
                    <span className="text-sm">View All</span>
                  </button>
                </div>

                <div style={{ position: "relative", flex: 1 }}>
                  {!journalLoading && !journalText.trim() && (
                    <p
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        margin: 0,
                        color: colors.softText,
                        fontSize: 15,
                        lineHeight: 1.7,
                        fontStyle: "italic",
                        pointerEvents: "none",
                      }}
                    >
                      What&apos;s on your mind?
                    </p>
                  )}
                  <textarea
                    value={journalText}
                    onChange={(e) => setJournalText(e.target.value)}
                    disabled={journalLoading || !journalWorkspaceReady}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      minHeight: 200,
                      resize: "none",
                      backgroundColor: "transparent",
                      border: "none",
                      padding: 0,
                      color: colors.text,
                      fontSize: 15,
                      lineHeight: 1.7,
                      outline: "none",
                    }}
                  />
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {journalLoading && (
                    <span className="text-sm" style={{ color: colors.muted }}>Loading...</span>
                  )}
                  {!journalLoading && journalSaving && (
                    <>
                      <Loader2 size={14} className="animate-spin" style={{ color: colors.muted }} />
                      <span className="text-sm" style={{ color: colors.muted }}>Saving...</span>
                    </>
                  )}
                  {!journalLoading && !journalSaving && journalSavedAt > 0 && (
                    <>
                      <CheckCircle2 size={14} style={{ color: colors.success }} />
                      <span className="text-sm" style={{ color: colors.muted }}>
                        Saved {timeAgo(journalSavedAt)}
                      </span>
                    </>
                  )}
                  {journalError && (
                    <>
                      <AlertCircle size={14} style={{ color: colors.danger }} />
                      <span className="text-sm" style={{ color: colors.danger }}>{journalError}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : loadingDocs ? (
          <p className="text-sm" style={{ color: MUTED }}>Loading...</p>
        ) : null}

        {/* Weekly summary */}
        {stats?.weekly && (stats.weekly.nodesAdded > 0 || stats.weekly.edits > 0 || stats.weekly.filesModified > 0) && (
          <div
            className="flex items-center gap-3 px-6 py-4 rounded-2xl"
            style={{ background: `linear-gradient(to right, ${colors.accentSoft}, ${colors.borderSoft})` }}
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 40, height: 40, backgroundColor: colors.accentSoft, flexShrink: 0 }}
            >
              <TrendingUp size={20} style={{ color: colors.accent }} />
            </div>
            <div>
              <div className="text-sm font-medium mb-0.5" style={{ color: colors.text }}>This week&apos;s progress</div>
              <div className="text-sm" style={{ color: colors.muted }}>
                {[
                  stats.weekly.nodesAdded > 0 && `${stats.weekly.nodesAdded} nodes added`,
                  stats.weekly.edits > 0 && `${stats.weekly.edits} nodes edited`,
                  stats.weekly.filesModified > 0 && `${stats.weekly.filesModified} files modified`,
                ].filter(Boolean).join(" \u00b7 ")}
              </div>
            </div>
          </div>
        )}

        {/* Workspaces */}
        <div>
          <h2 className="text-2xl font-bold mb-6" style={{ color: colors.textStrong }}>Workspaces</h2>
          {workspaces.length === 0 && !loadingDocs ? (
            <p className="text-sm" style={{ color: MUTED }}>No workspaces found.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {workspaces.map((ws) => (
                <button
                  key={ws.slug}
                  onClick={() => openWorkspace(ws.slug)}
                  className="group relative overflow-hidden px-5 py-3.5 rounded-2xl transition-all hover:scale-105"
                  style={{ backgroundColor: colors.borderSoft }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.border)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = colors.borderSoft)}
                >
                  <div className="flex items-center gap-3">
                    <Network size={18} style={{ color: colors.muted }} />
                    <span className="font-medium" style={{ color: colors.text }}>{ws.name}</span>
                  </div>
                </button>
              ))}
              <button
                onClick={() => {
                  setHomeCreateOpen((prev) => !prev);
                  setHomeCreateStep("preset");
                  setHomeCreatePreset(null);
                  setHomeCreateName("");
                }}
                className="flex items-center gap-2 px-5 py-3.5 rounded-2xl border-2 border-dashed transition-all hover:scale-105"
                style={{
                  backgroundColor: colors.accentSoft,
                  borderColor: colors.accent,
                  color: colors.accentStrong,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.accent)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = colors.accentSoft)}
              >
                <Plus size={18} />
                <span className="font-medium">New Workspace</span>
              </button>
            </div>
          )}

          {homeCreateOpen && (
            <div
              ref={homeCreateRef}
              className="mt-3 rounded-xl"
              style={{
                backgroundColor: CARD_BG,
                border: `1px solid ${colors.border}`,
                maxWidth: 360,
              }}
            >
              {homeCreateStep === "preset" ? (
                <div className="px-3 pt-3 pb-2">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Choose a type
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(TYPE_PRESETS).map(([key, p]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setHomeCreatePreset(key); setHomeCreateStep("name"); }}
                        className="text-left px-2.5 py-2 rounded-lg w-full"
                        style={{ backgroundColor: "transparent" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex gap-0.5 flex-shrink-0">
                            {Object.values(p.types).map((t, i) => (
                              <span key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                            ))}
                          </div>
                          <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>{p.label}</span>
                        </div>
                        <p className="text-xs mt-0.5 ml-6" style={{ color: "rgba(255,255,255,0.3)" }}>{p.description}</p>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={closeHomeCreate}
                    className="text-xs mt-2 px-1"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createWorkspaceFromHome();
                  }}
                  className="px-3 pt-3 pb-2"
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <button
                      type="button"
                      onClick={() => setHomeCreateStep("preset")}
                      className="text-xs"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      {"\u2190"} Back
                    </button>
                    {homeCreatePreset && (
                      <div className="flex items-center gap-1.5">
                        {Object.values(TYPE_PRESETS[homeCreatePreset]?.types ?? {}).map((t, i) => (
                          <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                        ))}
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                          {TYPE_PRESETS[homeCreatePreset]?.label}
                        </span>
                      </div>
                    )}
                  </div>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Workspace name..."
                    value={homeCreateName}
                    onChange={(e) => setHomeCreateName(e.target.value)}
                    className="w-full bg-transparent outline-none text-sm"
                    style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                    onKeyDown={(e) => { if (e.key === "Escape") closeHomeCreate(); }}
                  />
                  <div className="flex gap-1.5 mt-2.5">
                    <button
                      type="submit"
                      className="text-xs px-2.5 py-1 rounded-md font-medium"
                      style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={closeHomeCreate}
                      className="text-xs px-2.5 py-1 rounded-md"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Recent Documents */}
        <div>
          <h2 className="text-2xl font-bold mb-6" style={{ color: colors.textStrong }}>Recent Documents</h2>
          {loadingDocs ? (
            <p className="text-sm" style={{ color: MUTED }}>Loading&hellip;</p>
          ) : recentDocs.length === 0 ? (
            <p className="text-sm" style={{ color: MUTED }}>No documents yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentDocs.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => openDoc(doc.wsSlug, doc.filename)}
                  className="group relative overflow-hidden rounded-2xl p-5 transition-all hover:scale-[1.02] text-left"
                  style={{
                    backgroundColor: CARD_BG,
                    border: `1px solid ${colors.border}`,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.accent)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.border)}
                >
                  <div
                    className="absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `linear-gradient(to bottom right, ${colors.accentSoft}, transparent)` }}
                  />
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="p-2 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
                          <FileText size={16} style={{ color: "rgba(255,255,255,0.45)" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs truncate mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {pathLabel(doc.wsName, doc.filename)}
                          </div>
                          <div className="font-semibold truncate" style={{ color: "rgba(255,255,255,0.88)" }}>
                            {String(doc.title || "").trim() || humanizeFilename(doc.filename)}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={16} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0, marginLeft: 8 }} />
                    </div>
                    {doc.preview && (
                      <p
                        className="text-sm leading-relaxed mb-4"
                        style={{
                          color: "rgba(255,255,255,0.45)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {doc.preview}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      <Clock size={12} />
                      {timeAgo(doc.mtime)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
/* eslint-disable react-refresh/only-export-components */

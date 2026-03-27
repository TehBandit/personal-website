import { useState, useRef, useEffect, useCallback } from "react";
import { Send, RefreshCw, MessageSquare, BookOpen, ChevronDown, ChevronUp, Loader, AlertCircle, X, Plus, Clock, Trash2, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { NODE_TYPE_CONFIG } from "../constants/nodeTypes.js";

const BG = "#0f0f1a";
const PANEL_BG = "#13131f";
const BORDER = "rgba(255,255,255,0.07)";
const MUTED = "rgba(255,255,255,0.35)";
const TEXT = "rgba(255,255,255,0.85)";

// ---------------------------------------------------------------------------
// Citation card
// ---------------------------------------------------------------------------

function CitationCard({ source, index, onOpenNode }) {
  const cfg = NODE_TYPE_CONFIG[source.nodeType] || NODE_TYPE_CONFIG.character;
  const clickable = !!onOpenNode;
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1"
      onClick={clickable ? () => onOpenNode(source.nodeId) : undefined}
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        border: `1px solid ${BORDER}`,
        cursor: clickable ? "pointer" : "default",
        transition: "background-color 0.15s",
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)") : undefined}
      onMouseLeave={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)") : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
        >
          {index + 1}
        </span>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: cfg.color }}
        />
        <span className="text-sm font-medium truncate" style={{ color: TEXT }}>
          {source.nodeName}
        </span>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: "rgba(255,255,255,0.06)", color: MUTED }}
        >
          {cfg.label}
        </span>
      </div>
      {source.excerpt && (
        <p className="text-xs leading-relaxed pl-6" style={{ color: MUTED }}>
          {source.excerpt}
        </p>
      )}
      {source.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-6">
          {source.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 rounded"
              style={{ backgroundColor: "rgba(96,165,250,0.1)", color: "#93c5fd" }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citations panel (collapsible)
// ---------------------------------------------------------------------------

function CitationsPanel({ sources, onOpenNode }) {
  const [open, setOpen] = useState(true);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs mb-1.5 transition-colors"
        style={{ color: "#93c5fd" }}
      >
        <BookOpen size={11} />
        {sources.length} source{sources.length !== 1 ? "s" : ""}
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {onOpenNode && <span style={{ color: MUTED, fontWeight: 400 }}>&nbsp;· click to open</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {sources.map((src, i) => (
            <CitationCard key={src.nodeId} source={src} index={i} onOpenNode={onOpenNode} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Content rendering — strips markdown bold, formats lists, renders citation superscripts
// ---------------------------------------------------------------------------

/** Strip **bold** and *italic* markers from a string */
function stripBold(str) {
  return str.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
}

/**
 * Render an inline text segment, converting [N] markers to clickable superscripts.
 * Applied per-line after list detection.
 */
function renderInline(text, citations, onOpenNode, key) {
  const parts = text.split(/(\[\d\])/g);
  return (
    <span key={key}>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d)\]$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const source = citations?.[num - 1];
          if (!source) return <span key={i}>{part}</span>;
          return (
            <sup key={i} style={{ lineHeight: 0 }}>
              <button
                onClick={() => onOpenNode?.(source.nodeId)}
                title={`Source: ${source.nodeName}`}
                style={{
                  color: "#93c5fd",
                  fontSize: "0.7em",
                  fontWeight: 600,
                  padding: "0 1px",
                  cursor: onOpenNode ? "pointer" : "default",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                [{num}]
              </button>
            </sup>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

/**
 * Full content renderer: strips bold markers, parses numbered/bullet lists,
 * renders inline citation superscripts.
 */
function renderContent(content, citations, onOpenNode) {
  const lines = stripBold(content).split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Numbered list block
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\d+\.\s+/, "");
        items.push(<li key={i} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i)}</li>);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ paddingLeft: "1.4em", margin: "4px 0", listStyleType: "decimal" }}>
          {items}
        </ol>
      );
      continue;
    }

    // Bullet list block
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s+/, "");
        items.push(<li key={i} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i)}</li>);
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ paddingLeft: "1.4em", margin: "4px 0", listStyleType: "disc" }}>
          {items}
        </ul>
      );
      continue;
    }

    // Blank line → spacing
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} style={{ height: "0.5em" }} />);
      i++;
      continue;
    }

    // Regular text line
    elements.push(
      <div key={`l-${i}`}>
        {renderInline(line, citations, onOpenNode, i)}
      </div>
    );
    i++;
  }

  return <div style={{ lineHeight: "1.6" }}>{elements}</div>;
}

function MessageBubble({ message, onOpenNode }) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming;

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-1`}>
      <div
        className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
        style={
          isUser
            ? {
                backgroundColor: "rgba(96,165,250,0.18)",
                color: TEXT,
                borderBottomRightRadius: "4px",
              }
            : {
                backgroundColor: "rgba(255,255,255,0.05)",
                color: TEXT,
                border: `1px solid ${BORDER}`,
                borderBottomLeftRadius: "4px",
              }
        }
      >
        {isStreaming
          ? <span style={{ whiteSpace: "pre-wrap" }}>{stripBold(message.content)}</span>
          : renderContent(message.content, message.citations, onOpenNode)
        }
        {isStreaming && (
          <span
            className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse"
            style={{ backgroundColor: "#93c5fd", verticalAlign: "text-bottom" }}
          />
        )}
      </div>
      {!isUser && message.citations && (
        <div className="max-w-[85%] w-full">
          <CitationsPanel sources={message.citations} onOpenNode={onOpenNode} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onSend }) {
  const starters = [
    "Who is Sable Voss and what are her motivations?",
    "What factions exist in this world?",
    "Summarize the key locations and their significance.",
    "What conflicts drive the story?",
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <MessageSquare size={32} style={{ color: MUTED }} />
        <p className="text-sm font-medium" style={{ color: TEXT }}>
          Ask anything about your notes
        </p>
        <p className="text-xs" style={{ color: MUTED }}>
          Answers are grounded in your story notes with cited sources.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {starters.map((s) => (
          <button
            key={s}
            onClick={() => onSend(s)}
            className="text-left text-xs px-3 py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: `1px solid ${BORDER}`,
              color: MUTED,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = TEXT;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
              e.currentTarget.style.color = MUTED;
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Index status banner
// ---------------------------------------------------------------------------

function IndexBanner({ workspace, onDismiss }) {
  const [status, setStatus] = useState("idle"); // idle | building | done | error
  const [info, setInfo] = useState(null);

  useEffect(() => {
    fetch(`/api/workspace-embed?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d) => setInfo(d))
      .catch(() => {});
  }, [workspace]);

  const rebuild = useCallback(async () => {
    setStatus("building");
    try {
      const r = await fetch("/api/workspace-embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      const d = await r.json();
      setInfo(d);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
    }
  }, [workspace]);

  if (!info) return null;

  const isMissing = info.status === "missing" || info.status === "corrupt";

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 text-xs"
      style={{ backgroundColor: isMissing ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.03)", borderBottom: `1px solid ${BORDER}` }}
    >
      {isMissing ? (
        <>
          <AlertCircle size={12} style={{ color: "#fbbf24", flexShrink: 0 }} />
          <span style={{ color: "#fbbf24" }}>Knowledge index not built yet.</span>
          <button
            onClick={rebuild}
            disabled={status === "building"}
            className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors"
            style={{ backgroundColor: "rgba(251,191,36,0.15)", color: "#fbbf24" }}
          >
            {status === "building" ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {status === "building" ? "Building…" : "Build index"}
          </button>
        </>
      ) : (
        <>
          <span style={{ color: MUTED }}>
            {info.chunks} chunks indexed
            {info.builtAt ? ` · ${new Date(info.builtAt).toLocaleDateString()}` : ""}
          </span>
          <button
            onClick={rebuild}
            disabled={status === "building"}
            className="flex items-center gap-1 ml-auto transition-colors"
            style={{ color: status === "done" ? "#4ade80" : MUTED }}
            title="Rebuild index"
          >
            {status === "building" ? (
              <Loader size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            {status === "done" ? "Rebuilt" : status === "building" ? "Rebuilding…" : "Rebuild"}
          </button>
          <button onClick={onDismiss} style={{ color: MUTED, marginLeft: "4px" }} title="Dismiss">
            <X size={11} />
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session storage helpers
// ---------------------------------------------------------------------------

const SESSIONS_KEY = (workspace) => `storygraph-chat-sessions-${workspace}`;
const MAX_SESSIONS = 30;

function loadSessions(workspace) {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY(workspace));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(workspace, sessions) {
  try { localStorage.setItem(SESSIONS_KEY(workspace), JSON.stringify(sessions)); } catch {}
}

function createSession() {
  return { id: `s_${Date.now()}`, title: null, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
}

function deriveTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const t = first.content.trim();
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Session sidebar
// ---------------------------------------------------------------------------

function SessionSidebar({ sessions, activeId, onSelect, onNew, onDelete }) {
  return (
    <div
      className="flex flex-col w-52 flex-shrink-0 border-r overflow-hidden"
      style={{ backgroundColor: "#0c0c18", borderColor: BORDER }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: BORDER }}
      >
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>History</span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors"
          style={{ backgroundColor: "rgba(96,165,250,0.12)", color: "#93c5fd" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.22)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.12)")}
          title="New chat"
        >
          <Plus size={11} /> New
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && (
          <p className="text-xs px-3 py-4 text-center" style={{ color: "rgba(255,255,255,0.2)" }}>No sessions yet</p>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className="group flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors"
              style={{ backgroundColor: isActive ? "rgba(96,165,250,0.1)" : "transparent" }}
              onClick={() => onSelect(s.id)}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <MessageSquare size={12} style={{ color: isActive ? "#93c5fd" : MUTED, flexShrink: 0, marginTop: "2px" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" style={{ color: isActive ? TEXT : "rgba(255,255,255,0.6)" }}>
                  {s.title || "New chat"}
                </p>
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {formatRelativeTime(s.updatedAt)}
                </p>
              </div>
              <button
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                style={{ color: MUTED }}
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WorkspaceChat component
// ---------------------------------------------------------------------------

export default function WorkspaceChat({ workspace, onOpenNode }) {
  // Session state
  const [sessions, setSessions] = useState(() => loadSessions(workspace));
  const [activeId, setActiveId] = useState(() => {
    const s = loadSessions(workspace);
    return s.length > 0 ? s[0].id : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Chat state
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [showBanner, setShowBanner] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Derive active session and its messages
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const messages = activeSession?.messages ?? [];

  // Persist sessions to localStorage whenever they change
  useEffect(() => {
    saveSessions(workspace, sessions);
  }, [workspace, sessions]);

  // Reset when workspace changes
  useEffect(() => {
    const s = loadSessions(workspace);
    setSessions(s);
    setActiveId(s.length > 0 ? s[0].id : null);
  }, [workspace]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update messages on the active session
  const updateMessages = useCallback((updater) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      const next = typeof updater === "function" ? updater(s.messages) : updater;
      const title = s.title ?? deriveTitle(next);
      return { ...s, messages: next, title, updatedAt: Date.now() };
    }));
  }, [activeId]);

  // Ensure an active session exists (create one lazily on first message)
  const ensureSession = useCallback(() => {
    if (activeId && sessions.find((s) => s.id === activeId)) return activeId;
    const s = createSession();
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
    return s.id;
  }, [activeId, sessions]);

  const newSession = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    const s = createSession();
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const selectSession = useCallback((id) => {
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    setActiveId(id);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activeId]);

  const sendMessage = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? input).trim();
      if (!text || sending) return;

      ensureSession();

      setError(null);
      setInput("");
      setSending(true);

      const userMsg = { role: "user", content: text };
      let currentMessages;
      setSessions((prev) => {
        const session = prev.find((s) => s.id === activeId) ?? prev[0];
        currentMessages = [...(session?.messages ?? []), userMsg];
        return prev.map((s) => {
          if (s.id !== (session?.id ?? activeId)) return s;
          const title = s.title ?? deriveTitle(currentMessages);
          return { ...s, messages: currentMessages, title, updatedAt: Date.now() };
        });
      });

      // Add streaming placeholder
      const assistantIdx = (currentMessages ?? [userMsg]).length;
      updateMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true, citations: null }]);

      const payload = (currentMessages ?? [userMsg]).map(({ role, content }) => ({ role, content }));

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/workspace-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace, messages: payload }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Request failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accContent = "";
        let finalCitations = null;

        const flush = (line) => {
          if (!line.startsWith("data: ")) return;
          let parsed;
          try { parsed = JSON.parse(line.slice(6)); } catch { return; }

          if (parsed.type === "token") {
            accContent += parsed.content;
            updateMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { ...next[assistantIdx], content: accContent };
              return next;
            });
          } else if (parsed.type === "correction") {
            accContent = parsed.content;
            updateMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { ...next[assistantIdx], content: accContent };
              return next;
            });
          } else if (parsed.type === "citations") {
            finalCitations = parsed.sources;
          } else if (parsed.type === "error") {
            throw new Error(parsed.message);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) { if (line.trim()) flush(line); }
        }
        if (buffer.trim()) flush(buffer);

        updateMessages((prev) => {
          const next = [...prev];
          next[assistantIdx] = { role: "assistant", content: accContent, streaming: false, citations: finalCitations };
          return next;
        });
      } catch (err) {
        if (err.name === "AbortError") {
          updateMessages((prev) => {
            const next = [...prev];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
            return next;
          });
        } else {
          setError(err.message || "Something went wrong");
          updateMessages((prev) => prev.filter((_, i) => i !== assistantIdx));
        }
      } finally {
        setSending(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [input, sending, workspace, activeId, ensureSession, updateMessages]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="flex flex-1 overflow-hidden min-h-0" style={{ backgroundColor: BG }}>

      {/* Session sidebar */}
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={selectSession}
          onNew={newSession}
          onDelete={deleteSession}
        />
      )}

      {/* Main chat area */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">

        {/* Top bar */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
          style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
        >
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1 rounded transition-colors"
            style={{ color: MUTED }}
            onMouseEnter={(e) => (e.currentTarget.style.color = TEXT)}
            onMouseLeave={(e) => (e.currentTarget.style.color = MUTED)}
            title={sidebarOpen ? "Hide history" : "Show history"}
          >
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>

          <span className="text-sm font-medium truncate flex-1" style={{ color: TEXT }}>
            {activeSession?.title ?? "New chat"}
          </span>

          <button
            onClick={newSession}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors flex-shrink-0"
            style={{ backgroundColor: "rgba(96,165,250,0.12)", color: "#93c5fd" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.22)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.12)")}
          >
            <Plus size={11} /> New chat
          </button>
        </div>

        {/* Index status banner */}
        {showBanner && (
          <IndexBanner workspace={workspace} onDismiss={() => setShowBanner(false)} />
        )}

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 min-h-0">
          {messages.length === 0 ? (
            <EmptyState onSend={(t) => sendMessage(t)} />
          ) : (
            messages.map((msg, i) => <MessageBubble key={i} message={msg} onOpenNode={onOpenNode} />)
          )}
          {error && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}
            >
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div
          className="flex-shrink-0 flex flex-col gap-2 px-4 py-3 border-t"
          style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
        >
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{ backgroundColor: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}` }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your story…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
              style={{ color: TEXT, caretColor: "#60a5fa", maxHeight: "120px", overflowY: "auto" }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              disabled={sending}
            />
            {sending ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}
                title="Stop"
              >
                <X size={14} />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                style={{
                  backgroundColor: input.trim() ? "rgba(96,165,250,0.2)" : "transparent",
                  color: input.trim() ? "#93c5fd" : MUTED,
                }}
                title="Send (Enter)"
              >
                <Send size={14} />
              </button>
            )}
          </div>
          <p className="text-[10px] text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
            Answers are generated by GPT-4o and grounded in your story notes.
          </p>
        </div>
      </div>
    </div>
  );
}

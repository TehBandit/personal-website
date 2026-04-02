import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, RefreshCw, BookOpen, ChevronDown, ChevronUp, Loader, AlertCircle, X, Trash2, PanelLeftOpen, PanelLeftClose, Network, SquarePen, Copy, Check, Pencil } from "lucide-react";
import { NODE_TYPE_CONFIG } from "../constants/nodeTypes.js";

const BG = "#0a0a14";
const SIDEBAR_BG = "#0c0c18";
const PANEL_BG = "#0f0f1a";
const BUBBLE_BG = "#161624";
const BORDER = "rgba(255,255,255,0.07)";
const BORDER_MED = "rgba(255,255,255,0.1)";
const MUTED = "rgba(255,255,255,0.35)";
const TEXT = "rgba(255,255,255,0.88)";
const ACCENT = "#60a5fa";
const ACCENT_DIM = "rgba(96,165,250,0.15)";

// ---------------------------------------------------------------------------
// Graph query analysis — detect structural questions and answer from graph data
// ---------------------------------------------------------------------------

// Keywords that strongly indicate a graph-structure question (not a note-content question)
const GRAPH_KEYWORDS = [
  "neighbor", "neighbour",
  "on the graph", "in the graph", "graph structure",
  "path between", "path from", "path to",
  "degrees of separation", "how many hops",
  "directly connected", "direct connection",
  "connect to", "connects to", "connected to",
  "relate to", "related to", "relationship between",
  "link between", "linked to",
  "adjacent",
];

function getNodeNeighbors(nodeId, graphData) {
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const nodes = [];
  const labels = {};
  for (const link of graphData.links) {
    const src = typeof link.source === "object" ? link.source.id : link.source;
    const tgt = typeof link.target === "object" ? link.target.id : link.target;
    const nbId = src === nodeId && nodeMap.has(tgt) ? tgt
                : tgt === nodeId && nodeMap.has(src) ? src
                : null;
    if (nbId && !seen.has(nbId)) {
      seen.add(nbId);
      nodes.push(nodeMap.get(nbId));
      labels[nbId] = link.label || "";
    }
  }
  return { nodes, labels };
}

function graphBFS(fromId, toId, graphData) {
  const adj = new Map();
  for (const link of graphData.links) {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s).push(t);
    adj.get(t).push(s);
  }
  const prev = new Map();
  const visited = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) break;
    for (const nb of (adj.get(cur) || [])) {
      if (!visited.has(nb)) { visited.add(nb); prev.set(nb, cur); queue.push(nb); }
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  let cur = toId;
  while (cur !== undefined) { path.unshift(cur); cur = prev.get(cur); }
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));
  return path.map((id) => nodeMap.get(id)).filter(Boolean);
}

/**
 * Returns a graph query result object, or null if the query is not graph-structural.
 * { type, focusNode, neighborNodes, pathNodes, linkLabels, answer }
 */
function analyzeGraphQuery(text, graphData) {
  if (!graphData?.nodes?.length) return null;
  const lower = text.toLowerCase();

  if (!GRAPH_KEYWORDS.some((k) => lower.includes(k))) return null;

  // Find mentioned node names — longer names first to avoid partial-match preference
  const mentioned = graphData.nodes
    .filter((n) => lower.includes(n.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);

  if (mentioned.length === 0) return null;

  const primary = mentioned[0];

  // Path query: 2+ nodes AND a path-related keyword
  // "how does/is" is allowed here (broad) since we already require 2 named nodes
  const pathKeywords = ["path", "hops", "degrees", "connect", "relate", "link", "how does", "how is", "how are"];
  if (
    mentioned.length >= 2 &&
    pathKeywords.some((k) => lower.includes(k))
  ) {
    const secondary = mentioned[1];
    const pathNodes = graphBFS(primary.id, secondary.id, graphData);
    if (!pathNodes) {
      return {
        type: "no-path",
        focusNode: primary,
        neighborNodes: [],
        pathNodes: [],
        linkLabels: {},
        answer: `There is no path connecting ${primary.name} and ${secondary.name} in the graph.`,
      };
    }
    const hops = pathNodes.length - 1;
    return {
      type: "path",
      focusNode: primary,
      neighborNodes: [],
      pathNodes,
      linkLabels: {},
      answer: `There is a path of ${hops} hop${hops !== 1 ? "s" : ""} from ${primary.name} to ${secondary.name}:\n\n${pathNodes.map((n) => n.name).join(" → ")}`,
    };
  }

  // Neighbors query
  const { nodes, labels } = getNodeNeighbors(primary.id, graphData);
  if (nodes.length === 0) {
    return {
      type: "neighbors",
      focusNode: primary,
      neighborNodes: [],
      pathNodes: [],
      linkLabels: {},
      answer: `${primary.name} has no direct connections in the graph.`,
    };
  }
  const list = nodes
    .map((n) => `- ${n.name} (${n.type})${labels[n.id] ? ` — ${labels[n.id]}` : ""}`)
    .join("\n");
  return {
    type: "neighbors",
    focusNode: primary,
    neighborNodes: nodes,
    pathNodes: [],
    linkLabels: labels,
    answer: `${primary.name} has ${nodes.length} direct connection${nodes.length !== 1 ? "s" : ""} on the graph:\n\n${list}`,
  };
}

// ---------------------------------------------------------------------------
// GraphMinimap — inline SVG subgraph for graph query responses
// ---------------------------------------------------------------------------

function GraphMinimap({ graphResult, graphData, onOpenNode, onShowPath }) {
  if (!graphData || !graphResult) return null;
  const { type, focusNodeId, nodeIds, linkLabels } = graphResult;
  const truncate = (s, max) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  const W = 296;

  if (type === "neighbors") {
    const focusNode = graphData.nodes.find((n) => n.id === focusNodeId);
    if (!focusNode || nodeIds.length === 0) return null;
    const displayNodes = nodeIds.map((id) => graphData.nodes.find((n) => n.id === id)).filter(Boolean);
    const N = displayNodes.length;
    const H = Math.max(180, 150 + N * 6);
    const cx = W / 2, cy = H / 2;
    const R = N <= 3 ? 58 : N <= 6 ? 70 : N <= 9 ? 80 : 88;
    const focusCfg = NODE_TYPE_CONFIG[focusNode.type] || NODE_TYPE_CONFIG.character;

    const positions = displayNodes.map((node, i) => {
      const angle = (2 * Math.PI * i / N) - Math.PI / 2;
      return { node, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
    });

    return (
      <div style={{ marginTop: "8px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(8,8,18,0.85)" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* Edges */}
          {positions.map(({ node, x, y }) => (
            <line key={`e-${node.id}`} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
          ))}
          {/* Edge relationship labels at midpoints */}
          {positions.map(({ node, x, y }) => {
            const lbl = linkLabels?.[node.id];
            if (!lbl) return null;
            return (
              <text key={`el-${node.id}`} x={(cx + x) / 2} y={(cy + y) / 2 - 3} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6.5" style={{ pointerEvents: "none" }}>
                {truncate(lbl, 14)}
              </text>
            );
          })}
          {/* Center focus node */}
          <g onClick={() => onOpenNode?.(focusNode.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
            <circle cx={cx} cy={cy} r={11} fill={focusCfg.color} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
            <text x={cx} y={cy + 23} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="8.5" fontWeight="600" style={{ pointerEvents: "none" }}>
              {truncate(focusNode.name, 16)}
            </text>
          </g>
          {/* Neighbor nodes */}
          {positions.map(({ node, x, y }) => {
            const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
            const isTop = y < cy - 10, isBottom = y > cy + 10;
            const isLeft = x < cx - 15, isRight = x > cx + 15;
            let lx, ly, la;
            if (isTop && !isLeft && !isRight)  { lx = x;      ly = y - 12; la = "middle"; }
            else if (isBottom && !isLeft && !isRight) { lx = x; ly = y + 19; la = "middle"; }
            else if (isLeft)  { lx = x - 11; ly = y + 3;  la = "end";    }
            else if (isRight) { lx = x + 11; ly = y + 3;  la = "start";  }
            else              { lx = x;      ly = y + 19; la = "middle"; }
            return (
              <g key={node.id} onClick={() => onOpenNode?.(node.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
                <circle cx={x} cy={y} r={6.5} fill={cfg.color} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                <text x={lx} y={ly} textAnchor={la} fill="rgba(255,255,255,0.62)" fontSize="8" style={{ pointerEvents: "none" }}>
                  {truncate(node.name, 14)}
                </text>
              </g>
            );
          })}
        </svg>
        {onShowPath && (
          <div style={{ padding: "4px 8px 6px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => onShowPath(graphResult)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.4)", backgroundColor: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#93c5fd"; e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <Network size={9} />
              Show on graph
            </button>
          </div>
        )}
      </div>
    );
  }

  if (type === "path") {
    const pathNodes = nodeIds.map((id) => graphData.nodes.find((n) => n.id === id)).filter(Boolean);
    if (pathNodes.length < 2) return null;
    const N = pathNodes.length;
    const H = 88;
    const pad = 28;
    const innerW = W - 2 * pad;
    const gap = N > 1 ? innerW / (N - 1) : 0;
    const cy = 38;
    return (
      <div style={{ marginTop: "8px", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(8,8,18,0.85)" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {pathNodes.slice(0, -1).map((_, i) => (
            <line key={`pe-${i}`} x1={pad + i * gap} y1={cy} x2={pad + (i + 1) * gap} y2={cy} stroke="rgba(251,191,36,0.35)" strokeWidth="1.5" />
          ))}
          {pathNodes.map((node, i) => {
            const x = pad + i * gap;
            const isEndpoint = i === 0 || i === N - 1;
            const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
            return (
              <g key={node.id} onClick={() => onOpenNode?.(node.id)} style={{ cursor: onOpenNode ? "pointer" : "default" }}>
                <circle cx={x} cy={cy} r={isEndpoint ? 8 : 6} fill={cfg.color} stroke={isEndpoint ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.12)"} strokeWidth={isEndpoint ? 2 : 1} />
                <text x={x} y={cy + 20} textAnchor="middle" fill={isEndpoint ? "rgba(253,230,138,0.85)" : "rgba(255,255,255,0.58)"} fontSize="7.5" fontWeight={isEndpoint ? "600" : "400"} style={{ pointerEvents: "none" }}>
                  {truncate(node.name, 12)}
                </text>
              </g>
            );
          })}
        </svg>
        {onShowPath && (
          <div style={{ padding: "4px 8px 6px", display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => onShowPath(graphResult)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.4)", backgroundColor: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#93c5fd"; e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <Network size={9} />
              Show on graph
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Citation card
// ---------------------------------------------------------------------------

function CitationCard({ source, index, onOpenNode }) {
  const cfg = NODE_TYPE_CONFIG[source.nodeType] || NODE_TYPE_CONFIG.character;
  const clickable = !!onOpenNode;
  return (
    <button
      onClick={clickable ? () => onOpenNode(source.nodeId) : undefined}
      disabled={!clickable}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left w-full transition-colors"
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        border: `1px solid ${BORDER}`,
        cursor: clickable ? "pointer" : "default",
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)") : undefined}
      onMouseLeave={clickable ? (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)") : undefined}
    >
      <span
        className="text-[10px] font-bold rounded w-4 h-4 flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: ACCENT_DIM, color: ACCENT }}
      >
        {index + 1}
      </span>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
      <span className="text-xs truncate flex-1" style={{ color: TEXT }}>{source.nodeName}</span>
      <span className="text-[10px] flex-shrink-0" style={{ color: MUTED }}>{cfg.label}</span>
    </button>
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
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
        style={{
          color: ACCENT,
          backgroundColor: open ? ACCENT_DIM : "transparent",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.backgroundColor = ACCENT_DIM; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        <BookOpen size={11} />
        {sources.length} source{sources.length !== 1 ? "s" : ""}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-1.5">
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
 * Build a lookup object for entity name → nodeId linking in chat text.
 * Mirrors FilesEditor's mentionableEntities logic: canonical name + explicit
 * aliases + auto-partial single words from multi-word names (stop-words excluded).
 * Returns { map, regex } or null when graphData has no nodes.
 */
function buildChatEntities(graphData) {
  if (!graphData?.nodes?.length) return null;
  const STOP_WORDS = new Set([
    "the","and","for","not","but","nor","yet","so","of","in","on","at","to",
    "by","up","as","an","a","or","its","it","he","she","they","his","her",
    "their","our","my","your","who","whom","which","that","this","these",
    "those","from","with","into","onto","upon","over","under","about","after",
    "before","old","new","one","two","three","four","five","six","seven",
  ]);
  const seen = new Set();
  const list = [];
  for (const node of graphData.nodes) {
    const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
    const push = (name) => {
      const key = name.toLowerCase();
      if (seen.has(key) || !name.trim()) return;
      seen.add(key);
      list.push({ name, nodeId: node.id, color: cfg.color });
    };
    push(node.name);
    for (const alias of (node.aliases || [])) push(alias);
    const words = node.name.trim().split(/\s+/);
    if (words.length > 1) {
      for (const w of words) {
        if (w.length > 2 && !STOP_WORDS.has(w.toLowerCase())) push(w);
      }
    }
  }
  list.sort((a, b) => b.name.length - a.name.length);
  const map = new Map(list.map((e) => [e.name.toLowerCase(), e]));
  const escaped = list.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  return { map, regex };
}

/**
 * Render an inline text segment, converting [N] markers to clickable superscripts
 * and entity names to clickable node links.
 */
function renderInline(text, citations, onOpenNode, key, entityData) {
  const parts = text.split(/(\[\d\])/g);

  const linkifyPlain = (str, baseKey) => {
    if (!entityData || !onOpenNode || !str) return str;
    const { map, regex } = entityData;
    regex.lastIndex = 0;
    const segments = [];
    let last = 0;
    let m;
    while ((m = regex.exec(str)) !== null) {
      if (m.index > last) segments.push(str.slice(last, m.index));
      const entity = map.get(m[0].toLowerCase());
      if (entity) {
        segments.push(
          <button
            key={`${baseKey}-el-${m.index}`}
            onClick={() => onOpenNode(entity.nodeId)}
            title={entity.name}
            style={{
              color: entity.color,
              textDecoration: "underline",
              textUnderlineOffset: "2px",
              cursor: "pointer",
              fontWeight: 500,
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
            }}
          >
            {m[0]}
          </button>
        );
      } else {
        segments.push(m[0]);
      }
      last = regex.lastIndex;
    }
    if (last < str.length) segments.push(str.slice(last));
    return segments.length ? segments : str;
  };

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
        const linked = linkifyPlain(part, i);
        return <span key={i}>{linked}</span>;
      })}
    </span>
  );
}

/**
 * Full content renderer: strips bold markers, parses numbered/bullet lists,
 * renders inline citation superscripts.
 */
function renderContent(content, citations, onOpenNode, entityData) {
  const lines = stripBold(content).split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Numbered list block
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const numMatch = lines[i].match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          const text = numMatch[2];
          items.push(<li key={i} value={num} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i, entityData)}</li>);
          i++;
        } else if (lines[i].trim() === "" && i + 1 < lines.length && /^\d+\.\s/.test(lines[i + 1])) {
          // blank line between list items — skip it and stay in the list
          i++;
        } else {
          break;
        }
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
        items.push(<li key={i} style={{ marginBottom: "2px" }}>{renderInline(text, citations, onOpenNode, i, entityData)}</li>);
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
        {renderInline(line, citations, onOpenNode, i, entityData)}
      </div>
    );
    i++;
  }

  return <div style={{ lineHeight: "1.6" }}>{elements}</div>;
}

function MessageBubble({ message, onOpenNode, graphData, onRegenerate, onEditSubmit, isLast, onShowPath }) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming;
  const isThinking = isStreaming && message.content === "";

  const entityData = useMemo(() => buildChatEntities(graphData), [graphData]);

  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const editRef = useRef(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const startEdit = () => {
    setEditText(message.content);
    setEditing(true);
    setTimeout(() => {
      if (editRef.current) {
        editRef.current.style.height = "auto";
        editRef.current.style.height = `${editRef.current.scrollHeight}px`;
        editRef.current.focus();
      }
    }, 0);
  };

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) onEditSubmit(trimmed);
    setEditing(false);
  };

  // Format timestamp
  const ts = message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Content */}
      <div className={`flex flex-col gap-1 min-w-0 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>

        {/* Bubble */}
        {editing ? (
          <div className="flex flex-col gap-2 w-full">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none outline-none"
              style={{
                backgroundColor: ACCENT_DIM,
                color: TEXT,
                border: `1px solid rgba(96,165,250,0.35)`,
                borderBottomRightRadius: "6px",
                lineHeight: "1.65",
                minWidth: "220px",
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditing(false)}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}` }}
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: "#fff", backgroundColor: ACCENT }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl text-sm"
            style={isUser
              ? {
                  backgroundColor: ACCENT_DIM,
                  color: TEXT,
                  border: `1px solid rgba(96,165,250,0.18)`,
                  borderBottomRightRadius: "6px",
                  padding: "12px 16px",
                }
              : {
                  backgroundColor: BUBBLE_BG,
                  color: TEXT,
                  border: `1px solid ${BORDER}`,
                  borderBottomLeftRadius: "6px",
                  lineHeight: "1.65",
                  overflow: "hidden",
                }
            }
          >
            {/* Assistant top action bar */}
            {!isUser && !isThinking && !isStreaming && (
              <div
                className="flex items-center gap-1 px-3 pt-2 pb-1 transition-opacity"
                style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
              >
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors"
                  style={{ color: copied ? "#4ade80" : MUTED, backgroundColor: "rgba(255,255,255,0.05)" }}
                  title="Copy"
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                {isLast && onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors"
                    style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.05)" }}
                    title="Regenerate response"
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                )}
                {ts && (
                  <span className="text-[10px] ml-auto" style={{ color: "rgba(255,255,255,0.18)" }}>{ts}</span>
                )}
              </div>
            )}

            {/* Message body */}
            <div className={!isUser && !isThinking && !isStreaming ? "px-4 pb-3" : "px-4 py-3"}>
              {isThinking ? (
                <span className="flex items-center gap-1.5" style={{ color: MUTED }}>
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="inline-block w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ backgroundColor: MUTED, animationDelay: `${i * 150}ms`, animationDuration: "900ms" }}
                      />
                    ))}
                  </span>
                  <span className="text-xs">Thinking…</span>
                </span>
              ) : isStreaming ? (
                <>
                  <span style={{ whiteSpace: "pre-wrap" }}>{stripBold(message.content)}</span>
                  <span
                    className="inline-block w-1 h-3.5 ml-0.5 rounded-sm animate-pulse"
                    style={{ backgroundColor: ACCENT, verticalAlign: "text-bottom", opacity: 0.7 }}
                  />
                </>
              ) : (
                renderContent(message.content, message.citations, onOpenNode, entityData)
              )}
            </div>

            {/* Citations flush inside the card */}
            {!isUser && message.citations && message.citations.length > 0 && (
              <div className="border-t px-4 pt-2 pb-3" style={{ borderColor: BORDER }}>
                <CitationsPanel sources={message.citations} onOpenNode={onOpenNode} />
              </div>
            )}
          </div>
        )}

        {/* User edit / timestamp action row */}
        {!editing && !isStreaming && isUser && (
          <div
            className="flex items-center gap-1 transition-opacity"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
          >
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg transition-colors"
              style={{ color: MUTED, backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}` }}
              title="Edit message"
            >
              <Pencil size={10} /> Edit
            </button>
            {ts && (
              <span className="text-[10px] px-1" style={{ color: "rgba(255,255,255,0.18)" }}>{ts}</span>
            )}
          </div>
        )}

        {/* Graph minimap */}
        {!isUser && message.graphResult && (
          <GraphMinimap graphResult={message.graphResult} graphData={graphData} onOpenNode={onOpenNode} onShowPath={onShowPath} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onSend, graphData }) {
  // Find the most-connected character to suggest a graph query
  let graphStarter = null;
  if (graphData?.nodes?.length) {
    const degMap = new Map();
    for (const link of graphData.links || []) {
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      degMap.set(s, (degMap.get(s) || 0) + 1);
      degMap.set(t, (degMap.get(t) || 0) + 1);
    }
    let best = null, bestDeg = 0;
    for (const node of graphData.nodes) {
      if (node.type === "character") {
        const deg = degMap.get(node.id) || 0;
        if (deg > bestDeg) { bestDeg = deg; best = node; }
      }
    }
    if (best) graphStarter = `Who are ${best.name}'s direct neighbors on the graph?`;
  }

  const starters = [
    graphStarter,
    "Who is Sable Voss and what are her motivations?",
    "What factions exist in this world?",
    "Summarize the key locations and their significance.",
    "What conflicts drive the story?",
  ].filter(Boolean).slice(0, 5);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: "rgba(96,165,250,0.1)", border: `1px solid rgba(96,165,250,0.2)` }}
        >
          <Network size={22} style={{ color: ACCENT }} />
        </div>
        <div>
          <p className="text-base font-semibold" style={{ color: TEXT }}>Ask about your world</p>
          <p className="text-xs mt-1" style={{ color: MUTED }}>Characters, factions, locations, connections — all grounded in your notes.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
        {starters.map((s) => (
          <button
            key={s}
            onClick={() => onSend(s)}
            className="text-left text-xs px-3.5 py-2.5 rounded-xl transition-colors leading-relaxed"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: `1px solid ${BORDER}`,
              color: "rgba(255,255,255,0.55)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = TEXT;
              e.currentTarget.style.borderColor = BORDER_MED;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
              e.currentTarget.style.color = "rgba(255,255,255,0.55)";
              e.currentTarget.style.borderColor = BORDER;
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
  if (!isMissing) return null; // only show when action is required

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 text-xs flex-shrink-0"
      style={{ backgroundColor: "rgba(251,191,36,0.07)", borderBottom: `1px solid rgba(251,191,36,0.15)` }}
    >
      <AlertCircle size={12} style={{ color: "#fbbf24", flexShrink: 0 }} />
      <span style={{ color: "rgba(253,230,138,0.9)" }}>Knowledge index not built.</span>
      <button
        onClick={rebuild}
        disabled={status === "building"}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ml-1"
        style={{ backgroundColor: "rgba(251,191,36,0.18)", color: "#fbbf24" }}
      >
        {status === "building" ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        {status === "building" ? "Building…" : "Build now"}
      </button>
      <button onClick={onDismiss} className="ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}><X size={11} /></button>
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
      className="flex flex-col w-56 flex-shrink-0 border-r overflow-hidden"
      style={{ backgroundColor: SIDEBAR_BG, borderColor: BORDER }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: BORDER }}
      >
        <span className="text-xs font-semibold" style={{ color: MUTED }}>Chats</span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-xs p-1.5 rounded-lg transition-colors"
          style={{ color: MUTED }}
          onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
          title="New chat"
        >
          <SquarePen size={14} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1.5 flex flex-col gap-0.5 px-2">
        {sessions.length === 0 && (
          <p className="text-xs px-2 py-6 text-center" style={{ color: "rgba(255,255,255,0.2)" }}>No chats yet</p>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ backgroundColor: isActive ? "rgba(96,165,250,0.1)" : "transparent" }}
              onClick={() => onSelect(s.id)}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" style={{ color: isActive ? TEXT : "rgba(255,255,255,0.55)" }}>
                  {s.title || "New chat"}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.22)" }}>
                  {formatRelativeTime(s.updatedAt)}
                </p>
              </div>
              <button
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                style={{ color: "rgba(255,255,255,0.3)" }}
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

export default function WorkspaceChat({ workspace, onOpenNode, graphData = null, chatFocusNode = null, onShowPath = null, pendingQuestion = null, onPendingConsumed = null }) {
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
  const [atBottom, setAtBottom] = useState(true);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const sendMessageRef = useRef(null);

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

  // Smart auto-scroll: only scroll to bottom when user is already near the bottom
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, atBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

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

  // Regenerate: drop the last assistant message and re-send the last user message
  const regenerate = useCallback(() => {
    const msgs = activeSession?.messages ?? [];
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const userText = msgs[lastUserIdx].content;
    updateMessages(() => msgs.slice(0, lastUserIdx));
    setTimeout(() => sendMessageRef.current?.(userText), 0);
  }, [activeSession, updateMessages]);

  // Edit user message: trim history to just before that message index, then resend
  const editMessage = useCallback((msgIndex, newText) => {
    updateMessages((prev) => prev.slice(0, msgIndex));
    setTimeout(() => sendMessageRef.current?.(newText), 0);
  }, [updateMessages]);

  const sendMessage = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? input).trim();
      if (!text || sending) return;

      ensureSession();

      setError(null);
      setInput("");
      setSending(true);

      const userMsg = { role: "user", content: text, createdAt: Date.now() };

      // Intercept graph structural queries — answer directly from graph data without the API
      const graphAnalysis = graphData ? analyzeGraphQuery(text, graphData) : null;
      if (graphAnalysis) {
        const assistantMsg = {
          role: "assistant",
          content: graphAnalysis.answer,
          streaming: false,
          citations: null,
          graphResult: {
            type: graphAnalysis.type,
            focusNodeId: graphAnalysis.focusNode.id,
            // path: all nodes in order (incl. endpoints); neighbors: neighbor IDs only
            nodeIds: [
              ...(graphAnalysis.pathNodes || []).map((n) => n.id),
              ...(graphAnalysis.neighborNodes || []).map((n) => n.id),
            ],
            linkLabels: graphAnalysis.linkLabels || {},
          },
        };
        setSessions((prev) => {
          const session = prev.find((s) => s.id === activeId) ?? prev[0];
          const newMsgs = [...(session?.messages ?? []), userMsg, assistantMsg];
          const title = session?.title ?? deriveTitle(newMsgs);
          return prev.map((s) => {
            if (s.id !== (session?.id ?? activeId)) return s;
            return { ...s, messages: newMsgs, title, updatedAt: Date.now() };
          });
        });
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      // Derive currentMessages synchronously from the sessions closure.
      // sendMessage is recreated whenever sessions changes (via the ensureSession dep chain),
      // so sessions here is always fresh — we do NOT rely on the setSessions updater
      // side-effect, which runs asynchronously after React's batch flush and would
      // leave currentMessages undefined when assistantIdx is computed below.
      const snapSession = sessions.find((s) => s.id === activeId) ?? sessions[0];
      const currentMessages = [...(snapSession?.messages ?? []), userMsg];

      setSessions((prev) => {
        const session = prev.find((s) => s.id === (snapSession?.id ?? activeId)) ?? prev[0];
        const msgs = [...(session?.messages ?? []), userMsg];
        return prev.map((s) => {
          if (s.id !== session?.id) return s;
          return { ...s, messages: msgs, title: s.title ?? deriveTitle(msgs), updatedAt: Date.now() };
        });
      });

      // Collect node IDs from any recent graph result in this session (last 6 messages)
      // so follow-up questions can draw on the notes for those nodes
      const recentMsgs = activeSession?.messages ?? [];
      const recentGraphResult = [...recentMsgs].reverse().slice(0, 6).find((m) => m.graphResult)?.graphResult;
      const graphNodeIds = recentGraphResult?.nodeIds?.length ? recentGraphResult.nodeIds : null;

      // Collect graph path description for context hint (e.g. "A → B → C")
      let graphPathHint = null;
      if (recentGraphResult && graphData) {
        const pathIds = recentGraphResult.type === "path" ? recentGraphResult.nodeIds : null;
        if (pathIds?.length) {
          const pathNames = pathIds
            .map((id) => graphData.nodes.find((n) => n.id === id)?.name)
            .filter(Boolean);
          if (pathNames.length >= 2) graphPathHint = pathNames.join(" → ");
        }
      }

      // Add streaming placeholder
      const assistantIdx = currentMessages.length;
      updateMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true, citations: null, createdAt: Date.now() }]);

      const payload = currentMessages.map(({ role, content }) => ({ role, content }));

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/workspace-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace,
            messages: payload,
            ...(graphNodeIds ? { graphNodeIds } : {}),
            ...(graphPathHint ? { graphPathHint } : {}),
          }),
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
    [input, sending, workspace, activeId, ensureSession, updateMessages, graphData, sessions]
  );

  // Keep ref in sync so regenerate/editMessage can call the latest sendMessage
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // When a pending question arrives (from detail panel "Ask AI"), create a new session and send.
  // autoSendRef stores { text, sessionId } written by the pendingQuestion effect.
  // A no-dep effect runs after every render; once activeId has committed to match the new
  // session id it fires sendMessage exactly once, then clears itself. StrictMode's second
  // invocation finds the ref already null and returns early.
  const handledPendingRef = useRef(null);
  const autoSendRef = useRef(null); // { text, sessionId }
  useEffect(() => {
    if (!pendingQuestion || pendingQuestion === handledPendingRef.current) return;
    handledPendingRef.current = pendingQuestion;
    onPendingConsumed?.();
    if (abortRef.current) abortRef.current.abort();
    setSending(false);
    setError(null);
    setInput("");
    const s = createSession();
    autoSendRef.current = { text: pendingQuestion, sessionId: s.id };
    setSessions((prev) => [s, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(s.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);
  // No-dep: runs after every render — exits immediately unless the new session is now active.
  useEffect(() => {
    if (!autoSendRef.current) return;
    if (autoSendRef.current.sessionId !== activeId) return;
    const { text } = autoSendRef.current;
    autoSendRef.current = null;
    sendMessageRef.current?.(text);
  });

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
          className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: BORDER, backgroundColor: PANEL_BG }}
        >
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: MUTED }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
            title={sidebarOpen ? "Hide history" : "Show history"}
          >
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>

          <span className="text-sm font-medium truncate flex-1" style={{ color: TEXT }}>
            {activeSession?.title ?? "New chat"}
          </span>

          {/* Focus node context pill */}
          {chatFocusNode && (
            <span
              className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.22)", color: "#93c5fd", maxWidth: "120px" }}
              title={`Context: ${chatFocusNode.name}`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#60a5fa" }} />
              <span className="truncate">{chatFocusNode.name}</span>
            </span>
          )}

          <button
            onClick={newSession}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ color: MUTED }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TEXT; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = "transparent"; }}
            title="New chat"
          >
            <SquarePen size={15} />
          </button>
        </div>

        {/* Index status banner (only when index is missing) */}
        {showBanner && (
          <IndexBanner workspace={workspace} onDismiss={() => setShowBanner(false)} />
        )}

        {/* Message list */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-6 min-h-0 relative"
        >
          {messages.length === 0 ? (
            <EmptyState onSend={(t) => sendMessage(t)} graphData={graphData} />
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={i}
                message={msg}
                onOpenNode={onOpenNode}
                graphData={graphData}
                onShowPath={onShowPath}
                isLast={i === messages.length - 1}
                onRegenerate={msg.role === "assistant" ? regenerate : undefined}
                onEditSubmit={msg.role === "user" ? (newText) => editMessage(i, newText) : undefined}
              />
            ))
          )}
          {error && (
            <div
              className="mx-10 flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#f87171" }}
            >
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}
          <div ref={bottomRef} />

          {/* Scroll-to-bottom button */}
          {!atBottom && (
            <button
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setAtBottom(true); }}
              className="sticky bottom-4 ml-auto flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-all"
              style={{ backgroundColor: BUBBLE_BG, border: `1px solid ${BORDER_MED}`, color: MUTED }}
              title="Scroll to bottom"
            >
              <ChevronDown size={15} />
            </button>
          )}
        </div>

        {/* Input bar */}
        <div
          className="flex-shrink-0 px-4 pb-4 pt-2"
          style={{ backgroundColor: PANEL_BG }}
        >
          <div
            className="flex items-end gap-2 rounded-2xl px-4 py-3"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              border: `1px solid ${BORDER_MED}`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.03) inset",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your story…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
              style={{ color: TEXT, caretColor: ACCENT, maxHeight: "140px", overflowY: "auto" }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              disabled={sending}
            />
            {sending ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}
                title="Stop"
              >
                <X size={14} />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                style={{
                  backgroundColor: input.trim() ? ACCENT : "transparent",
                  color: input.trim() ? "#fff" : MUTED,
                  opacity: input.trim() ? 1 : 0.5,
                }}
                title="Send (Enter)"
              >
                <Send size={14} />
              </button>
            )}
          </div>
          <p className="text-[10px] text-center mt-2" style={{ color: "rgba(255,255,255,0.15)" }}>
            GPT-4o · grounded in your notes
          </p>
        </div>
      </div>
    </div>
  );
}

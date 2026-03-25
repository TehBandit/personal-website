import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import {
  FileText, Plus, Save, Trash2, X, Tag, ChevronRight,
  Folder, FolderOpen, FolderPlus, FilePlus,
  Bold, Italic, List, ListOrdered,
  Heading1, Heading2, Heading3,
  Quote, Code, Minus, Undo, Redo,
  CheckCircle, AlertCircle, Loader, ArrowLeftRight,
  ChevronsDownUp, ChevronsUpDown, Copy, GitMerge,
} from "lucide-react";
import { NODE_TYPE_CONFIG } from "../constants/nodeTypes.js";

const MINIMAP_BG = "#0f0f1a";

function darkenHex(hex, factor = 0.6) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

/**
 * Small interactive ForceGraph2D showing the focal node + its immediate neighbors.
 * Clicking a neighbor node calls onOpen with that node's file path.
 */
function NodeMinimap({ nodeId, graphData, files, onOpen, nodeTransparent = false, nodeBorder = false }) {
  const fgRef = useRef(null);

  // Build the subgraph: focal node + immediate neighbors + connecting links
  const subgraph = useMemo(() => {
    if (!nodeId || !graphData.nodes.length) return { nodes: [], links: [] };

    const focalNode = graphData.nodes.find((n) => n.id === nodeId);
    if (!focalNode) return { nodes: [], links: [] };

    // Collect neighbor IDs from all links touching the focal node
    const neighborIds = new Set();
    for (const link of graphData.links) {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      if (src === nodeId) neighborIds.add(tgt);
      if (tgt === nodeId) neighborIds.add(src);
    }

    const includedIds = new Set([nodeId, ...neighborIds]);

    const nodes = graphData.nodes
      .filter((n) => includedIds.has(n.id))
      .map((n) => ({ ...n })); // clone so force-graph can mutate x/y

    const links = graphData.links
      .filter((link) => {
        const src = typeof link.source === "object" ? link.source.id : link.source;
        const tgt = typeof link.target === "object" ? link.target.id : link.target;
        return includedIds.has(src) && includedIds.has(tgt);
      })
      .map((l) => ({
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
        label: l.label,
      }));

    return { nodes, links };
  }, [nodeId, graphData]);

  // Build a filename lookup so clicks can navigate
  const fileBasenameMap = useMemo(
    () => new Map(files.map((f) => [f.filename.split("/").pop(), f.filename])),
    [files]
  );

  // Mirror ownFileIds logic from StoryGraph: only nodes with a raw source file
  // get their type colour; all others (AI-derived) are gray, matching the main graph.
  const ownFileIds = useMemo(() => {
    const fileSet = new Set(files.map((f) => f.filename));
    const basenames = new Set(files.map((f) => f.filename.split("/").pop()));
    const ids = new Set();
    for (const node of graphData.nodes) {
      // Direct sourceFile match
      if (node.sourceFile && fileSet.has(node.sourceFile)) { ids.add(node.id); continue; }
      // additionalSourceFiles match (merged nodes)
      if ((node.additionalSourceFiles || []).some((sf) => fileSet.has(sf))) { ids.add(node.id); continue; }
      // Stem basename match (hyphen + underscore variants)
      const stemHyphen = node.id.replace(/_/g, "-");
      const stemUnder = node.id;
      if (
        basenames.has(stemHyphen + ".md") || basenames.has(stemHyphen + ".txt") ||
        basenames.has(stemUnder + ".md") || basenames.has(stemUnder + ".txt")
      ) ids.add(node.id);
    }
    return ids;
  }, [files, graphData.nodes]);

  const handleNodeClick = useCallback(
    (node) => {
      if (node.id === nodeId) return; // clicking focal node does nothing
      // Prefer the node's declared sourceFile; fall back to stem-basename matching
      if (node.sourceFile) { onOpen(node.sourceFile); return; }
      const stemHyphen = node.id.replace(/_/g, "-");
      const stemUnder = node.id;
      const fullPath =
        fileBasenameMap.get(stemHyphen + ".md") ?? fileBasenameMap.get(stemHyphen + ".txt") ??
        fileBasenameMap.get(stemUnder + ".md") ?? fileBasenameMap.get(stemUnder + ".txt");
      if (fullPath) onOpen(fullPath);
    },
    [nodeId, fileBasenameMap, onOpen]
  );

  const nodeCanvasObject = useCallback(
    (node, ctx, globalScale) => {
      const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
      const isFocal = node.id === nodeId;
      const isDerived = !ownFileIds.has(node.id);
      const r = isFocal ? 7 : 5;
      const color = isDerived ? "#6b7280" : cfg.color;

      // Glow for focal node
      if (isFocal) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      // Node circle — mirrors main graph outline/border/filled logic
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      if (nodeTransparent) {
        ctx.fillStyle = MINIMAP_BG;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = isFocal ? 2.5 : 1.8;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        if (nodeBorder) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.strokeStyle = darkenHex(color, 0.58);
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Label
      const fontSize = Math.max(11 / globalScale, 3);
      ctx.font = `${isFocal ? 700 : 500} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isFocal ? "#ffffff" : "#94a3b8";
      ctx.fillText(node.name, node.x, node.y + r + fontSize * 0.9);
    },
    [nodeId, ownFileIds, nodeTransparent, nodeBorder]
  );

  const nodePointerAreaPaint = useCallback((node, color, ctx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 11, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  if (!subgraph.nodes.length) return null;

  return (
    <div style={{ height: 320, cursor: "grab" }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={subgraph}
        backgroundColor={MINIMAP_BG}
        width={320}
        height={320}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        onNodeClick={handleNodeClick}
        linkColor={() => "rgba(255,255,255,0.25)"}
        linkWidth={1.5}
        nodeLabel={() => ""}
        cooldownTicks={80}
        onEngineStop={() => fgRef.current?.zoomToFit(300, 60)}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.35}
      />
    </div>
  );
}

// ── Entity-link decoration extension ─────────────────────────────────────────
const entityLinksKey = new PluginKey("entityLinks");

function buildEntityLinksExtension(dataRef) {
  return Extension.create({
    name: "entityLinks",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: entityLinksKey,
          props: {
            decorations(state) {
              const entities = dataRef.current?.entities;
              if (!entities?.length) return DecorationSet.empty;
              const decorations = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const text = node.text;
                const currentFilename = dataRef.current?.currentFilename;
                for (const { name, filename, color } of entities) {
                  // Never link to the file currently open
                  if (currentFilename && filename === currentFilename) continue;
                  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const re = new RegExp(`\\b${escaped}\\b`, "gi");
                  let m;
                  while ((m = re.exec(text)) !== null) {
                    decorations.push(
                      Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                        class: "entity-link",
                        "data-filename": filename,
                        style: `color:${color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:${color}55;`,
                      })
                    );
                  }
                }
              });
              return DecorationSet.create(state.doc, decorations);
            },
            handleDOMEvents: {
              // Intercept mousedown on entity links BEFORE ProseMirror moves
              // the cursor, preventing the cursor transaction that would fire onUpdate.
              mousedown(view, event) {
                const el = event.target;
                if (el?.classList?.contains("entity-link")) {
                  event.preventDefault();
                  const filename = el.getAttribute("data-filename");
                  if (filename) dataRef.current?.onOpen(filename);
                  return true;
                }
                return false;
              },
              mousemove(_view, event) {
                const el = event.target;
                if (el?.classList?.contains("entity-link")) {
                  const filename = el.getAttribute("data-filename");
                  if (filename) dataRef.current?.onHover?.(filename, event.clientX, event.clientY);
                } else {
                  dataRef.current?.onHoverEnd?.();
                }
                return false;
              },
              mouseleave() {
                dataRef.current?.onHoverEnd?.();
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}

// ── Ghost-text autocomplete extension ────────────────────────────────────────
const autocompleteKey = new PluginKey("autocomplete");
const MIN_AUTOCOMPLETE_PREFIX = 2; // chars typed before a suggestion appears

/**
 * Find the best completion for the text immediately before the cursor.
 * Returns { prefixLen, completion } or null.
 * candidates: [{ name, filename, color }]
 */
function computeCompletion(state, candidates) {
  if (!candidates?.length) return null;
  const { selection } = state;
  if (!selection.empty) return null; // don’t suggest while text is selected

  const { from } = selection;
  const textBefore = state.doc.textBetween(Math.max(0, from - 80), from, "\n");
  if (!textBefore) return null;

  const lower = textBefore.toLowerCase();
  let best = null;

  for (const { name } of candidates) {
    if (name.length <= MIN_AUTOCOMPLETE_PREFIX) continue; // must have >0 chars left to complete
    const maxPrefix = Math.min(name.length - 1, textBefore.length);
    for (let prefixLen = maxPrefix; prefixLen >= MIN_AUTOCOMPLETE_PREFIX; prefixLen--) {
      const prefix = name.slice(0, prefixLen).toLowerCase();
      if (!lower.endsWith(prefix)) continue;
      // Require a word boundary before the prefix
      const beforeIdx = textBefore.length - prefixLen - 1;
      const charBefore = beforeIdx >= 0 ? textBefore[beforeIdx] : null;
      if (charBefore !== null && /\w/.test(charBefore)) continue;
      if (!best || prefixLen > best.prefixLen) {
        best = { prefixLen, completion: name.slice(prefixLen) };
      }
      break; // longest-prefix match for this candidate found
    }
  }
  return best;
}

function buildAutocompleteExtension(dataRef) {
  // Shared across addKeyboardShortcuts and addProseMirrorPlugins via closure.
  // decorations() always runs during state updates, keeping this current.
  let lastCompletion = null;

  return Extension.create({
    name: "autocomplete",
    // Higher priority than StarterKit (100) so our Tab handler wins.
    priority: 1000,

    addKeyboardShortcuts() {
      return {
        Tab: ({ editor }) => {
          if (!lastCompletion) return false;
          editor.commands.insertContent(lastCompletion.completion);
          lastCompletion = null;
          return true;
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: autocompleteKey,
          props: {
            decorations(state) {
              const result = computeCompletion(state, dataRef.current?.candidates);
              lastCompletion = result;
              if (!result) return DecorationSet.empty;

              const { from } = state.selection;
              const completionText = result.completion;
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  from,
                  () => {
                    const el = document.createElement("span");
                    el.textContent = completionText;
                    el.setAttribute("data-ghost", "true");
                    el.style.cssText =
                      "color:rgba(255,255,255,0.28);pointer-events:none;user-select:none;";
                    return el;
                  },
                  { side: 1, key: "ac-ghost:" + completionText }
                ),
              ]);
            },
          },
        }),
      ];
    },
  });
}

function ToolbarBtn({ onClick, active, disabled, title, children }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-md transition-colors flex items-center justify-center"
      style={{
        color: active ? "#fff" : disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)",
        backgroundColor: active ? "rgba(96,165,250,0.25)" : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = active ? "rgba(96,165,250,0.25)" : "transparent"; }}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 mx-1 self-center" style={{ backgroundColor: "rgba(255,255,255,0.1)" }} />;
}

// ── Tree helpers (pure, used for optimistic move updates) ─────────────────────
function treeRemoveNode(nodes, targetPath) {
  let removed = null;
  const result = [];
  for (const node of nodes) {
    if (node.path === targetPath) {
      removed = node;
    } else if (node.type === "folder" && node.children) {
      const [r, newChildren] = treeRemoveNode(node.children, targetPath);
      if (r) removed = r;
      result.push({ ...node, children: newChildren });
    } else {
      result.push(node);
    }
  }
  return [removed, result];
}

function treeInsertNode(nodes, node, folderPath) {
  if (!folderPath) return [...nodes, node];
  return nodes.map((n) => {
    if (n.type === "folder" && n.path === folderPath)
      return { ...n, children: [...(n.children || []), node] };
    if (n.type === "folder" && n.children)
      return { ...n, children: treeInsertNode(n.children, node, folderPath) };
    return n;
  });
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FilesEditor({ graphData = { nodes: [], links: [] }, workspace = null, workspaceName = null, workspaces = [], onWorkspaceChange = null, onCreateWorkspace = null, nodeTransparent = false, nodeBorder = false }) {
  const [files, setFiles] = useState([]);
  const [tree, setTree] = useState([]);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const [inlineNew, setInlineNew] = useState(null); // { parentPath, type: "file"|"folder", value }
  const [dragItem, setDragItem] = useState(null);       // { path: string }
  const [dropIndicator, setDropIndicator] = useState(null); // null | { type:"folder"|"line"|"root", path?, position? }
  const [openFile, setOpenFile] = useState(null);   // { filename, content }
  const [folderDeleteModal, setFolderDeleteModal] = useState(null); // { folderPath, filePaths[] } | null

  // Workspace picker state
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [newWsInput, setNewWsInput] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const wsDropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!wsDropdownOpen) return;
    const handler = (e) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target)) {
        setWsDropdownOpen(false);
        setNewWsInput(false);
        setNewWsName("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [wsDropdownOpen]);

  const handleCreateWorkspace = (e) => {
    e.preventDefault();
    onCreateWorkspace?.(newWsName, () => {
      setWsDropdownOpen(false);
      setNewWsInput(false);
      setNewWsName("");
    });
  };
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [propagateMsg, setPropagateMsg] = useState(""); // e.g. "3 files updated"
  const [propagateConfirm, setPropagateConfirm] = useState(null); // { title, oldName, filesAffected, referencesAffected, aliasesAffected } | null
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef(null);
  const entityDataRef = useRef({ entities: [], onOpen: null, onHover: null, onHoverEnd: null, currentFilename: null });
  const lastSavedContentRef = useRef(""); // tracks last-written markdown to skip no-op saves
  const openFileRef = useRef(null);        // always current openFile — safe to read inside onUpdate
  const saveFileRef = useRef(null);        // always current saveFile — safe to call inside onUpdate
  const suppressSaveRef = useRef(false);   // true while loading a file — blocks onUpdate from queueing saves
  const fileCacheRef = useRef({});         // filename → content string (cleared on workspace change)
  const backlinksCache = useRef({});       // filename → backlinks array (cleared on workspace change)

  // ── Entity hover preview tooltip ─────────────────────────────────────────────
  const [entityTooltip, setEntityTooltip] = useState(null); // { node, x, y } | null

  // ── Aliases state ────────────────────────────────────────────────────────────
  const [aliases, setAliases] = useState([]);
  const [aliasInput, setAliasInput] = useState("");
  const aliasInputRef = useRef(null);

  // ── Backlinks ─────────────────────────────────────────────────────────────────
  const [backlinks, setBacklinks] = useState([]); // [{ filename }]
  const [loadingBacklinks, setLoadingBacklinks] = useState(false);

  useEffect(() => {
    if (!openFile || !workspace) { setBacklinks([]); setLoadingBacklinks(false); return; }
    const filename = openFile.filename;
    // Serve from cache instantly — no loading screen on revisit
    const cached = backlinksCache.current[filename];
    if (cached !== undefined) {
      setBacklinks(cached);
      setLoadingBacklinks(false);
    } else {
      setLoadingBacklinks(true);
    }
    // Always refresh in background (silently if served from cache)
    const controller = new AbortController();
    fetch(
      `/api/notes-backlinks?workspace=${encodeURIComponent(workspace)}&filename=${encodeURIComponent(filename)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((d) => {
        const result = d.backlinks || [];
        backlinksCache.current[filename] = result;
        setBacklinks(result);
        setLoadingBacklinks(false);
      })
      .catch(() => { setLoadingBacklinks(false); });
    return () => controller.abort();
  }, [openFile, workspace]);

  // Derive node ID from open filename (e.g. maren-ashveil.md → maren_ashveil)
  // Find the graph node for the currently open file.
  // Primary: match node id derived from filename (notes-raw files).
  // Fallback: match by sourceFile basename (uploaded files whose filename ≠ node id).
  const openNode = useMemo(() => {
    if (!openFile) return null;
    const filename = openFile.filename;
    const basename = filename.split("/").pop();
    const stemId = basename.replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    return (
      // 1. Stem ID match (standard notes-raw files)
      graphData.nodes.find((n) => n.id === stemId) ??
      // 2. Primary sourceFile basename match (derive-uploaded files)
      graphData.nodes.find((n) => n.sourceFile && n.sourceFile.split("/").pop() === basename) ??
      // 3. Full path match against primarySourceFile
      graphData.nodes.find((n) => n.sourceFile === filename) ??
      // 4. Full path match against additionalSourceFiles (merged copies with different names)
      graphData.nodes.find((n) => (n.additionalSourceFiles || []).includes(filename))
    ) ?? null;
  }, [openFile, graphData.nodes]);

  const openNodeId = openNode?.id ?? null;

  // ── Merge state ────────────────────────────────────────────────────────────
  // step: 'search' | 'authority' | 'confirm'
  const [mergeModal, setMergeModal] = useState(null); // null | { query, step, picked?, authorityId? }
  const [mergeStatus, setMergeStatus] = useState(null); // null | { loading } | { error }

  const openMergeModal = () => {
    if (!openNode) return;
    setMergeModal({ query: "", step: "search" });
    setMergeStatus(null);
  };

  const executeMerge = async () => {
    if (!openNode || !workspace || !mergeModal?.picked || !mergeModal?.authorityId) return;
    setMergeStatus({ loading: true });
    const { picked, authorityId } = mergeModal;
    const isOpenAuthority = authorityId === openNode.id;
    const sourceId = isOpenAuthority ? picked.id : openNode.id;
    const targetId = isOpenAuthority ? openNode.id : picked.id;
    try {
      const res = await fetch("/api/notes-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, sourceId, targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      setMergeModal(null);
      setMergeStatus(null);
      if (!isOpenAuthority) setOpenFile(null); // open node was the source — it's been deleted
      // if openNode is authority it survives; graph refreshes via version poll
    } catch (err) {
      setMergeStatus({ error: err.message });
    }
  };

  // Basenames that appear in more than one path (used for sidebar duplicate badge)
  const duplicateBasenames = useMemo(() => {
    const counts = new Map();
    for (const f of files) {
      const bn = f.filename.split("/").pop();
      counts.set(bn, (counts.get(bn) ?? 0) + 1);
    }
    const result = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([bn]) => bn));
    // Also mark files that were merged into the same node (different basenames, same node)
    for (const node of graphData.nodes) {
      if (!node.additionalSourceFiles?.length) continue;
      if (node.sourceFile) result.add(node.sourceFile.split("/").pop());
      for (const sf of node.additionalSourceFiles) result.add(sf.split("/").pop());
    }
    return result;
  }, [files, graphData.nodes]);

  // Files with the same basename as openFile but in a different folder (supplemental copies)
  const supplementalFiles = useMemo(() => {
    if (!openFile) return [];
    const basename = openFile.filename.split("/").pop();
    const seen = new Set([openFile.filename]);
    const result = [];
    // 1. Same basename in a different folder
    for (const f of files) {
      if (!seen.has(f.filename) && f.filename.split("/").pop() === basename) {
        seen.add(f.filename); result.push(f);
      }
    }
    // 2. Files tracked as additionalSourceFiles on the same node (merged copies with different names)
    for (const sf of (openNode?.additionalSourceFiles || [])) {
      if (!seen.has(sf)) {
        const found = files.find((f) => f.filename === sf);
        if (found) { seen.add(sf); result.push(found); }
      }
    }
    // 3. If openFile is itself an additionalSourceFile, find the node's primary sourceFile and other extras
    const matchingNode = graphData.nodes.find(
      (n) => (n.additionalSourceFiles || []).includes(openFile.filename)
    );
    if (matchingNode) {
      for (const sf of [matchingNode.sourceFile, ...(matchingNode.additionalSourceFiles || [])]) {
        if (sf && !seen.has(sf)) {
          const found = files.find((f) => f.filename === sf);
          if (found) { seen.add(sf); result.push(found); }
        }
      }
    }
    return result;
  }, [openFile, files, openNode, graphData.nodes]);

  // Load aliases + title from graphData nodes (already fetched, no extra request needed)
  const [nodeTitle, setNodeTitle] = useState("");
  useEffect(() => {
    if (!openNode) { setAliases([]); setNodeTitle(""); return; }
    setAliases(openNode.aliases || []);
    setNodeTitle(openNode.name ?? "");
  }, [openNode]);

  const saveNodeTitle = useCallback((title) => {
    if (!openFile || !title.trim()) return;
    const trimmed = title.trim();
    const currentName = openNode?.name ?? "";
    if (trimmed === currentName) return;

    const patchUrl = `/api/notes-raw-file?filename=${encodeURIComponent(openFile.filename)}&workspace=${encodeURIComponent(workspace ?? "")}`;

    const commitChange = () => {
      fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, propagate: true }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.filesUpdated) && d.filesUpdated.length > 0) {
            for (const rel of d.filesUpdated) {
              const key = rel.replace(/^[^/]+\//, "");
              delete fileCacheRef.current[rel];
              delete fileCacheRef.current[key];
              delete backlinksCache.current[rel];
              delete backlinksCache.current[key];
            }
            const count = d.filesUpdated.length;
            setPropagateMsg(`${count} file${count === 1 ? "" : "s"} updated`);
            setTimeout(() => setPropagateMsg(""), 3500);
          }
        })
        .catch(() => {});
    };

    // Compute impact client-side — no extra network call needed
    const oldTokens = currentName.split(/\s+/);
    const newTokens = trimmed.split(/\s+/);
    const changedOldTokens = new Set();
    const minLen = Math.min(oldTokens.length, newTokens.length);
    for (let i = 0; i < minLen; i++) {
      if (oldTokens[i] !== newTokens[i]) changedOldTokens.add(oldTokens[i].toLowerCase());
    }

    const aliasesAffected = aliases.filter((a) => changedOldTokens.has(a.toLowerCase())).length;
    const filesAffected = backlinks.length; // backlinks already fetched

    if (aliasesAffected > 0 || filesAffected > 0) {
      setPropagateConfirm({
        title: trimmed,
        oldName: currentName,
        filesAffected,
        aliasesAffected,
        onConfirm: () => { setPropagateConfirm(null); commitChange(); },
        onCancel: () => { setPropagateConfirm(null); setNodeTitle(currentName); },
      });
    } else {
      commitChange();
    }
  }, [openFile, openNode, workspace, aliases, backlinks]);

  const saveAliases = useCallback((next) => {
    if (!openFile) return;
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(openFile.filename)}&workspace=${encodeURIComponent(workspace ?? "")}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aliases: next }),
    }).catch(() => {});
  }, [openFile]);


  const addAlias = useCallback(() => {
    const val = aliasInput.trim();
    if (!val || aliases.some((a) => a.toLowerCase() === val.toLowerCase())) {
      setAliasInput("");
      return;
    }
    const next = [...aliases, val];
    setAliases(next);
    saveAliases(next);
    setAliasInput("");
  }, [aliasInput, aliases, saveAliases]);

  const removeAlias = useCallback((alias) => {
    const next = aliases.filter((a) => a !== alias);
    setAliases(next);
    saveAliases(next);
  }, [aliases, saveAliases]);

  // Keep refs in sync with their state/callback counterparts every render
  openFileRef.current = openFile;

  // ── Entity link decoration extension (stable ref, never recreated) ───────────
  const entityLinksExtension  = useMemo(() => buildEntityLinksExtension(entityDataRef), []);
  const autocompleteExtension = useMemo(() => buildAutocompleteExtension(entityDataRef), []);

  // ── TipTap editor ────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { languageClassPrefix: "" } }),
      Markdown.configure({ html: false, tightLists: true }),
      Placeholder.configure({ placeholder: "Start writing your story notes…" }),
      CharacterCount,
      entityLinksExtension,
      autocompleteExtension,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "notes-editor prose prose-invert focus:outline-none max-w-none",
        spellcheck: "true",
      },
    },
    onUpdate: () => {
      // Suppress saves that fire during programmatic content loads.
      // tiptap-markdown's appendTransaction can normalise the doc even when
      // setContent is called with emitUpdate=false, causing a real onUpdate.
      if (suppressSaveRef.current) return;
      setIsDirty(true);
      // Auto-save after 1.5s of inactivity — use ref so we always call the
      // current saveFile even if openFile has changed since editor was created
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveFileRef.current?.(), 1500);
    },
  });

  // ── Load file list ───────────────────────────────────────────────────────────
  const loadFiles = useCallback(() => {
    if (!workspace) return;
    fetch(`/api/notes-raw-list?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d) => {
        setFiles(d.files || []);
        const treeData = d.tree || [];
        setTree(treeData);
        // Collect all folder paths so they default to open
        const folderPaths = [];
        const collectFolders = (nodes) => {
          for (const node of nodes) {
            if (node.type === "folder") {
              folderPaths.push(node.path);
              if (node.children) collectFolders(node.children);
            }
          }
        };
        collectFolders(treeData);
        if (folderPaths.length > 0)
          setOpenFolders((prev) => new Set([...prev, ...folderPaths]));
      })
      .catch(console.error);
  }, [workspace]);

  useEffect(() => {
    fileCacheRef.current = {}; // clear cache when workspace changes
    backlinksCache.current = {};
    loadFiles();
  }, [loadFiles]);

  // ── Open a file ──────────────────────────────────────────────────────────────
  const openFileByName = useCallback((filename) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setIsDirty(false);
    setSaveState("idle");

    const applyContent = (filename, content, cachedJson) => {
      setOpenFile({ filename, content });
      suppressSaveRef.current = true;
      // Use pre-parsed JSON when available — skips tiptap-markdown parsing (~1s on large files)
      editor?.commands.setContent(cachedJson ?? content, false);
      entityDataRef.current.currentFilename = filename;
      setTimeout(() => {
        lastSavedContentRef.current = editor?.storage.markdown.getMarkdown() ?? content;
        suppressSaveRef.current = false;
        setIsDirty(false);
        // Store parsed JSON in cache so next open of this file skips parsing
        if (!cachedJson && editor) {
          const entry = fileCacheRef.current[filename];
          if (entry) entry.json = editor.getJSON();
        }
      }, 50);
    };

    // Serve from cache if available — no network round-trip needed
    const cached = fileCacheRef.current[filename];
    if (cached !== undefined) {
      applyContent(filename, cached.content, cached.json ?? null);
      return;
    }

    setLoadingFile(true);
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${encodeURIComponent(workspace ?? "")}`)
      .then((r) => r.json())
      .then((d) => {
        fileCacheRef.current[d.filename] = { content: d.content, json: null };
        applyContent(d.filename, d.content, null);
      })
      .catch(console.error)
      .finally(() => setLoadingFile(false));
  }, [editor]);

  // When editor is ready and we already have openFile set, push content in
  useEffect(() => {
    if (editor && openFile) {
      suppressSaveRef.current = true;
      editor.commands.setContent(openFile.content, false);
      setTimeout(() => {
        lastSavedContentRef.current = editor.storage.markdown.getMarkdown();
        suppressSaveRef.current = false;
        setIsDirty(false);
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Save file ────────────────────────────────────────────────────────────────
  const saveFile = useCallback(() => {
    // Read openFile from ref so this is never stale even when called from a timer
    const currentFile = openFileRef.current;
    if (!currentFile || !editor) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const content = editor.storage.markdown.getMarkdown();
    // Skip write if content hasn't actually changed (e.g. only cursor moved,
    // selection changed, or TipTap serialization normalised whitespace)
    if (content === lastSavedContentRef.current) {
      setIsDirty(false);
      return;
    }
    setSaveState("saving");
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(currentFile.filename)}&workspace=${encodeURIComponent(workspace ?? "")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Save failed");
        lastSavedContentRef.current = content;
        // Update cache — store new content and capture the current parsed JSON
        // so the very next open also skips re-parsing.
        fileCacheRef.current[currentFile.filename] = {
          content,
          json: editor?.getJSON() ?? null,
        };
        setIsDirty(false);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      })
      .catch(() => setSaveState("error"));
  }, [editor]); // no openFile dep — reads from ref instead

  // Keep saveFileRef pointing at the latest saveFile
  saveFileRef.current = saveFile;

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveFile]);

  // ── Create new file ──────────────────────────────────────────────────────────
  const createFile = useCallback((parentPath, name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const filename = /\.(md|txt)$/i.test(trimmed) ? trimmed : trimmed + ".md";
    const filePath = parentPath ? `${parentPath}/${filename}` : filename;
    setInlineNew(null);
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(workspace ?? "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Create failed");
        if (parentPath) setOpenFolders((prev) => new Set([...prev, parentPath]));
        loadFiles();
        openFileByName(filePath);
      })
      .catch(console.error);
  }, [loadFiles, openFileByName, workspace]);

  // ── Create new folder ──────────────────────────────────────────────────
  const createFolder = useCallback((parentPath, name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const folderPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    setInlineNew(null);
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(folderPath)}&workspace=${encodeURIComponent(workspace ?? "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFolder: true }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Create folder failed");
        setOpenFolders((prev) => new Set([...prev, folderPath]));
        if (parentPath) setOpenFolders((prev) => new Set([...prev, parentPath]));
        loadFiles();
      })
      .catch(console.error);
  }, [loadFiles, workspace]);

  // ── Move file to a different folder ──────────────────────────────────────────
  const moveFile = useCallback((fromPath, toFolderPath) => {
    const basename = fromPath.split("/").pop();
    const toPath = toFolderPath ? `${toFolderPath}/${basename}` : basename;
    if (toPath === fromPath) return;

    // Snapshot current state for rollback on failure
    const prevFiles = files;
    const prevTree = tree;
    const prevOpenFile = openFile;

    // ── Optimistic updates (immediate, no network wait) ───────────────────────
    setFiles(prevFiles.map((f) => f.filename === fromPath ? { ...f, filename: toPath } : f));
    const [removed, withoutNode] = treeRemoveNode(prevTree, fromPath);
    if (removed) setTree(treeInsertNode(withoutNode, { ...removed, path: toPath }, toFolderPath));
    if (prevOpenFile?.filename === fromPath) {
      setOpenFile({ ...prevOpenFile, filename: toPath });
      entityDataRef.current.currentFilename = toPath;
    }

    // ── Background API call ───────────────────────────────────────────────────
    fetch(`/api/notes-raw-move?workspace=${encodeURIComponent(workspace ?? "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromPath, to: toPath }),
    })
      .then((r) => { if (!r.ok) return r.json().then((d) => { throw new Error(d.error || "Move failed"); }); })
      .catch((err) => {
        console.error("Move error:", err);
        setFiles(prevFiles);
        setTree(prevTree);
        setOpenFile(prevOpenFile);
        if (prevOpenFile?.filename === fromPath)
          entityDataRef.current.currentFilename = fromPath;
      });
  }, [files, tree, openFile, workspace]);

  // ── Delete file ──────────────────────────────────────────────────────────────
  const deleteFile = useCallback((filename, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${encodeURIComponent(workspace ?? "")}`, { method: "DELETE" })
      .then(() => {
        loadFiles();
        if (openFile?.filename === filename) {
          setOpenFile(null);
          editor?.commands.setContent("");
          setIsDirty(false);
        }
      })
      .catch(console.error);
  }, [loadFiles, openFile, editor]);

  // ── Delete folder ────────────────────────────────────────────────────────────
  const deleteFolder = useCallback((folderPath, e) => {
    e.stopPropagation();
    const filePaths = files
      .filter((f) => f.filename === folderPath || f.filename.startsWith(folderPath + "/"))
      .map((f) => f.filename);
    setFolderDeleteModal({ folderPath, filePaths });
  }, [files]);

  const confirmFolderDelete = useCallback(async (mode) => {
    if (!folderDeleteModal) return;
    const { folderPath, filePaths } = folderDeleteModal;
    setFolderDeleteModal(null);
    const ws = encodeURIComponent(workspace ?? "");

    try {
      if (mode === "delete") {
        // Single recursive delete — handles non-.md files and nested folders too
        await fetch(
          `/api/notes-raw-file?filename=${encodeURIComponent(folderPath)}&workspace=${ws}&isFolder=true&recursive=true`,
          { method: "DELETE" }
        );
      } else {
        // Move each .md/.txt file to the root (strip folder prefix)
        await Promise.all(filePaths.map(async (fp) => {
          const basename = fp.split("/").pop();
          if (basename === fp) return; // already at root
          await fetch(`/api/notes-raw-move?workspace=${ws}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: fp, to: basename }),
          });
        }));
        // Remove the now-empty folder (non-recursive: safe)
        await fetch(
          `/api/notes-raw-file?filename=${encodeURIComponent(folderPath)}&workspace=${ws}&isFolder=true`,
          { method: "DELETE" }
        ).catch(() => {});
      }
    } catch (err) {
      console.error("Folder delete failed:", err);
    }

    if (openFile && filePaths.includes(openFile.filename)) {
      setOpenFile(null);
      editor?.commands.setContent("");
      setIsDirty(false);
    }
    loadFiles();
  }, [folderDeleteModal, workspace, openFile, editor, loadFiles]);

  // ── Mentionable entities: nodes that have a matching notes-raw file ──────────
  const mentionableEntities = useMemo(() => {
    if (!graphData.nodes.length || !files.length) return [];
    // Build basename → full relative path map (e.g. "maren-ashveil.md" → "notes-raw/maren-ashveil.md")
    const fileBasenameMap = new Map(files.map((f) => [f.filename.split("/").pop(), f.filename]));
    // Derive the node ID for the currently open file so we can exclude all supplemental copies
    // of the same node (not just the exact filename). Prefer openNode.id (handles merged copies
    // whose filename doesn't match the canonical node ID).
    const openBasename = openFile?.filename.split("/").pop() ?? "";
    const openFileNodeId = openNode?.id ?? openBasename.replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    const result = [];
    for (const node of graphData.nodes) {
      if (node.id === openFileNodeId) continue; // skip self AND all supplemental files for the same node
      const stem = node.id.replace(/_/g, "-");
      const fullPath = fileBasenameMap.get(stem + ".md") ?? fileBasenameMap.get(stem + ".txt");
      if (!fullPath) continue;
      const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
      result.push({ name: node.name, filename: fullPath, color: cfg.color });
      // Collect all alias forms: explicit aliases from JSON + auto-derived single words
      // from multi-word names (e.g. "Orris Vane" → also match "Vane", "Orris").
      const STOP_WORDS = new Set([
        "the","and","for","not","but","nor","yet","so","of","in","on","at","to",
        "by","up","as","an","a","or","its","it","he","she","they","his","her",
        "their","our","my","your","its","who","whom","which","that","this","these",
        "those","from","with","into","onto","upon","over","under","about","after",
        "before","old","new","one","two","three","four","five","six","seven",
      ]);
      const nameWords = node.name.trim().split(/\s+/);
      const autoPartials = nameWords.length > 1
        ? nameWords.filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
        : [];
      const allAliases = [
        ...(node.aliases || []),
        ...autoPartials.filter((w) => !(node.aliases || []).some((a) => a.toLowerCase() === w.toLowerCase())),
      ];
      // Also add each alias so e.g. "Maren" links to the same file as "Maren Ashveil"
      for (const alias of allAliases) {
        if (alias.toLowerCase() !== node.name.toLowerCase()) {
          result.push({ name: alias, filename: fullPath, color: cfg.color });
        }
      }
    }
    // Sort longer names first to prevent partial shadowing
    return result.sort((a, b) => b.name.length - a.name.length);
  }, [graphData.nodes, files, openFile]);

  // Keep decoration ref in sync — no transaction dispatch needed; ProseMirror
  // reruns decorations() on every state update so the ref is always current.
  useEffect(() => {
    entityDataRef.current.entities = mentionableEntities;
    entityDataRef.current.onOpen = openFileByName;
    entityDataRef.current.currentFilename = openFile?.filename ?? null;
    entityDataRef.current.onHover = (filename, x, y) => {
      // filename may be a full relative path; compare against node id using basename
      const basename = filename.split("/").pop();
      const node = graphData.nodes.find(
        (n) => n.id.replace(/_/g, "-") + ".md" === basename || n.id.replace(/_/g, "-") + ".txt" === basename
      );
      if (node) setEntityTooltip({ node, x, y });
    };
    entityDataRef.current.onHoverEnd = () => setEntityTooltip(null);

    // Autocomplete candidates are the same set as decoration entities —
    // mentionableEntities already includes aliases as separate entries.
    const candidates = [...mentionableEntities];
    entityDataRef.current.candidates = candidates;
  }, [mentionableEntities, openFileByName, openFile, graphData.nodes]);

  // ── Bibliography: nodes mentioned in the open file's prose ──────────────────
  const bibliography = useMemo(() => {
    if (!openFile || !mentionableEntities.length) return [];
    const rawText = openFile.content.toLowerCase();
    const stemWords = new Set(
      openFile.filename.split("/").pop().replace(/\.(md|txt)$/i, "").split(/[-_]/).map((w) => w.toLowerCase())
    );
    const seen = new Set(); // deduplicate by filename — one entry per node regardless of aliases
    const result = [];
    for (const entity of mentionableEntities) {
      if (seen.has(entity.filename)) continue;
      // Skip if entity name words all appear in the filename stem (self)
      const words = entity.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
      if (words.length > 0 && words.every((w) => stemWords.has(w))) continue;
      const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(rawText)) {
        seen.add(entity.filename);
        // Always resolve to canonical node name so aliases never appear as display text
        const nodeId = entity.filename.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
        const node = graphData.nodes.find((n) => n.id === nodeId);
        result.push({ ...entity, name: node?.name ?? entity.name });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [openFile, mentionableEntities, graphData.nodes]);

  // Set of filenames that appear in both bibliography and backlinks (mutual / bidirectional)
  const mutualFilenames = useMemo(() => {
    const backlinkSet = new Set(backlinks.map((b) => b.filename));
    return new Set(bibliography.map((e) => e.filename).filter((f) => backlinkSet.has(f)));
  }, [bibliography, backlinks]);

  const isEditorReady = !!editor && !loadingFile;
  const canEdit = isEditorReady && !!openFile;
  const isPageLoading = loadingFile || loadingBacklinks;

  // Flat list of every folder path in the tree (for expand/collapse all)
  const allFolderPaths = useMemo(() => {
    const paths = [];
    const collect = (nodes) => {
      for (const node of nodes) {
        if (node.type === "folder") {
          paths.push(node.path);
          if (node.children) collect(node.children);
        }
      }
    };
    collect(tree);
    return paths;
  }, [tree]);

  // ── File tree renderer ─────────────────────────────────────────────────────
  const renderTree = (nodes, depth) => {
    const items = [];
    for (const node of nodes) {
      const indent = depth * 12;

      if (node.type === "folder") {
        const isExpanded = openFolders.has(node.path);
        const isDropTarget = dropIndicator?.type === "folder" && dropIndicator.path === node.path;

        // Drag handlers go on the OUTER wrapper (full subtree) so moving into
        // children doesn't prematurely fire onDragLeave on the header row.
        items.push(
          <div
            key={node.path}
            onDragOver={(e) => { if (!dragItem) return; e.preventDefault(); e.stopPropagation(); setDropIndicator({ type: "folder", path: node.path }); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropIndicator((p) => p?.path === node.path ? null : p); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragItem) moveFile(dragItem.path, node.path); setDragItem(null); setDropIndicator(null); }}
          >
            <div
              className="group flex items-center gap-1 py-0.5 rounded-md cursor-pointer select-none"
              style={{
                paddingLeft: indent + 4,
                paddingRight: 4,
                backgroundColor: isDropTarget ? "rgba(96,165,250,0.12)" : "transparent",
                outline: isDropTarget ? "1px solid rgba(96,165,250,0.35)" : "none",
                outlineOffset: "1px",
              }}
              onClick={() => setOpenFolders((prev) => {
                const next = new Set(prev);
                next.has(node.path) ? next.delete(node.path) : next.add(node.path);
                return next;
              })}
              onMouseEnter={(e) => { if (!dragItem) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!dragItem) e.currentTarget.style.backgroundColor = isDropTarget ? "rgba(96,165,250,0.12)" : "transparent"; }}
            >
              <ChevronRight
                size={12}
                style={{ transition: "transform 0.15s ease", transform: isExpanded ? "rotate(90deg)" : "none", color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
              />
              {isExpanded
                ? <FolderOpen size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />
                : <Folder size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />
              }
              <span className="text-sm truncate flex-1 ml-1" style={{ color: "rgba(255,255,255,0.65)" }}>{node.name}</span>
              <span className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  title="New file"
                  onClick={(e) => { e.stopPropagation(); setOpenFolders((p) => new Set([...p, node.path])); setInlineNew({ parentPath: node.path, type: "file", value: "" }); }}
                  className="p-0.5 rounded" style={{ color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                ><FilePlus size={11} /></button>
                <button
                  title="New folder"
                  onClick={(e) => { e.stopPropagation(); setOpenFolders((p) => new Set([...p, node.path])); setInlineNew({ parentPath: node.path, type: "folder", value: "" }); }}
                  className="p-0.5 rounded" style={{ color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                ><FolderPlus size={11} /></button>
                <button
                  title="Delete folder"
                  onClick={(e) => deleteFolder(node.path, e)}
                  className="p-0.5 rounded" style={{ color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                ><Trash2 size={11} /></button>
              </span>
            </div>
            {isExpanded && (
              <>
                {inlineNew?.parentPath === node.path && (
                  <div className="py-0.5 pr-2" style={{ paddingLeft: indent + 20 }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder={inlineNew.type === "file" ? "filename.md" : "folder-name"}
                      value={inlineNew.value}
                      onChange={(e) => setInlineNew((p) => ({ ...p, value: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { const v = inlineNew.value.trim(); if (v) { inlineNew.type === "file" ? createFile(node.path, v) : createFolder(node.path, v); } }
                        if (e.key === "Escape") setInlineNew(null);
                      }}
                      onBlur={() => setInlineNew(null)}
                      className="w-full px-1.5 py-0.5 rounded text-sm outline-none bg-transparent"
                      style={{ border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                      spellCheck={false}
                    />
                  </div>
                )}
                {renderTree(node.children, depth + 1)}
              </>
            )}
          </div>
        );
      } else {
        // File node
        const isActive = openFile?.filename === node.path;
        const isDragging = dragItem?.path === node.path;
        const parentPath = node.path.includes("/") ? node.path.split("/").slice(0, -1).join("/") : "";
        const isLineBefore = dropIndicator?.type === "line" && dropIndicator.path === node.path && dropIndicator.position === "before";
        const isLineAfter = dropIndicator?.type === "line" && dropIndicator.path === node.path && dropIndicator.position === "after";

        items.push(
          <div key={node.path} style={{ opacity: isDragging ? 0.4 : 1 }}>
            {isLineBefore && (
              <div style={{ height: 2, margin: `1px 4px 1px ${indent + 20}px`, borderRadius: 1, backgroundColor: "#60a5fa" }} />
            )}
            <div
              draggable
              className="group flex items-center gap-1.5 py-0.5 rounded-md cursor-pointer transition-colors"
              style={{ paddingLeft: indent + 20, paddingRight: 4, backgroundColor: isActive ? "rgba(96,165,250,0.12)" : "transparent" }}
              onClick={() => openFileByName(node.path)}
              onMouseEnter={(e) => { if (!isActive && !dragItem) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!dragItem) e.currentTarget.style.backgroundColor = isActive ? "rgba(96,165,250,0.12)" : "transparent"; }}
              onDragStart={(e) => { e.stopPropagation(); setDragItem({ path: node.path }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", node.path); }}
              onDragEnd={() => { setDragItem(null); setDropIndicator(null); }}
              onDragOver={(e) => {
                if (!dragItem) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDropIndicator({ type: "line", path: node.path, position });
              }}
              onDragLeave={() => setDropIndicator((p) => p?.type === "line" && p.path === node.path ? null : p)}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragItem) moveFile(dragItem.path, parentPath); setDragItem(null); setDropIndicator(null); }}
            >
              <FileText size={13} style={{ color: isActive ? "#60a5fa" : "rgba(255,255,255,0.3)", flexShrink: 0 }} />
              <span className="text-sm truncate flex-1" style={{ color: isActive ? "#e2e8f0" : "rgba(255,255,255,0.6)" }}>{node.name}</span>
              {duplicateBasenames.has(node.name) && (
                <Copy size={10} title="Appears in multiple folders" style={{ color: "#fbbf24", flexShrink: 0, opacity: 0.75, marginRight: 2 }} />
              )}
              <button
                onClick={(e) => deleteFile(node.path, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded flex-shrink-0"
                style={{ color: "rgba(248,113,113,0.7)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(248,113,113,0.7)")}
                title="Delete file"
              ><Trash2 size={11} /></button>
            </div>
            {isLineAfter && (
              <div style={{ height: 2, margin: `1px 4px 1px ${indent + 20}px`, borderRadius: 1, backgroundColor: "#60a5fa" }} />
            )}
          </div>
        );
      }
    }
    return items;
  };

  return (
    <>
    <div className="flex flex-1 overflow-hidden min-h-0">

      {/* ── File sidebar ────────────────────────────────────────────────────── */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col border-r"
        style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* Workspace name header — clickable to switch workspace */}
        <div
          className="relative flex items-center gap-1 px-3 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
          ref={wsDropdownRef}
        >
          <button
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
            onClick={() => setWsDropdownOpen((v) => !v)}
            title="Switch workspace"
          >
            <span className="text-sm font-semibold truncate flex-1" style={{ color: "rgba(255,255,255,0.75)" }}>
              {workspaceName || workspace || "Workspace"}
            </span>
            <ChevronRight
              size={11}
              style={{
                transition: "transform 0.15s ease",
                transform: wsDropdownOpen ? "rotate(90deg)" : "rotate(0deg)",
                color: "rgba(255,255,255,0.3)",
                flexShrink: 0,
              }}
            />
          </button>
          <button
            title="New file"
            onClick={() => setInlineNew({ parentPath: "", type: "file", value: "" })}
            className="p-1 rounded-md flex-shrink-0"
            style={{ color: "rgba(255,255,255,0.35)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
          ><FilePlus size={14} /></button>
          <button
            title="New folder"
            onClick={() => setInlineNew({ parentPath: "", type: "folder", value: "" })}
            className="p-1 rounded-md flex-shrink-0"
            style={{ color: "rgba(255,255,255,0.35)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
          ><FolderPlus size={14} /></button>
          {allFolderPaths.length > 0 && (
            openFolders.size >= allFolderPaths.length ? (
              <button
                title="Collapse all folders"
                onClick={() => setOpenFolders(new Set())}
                className="p-1 rounded-md flex-shrink-0"
                style={{ color: "rgba(255,255,255,0.35)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
              ><ChevronsDownUp size={14} /></button>
            ) : (
              <button
                title="Expand all folders"
                onClick={() => setOpenFolders(new Set(allFolderPaths))}
                className="p-1 rounded-md flex-shrink-0"
                style={{ color: "rgba(255,255,255,0.35)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
              ><ChevronsUpDown size={14} /></button>
            )
          )}

          {/* Workspace dropdown */}
          {wsDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-2xl overflow-hidden w-full"
              style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              {workspaces.map((ws) => (
                <button
                  key={ws.slug}
                  onClick={() => { onWorkspaceChange?.(ws.slug); setWsDropdownOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                  style={{
                    backgroundColor: ws.slug === workspace ? "rgba(255,255,255,0.07)" : "transparent",
                    color: ws.slug === workspace ? "#fff" : "rgba(255,255,255,0.6)",
                  }}
                  onMouseEnter={(e) => { if (ws.slug !== workspace) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (ws.slug !== workspace) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  {ws.slug === workspace && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#60a5fa" }} />
                  )}
                  <span className="text-sm">{ws.name}</span>
                </button>
              ))}
              <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                {newWsInput ? (
                  <form onSubmit={handleCreateWorkspace} className="px-3 py-2.5">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Workspace name..."
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      className="w-full bg-transparent outline-none text-sm"
                      style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                      onKeyDown={(e) => { if (e.key === "Escape") { setNewWsInput(false); setNewWsName(""); } }}
                    />
                    <div className="flex gap-1.5 mt-2">
                      <button
                        type="submit"
                        className="text-xs px-2.5 py-1 rounded-md font-medium"
                        style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                      >Create</button>
                      <button
                        type="button"
                        onClick={() => { setNewWsInput(false); setNewWsName(""); }}
                        className="text-xs px-2.5 py-1 rounded-md"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                      >Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setNewWsInput(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.35)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <span className="text-base leading-none font-light">+</span>
                    <span className="text-sm">New workspace</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* File tree */}
        <div
          className="flex-1 overflow-y-auto py-1 px-1"
          style={{ outline: dropIndicator?.type === "root" ? "1px solid rgba(96,165,250,0.25)" : "none", outlineOffset: "-2px" }}
          onDragOver={(e) => { if (!dragItem) return; e.preventDefault(); setDropIndicator({ type: "root" }); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropIndicator(null); }}
          onDrop={(e) => { e.preventDefault(); if (dragItem) moveFile(dragItem.path, ""); setDragItem(null); setDropIndicator(null); }}
        >
          {inlineNew?.parentPath === "" && (
            <div className="py-0.5 px-2">
              <input
                autoFocus
                type="text"
                placeholder={inlineNew.type === "file" ? "filename.md" : "folder-name"}
                value={inlineNew.value}
                onChange={(e) => setInlineNew((p) => ({ ...p, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { const v = inlineNew.value.trim(); if (v) { inlineNew.type === "file" ? createFile("", v) : createFolder("", v); } }
                  if (e.key === "Escape") setInlineNew(null);
                }}
                onBlur={() => setInlineNew(null)}
                className="w-full px-1.5 py-0.5 rounded text-sm outline-none bg-transparent"
                style={{ border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                spellCheck={false}
              />
            </div>
          )}
          {tree.length === 0 && !inlineNew && (
            <p className="text-xs px-3 py-2" style={{ color: "rgba(255,255,255,0.2)" }}>No files yet</p>
          )}
          {renderTree(tree, 0)}
        </div>
      </aside>

      {/* ── Editor pane ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

        {/* Full-pane loading overlay — covers editor + bibliography + backlinks */}
        {isPageLoading && openFile && (
          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ backgroundColor: "rgba(15,15,26,0.7)" }}>
            <Loader size={20} className="animate-spin" style={{ color: "rgba(255,255,255,0.35)" }} />
          </div>
        )}

        {/* Toolbar */}
        <div
          className="flex items-center gap-0.5 px-3 py-1.5 border-b flex-shrink-0 flex-wrap"
          style={{ backgroundColor: "#16162a", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <ToolbarBtn title="Undo" disabled={!canEdit} onClick={() => editor.chain().focus().undo().run()}>
            <Undo size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Redo" disabled={!canEdit} onClick={() => editor.chain().focus().redo().run()}>
            <Redo size={14} />
          </ToolbarBtn>
          <ToolbarDivider />
          <ToolbarBtn title="Heading 1" disabled={!canEdit} active={editor?.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Heading 2" disabled={!canEdit} active={editor?.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Heading 3" disabled={!canEdit} active={editor?.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={14} />
          </ToolbarBtn>
          <ToolbarDivider />
          <ToolbarBtn title="Bold" disabled={!canEdit} active={editor?.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Italic" disabled={!canEdit} active={editor?.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Inline code" disabled={!canEdit} active={editor?.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size={14} />
          </ToolbarBtn>
          <ToolbarDivider />
          <ToolbarBtn title="Bullet list" disabled={!canEdit} active={editor?.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Numbered list" disabled={!canEdit} active={editor?.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Blockquote" disabled={!canEdit} active={editor?.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Horizontal rule" disabled={!canEdit} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <Minus size={14} />
          </ToolbarBtn>
          <ToolbarDivider />

          {/* Save button + status */}
          <div className="ml-auto flex items-center gap-2">
            {saveState === "saving" && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                <Loader size={11} className="animate-spin" /> Saving…
              </span>
            )}
            {saveState === "saved" && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "#34d399" }}>
                <CheckCircle size={11} /> Saved
              </span>
            )}
            {saveState === "error" && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "#f87171" }}>
                <AlertCircle size={11} /> Save failed
              </span>
            )}
            {isDirty && saveState === "idle" && (
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>Unsaved</span>
            )}
            <button
              onClick={saveFile}
              disabled={!canEdit || !isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: canEdit && isDirty ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.05)",
                color: canEdit && isDirty ? "#93c5fd" : "rgba(255,255,255,0.2)",
                cursor: canEdit && isDirty ? "pointer" : "not-allowed",
              }}
              title="Save (Ctrl+S)"
            >
              <Save size={12} />
              Save
            </button>
          </div>
        </div>

        {/* Editor area */}
        {!openFile ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-3" style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>Select a file to edit</p>
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.15)" }}>or create a new one with +</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-8 py-6 relative">
            {/* Editable node title */}
            {openNode ? (
              <input
                type="text"
                value={nodeTitle}
                onChange={(e) => setNodeTitle(e.target.value)}
                onBlur={(e) => saveNodeTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                placeholder="Untitled"
                className="w-full bg-transparent outline-none block mb-1"
                style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1.25, color: "#fff", caretColor: "#60a5fa", border: "none" }}
                spellCheck={false}
              />
            ) : (
              <p className="text-xl font-bold mb-1" style={{ color: "#fff" }}>
                {openFile.filename.split("/").pop().replace(/\.(md|txt)$/i, "")}
              </p>
            )}
            {/* File path */}
            <p className="text-xs mb-1 font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
              {openFile.filename}
              {propagateMsg && (
                <span style={{ marginLeft: 10, color: "#4ade80" }}>{propagateMsg}</span>
              )}
            </p>
            {/* Duplicate / supplemental file indicator */}
            {supplementalFiles.length > 0 && (
              <div className="text-xs mb-4 flex flex-col gap-0.5">
                {supplementalFiles.map((f) => {
                  const parts = f.filename.split("/");
                  const filename = parts.pop();
                  const folder = parts.length > 0 ? parts.join("/") + "/" : "root/";
                  return (
                    <button
                      key={f.filename}
                      onClick={() => openFileByName(f.filename)}
                      className="text-left"
                      style={{ color: "#fbbf24", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#fde68a")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#fbbf24")}
                    >
                      <span style={{ opacity: 0.6 }}>Also in: </span>
                      <span className="underline underline-offset-2">{folder}</span>
                      <span style={{ opacity: 0.6 }}> as </span>
                      <span className="font-mono underline underline-offset-2">{filename}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {supplementalFiles.length === 0 && <div className="mb-4" />}
            {/* Minimap floated top-right so prose wraps around it */}
            {openNodeId && graphData.nodes.some((n) => n.id === openNodeId) && (
              <div style={{ float: "right", width: 320, marginLeft: 20, marginBottom: 12, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0f0f1a", flexShrink: 0 }}>
                <NodeMinimap
                  nodeId={openNodeId}
                  graphData={graphData}
                  files={files}
                  onOpen={openFileByName}
                  nodeTransparent={nodeTransparent}
                  nodeBorder={nodeBorder}
                />
              </div>
            )}
            <EditorContent editor={editor} />

            {/* ── Entity hover preview tooltip ─────────────────────── */}
            {entityTooltip && (() => {
              const cfg = NODE_TYPE_CONFIG[entityTooltip.node.type] || NODE_TYPE_CONFIG.character;
              // Anchor the tooltip's bottom edge 12px above the cursor using
              // translateY(-100%) so we never need to know the actual height.
              const MARGIN = 12;
              const W = 240;
              let tx = entityTooltip.x - W / 2;
              if (tx < MARGIN) tx = MARGIN;
              if (tx + W > window.innerWidth - MARGIN) tx = window.innerWidth - W - MARGIN;
              // Place at cursor y; transform pulls the whole box upward
              const ty = entityTooltip.y - MARGIN;
              return (
                <div
                  className="fixed z-50 pointer-events-none"
                  style={{
                    left: tx,
                    top: ty,
                    width: W,
                    transform: "translateY(-100%)",
                    backgroundColor: "rgba(15,15,26,0.97)",
                    border: `1px solid ${cfg.color}44`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${cfg.color}22`,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm font-semibold leading-tight text-white mb-1">
                    {entityTooltip.node.name}
                  </p>
                  {entityTooltip.node.excerpt && (
                    <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "rgba(255,255,255,0.5)" }}>
                      {entityTooltip.node.excerpt}
                    </p>
                  )}
                  <p className="text-[10px] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>
                    Click to open
                  </p>
                </div>
              );
            })()}
            {/* Word count + last edited */}
            {editor && (
              <p className="mt-6 text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>
                {editor.storage.characterCount.words()} words · {editor.storage.characterCount.characters()} characters
                {(() => {
                  const mtime = files.find((f) => f.filename === openFile?.filename)?.mtime;
                  if (!mtime) return null;
                  const d = new Date(mtime);
                  const now = new Date();
                  const diffMs = now - d;
                  const diffMin = Math.floor(diffMs / 60000);
                  const diffHr = Math.floor(diffMs / 3600000);
                  const diffDay = Math.floor(diffMs / 86400000);
                  let label;
                  if (diffMin < 1) label = "just now";
                  else if (diffMin < 60) label = `${diffMin}m ago`;
                  else if (diffHr < 24) label = `${diffHr}h ago`;
                  else if (diffDay < 7) label = `${diffDay}d ago`;
                  else label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
                  return <> · edited {label}</>;
                })()}
              </p>
            )}

            {/* ── Aliases ──────────────────────────────────────────── */}
            <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Tag size={11} style={{ color: "rgba(255,255,255,0.3)" }} />
                <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Names &amp; Aliases
                </h2>
              </div>
              {/* Primary name */}
              {(() => {
                const node = graphData.nodes.find((n) => n.id === openNodeId);
                const cfg = NODE_TYPE_CONFIG[node?.type] || NODE_TYPE_CONFIG.character;
                return node ? (
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-semibold"
                      style={{ backgroundColor: cfg.color + "22", color: cfg.color, border: `1px solid ${cfg.color}44` }}
                    >
                      {node.name}
                    </span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>primary</span>
                  </div>
                ) : null;
              })()}
              {/* Alias chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {aliases.map((alias) => (
                  <span
                    key={alias}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs"
                    style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
                  >
                    {alias}
                    <button
                      onClick={() => removeAlias(alias)}
                      className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                      style={{ color: "rgba(255,255,255,0.6)" }}
                      title="Remove alias"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {aliases.length === 0 && (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>No aliases yet</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={aliasInputRef}
                  type="text"
                  placeholder="Add alias…"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addAlias(); }
                    if (e.key === "Escape") setAliasInput("");
                  }}
                  className="flex-1 px-2 py-1 rounded-md text-xs outline-none bg-transparent"
                  style={{
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.75)",
                    caretColor: "#60a5fa",
                  }}
                  spellCheck={false}
                />
                <button
                  onClick={addAlias}
                  disabled={!aliasInput.trim()}
                  className="px-2 py-1 rounded-md text-xs transition-colors"
                  style={{
                    backgroundColor: aliasInput.trim() ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.05)",
                    color: aliasInput.trim() ? "#93c5fd" : "rgba(255,255,255,0.2)",
                    cursor: aliasInput.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Add
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>Enter to add · click × to remove</p>
            </div>

            {/* ── Merge node ───────────────────────────────────────── */}
            {openNode && (
              <div className="mt-5">
                <button
                  onClick={openMergeModal}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                  style={{ color: "rgba(251,191,36,0.7)", background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fbbf24"; e.currentTarget.style.background = "rgba(251,191,36,0.12)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(251,191,36,0.7)"; e.currentTarget.style.background = "rgba(251,191,36,0.07)"; }}
                  title="Force-merge this node into another (treats them as the same entity)"
                >
                  <GitMerge size={12} />
                  Merge into…
                </button>
              </div>
            )}

            {/* ── Bibliography ─────────────────────────────────────── */}
            {bibliography.length > 0 && (
              <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  References
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium"
                    style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}
                  >
                    {bibliography.length}
                  </span>
                </h2>
                <ol
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "0.5rem 2rem",
                    listStyle: "none",
                    padding: 0,
                  }}
                >
                  {bibliography.map((entity, i) => {
                    const nodeId = entity.filename.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
                    const node = graphData.nodes.find((n) => n.id === nodeId);
                    const cfg = NODE_TYPE_CONFIG[node?.type] || NODE_TYPE_CONFIG.character;
                    const isMutual = mutualFilenames.has(entity.filename);
                    return (
                      <li key={entity.filename} className="flex items-start gap-2 min-w-0">
                        <span className="flex-shrink-0 text-xs font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)", minWidth: "1.5rem" }}>
                          {i + 1}.
                        </span>
                        <button
                          onClick={() => openFileByName(entity.filename)}
                          className="text-left min-w-0 group"
                        >
                          <span
                            className="text-sm font-medium group-hover:underline"
                            style={{ color: entity.color, textUnderlineOffset: "2px" }}
                          >
                            {entity.name}
                          </span>
                          <span
                            className="ml-1.5 text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: cfg.color + "1a", color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                          {isMutual && (
                            <span title="Mutual — also links back to this file" style={{ display: "inline-flex", alignItems: "center", marginLeft: "0.375rem", color: "rgba(255,255,255,0.3)", verticalAlign: "middle" }}>
                              <ArrowLeftRight size={11} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* ── Backlinks ─────────────────────────────────────────── */}
            {backlinks.length > 0 && (
              <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Backlinks
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium"
                    style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}
                  >
                    {backlinks.length}
                  </span>
                </h2>
                <ol
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "0.5rem 2rem",
                    listStyle: "none",
                    padding: 0,
                  }}
                >
                  {backlinks.map(({ filename: blFilename }, i) => {
                    const nodeId = blFilename.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
                    const node = graphData.nodes.find((n) => n.id === nodeId);
                    const cfg = NODE_TYPE_CONFIG[node?.type] || NODE_TYPE_CONFIG.character;
                    const displayName = node?.name ?? blFilename.split("/").pop().replace(/\.(md|txt)$/i, "");
                    const color = node ? cfg.color : "rgba(255,255,255,0.5)";
                    const isMutual = mutualFilenames.has(blFilename);
                    return (
                      <li key={blFilename} className="flex items-start gap-2 min-w-0">
                        <span className="flex-shrink-0 text-xs font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)", minWidth: "1.5rem" }}>
                          {i + 1}.
                        </span>
                        <button
                          onClick={() => openFileByName(blFilename)}
                          className="text-left min-w-0 group"
                        >
                          <span
                            className="text-sm font-medium group-hover:underline"
                            style={{ color, textUnderlineOffset: "2px" }}
                          >
                            {displayName}
                          </span>
                          {node && (
                            <span
                              className="ml-1.5 text-xs px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: cfg.color + "1a", color: cfg.color }}
                            >
                              {cfg.label}
                            </span>
                          )}
                          {isMutual && (
                            <span title="Mutual — this file also appears in References" style={{ display: "inline-flex", alignItems: "center", marginLeft: "0.375rem", color: "rgba(255,255,255,0.3)", verticalAlign: "middle" }}>
                              <ArrowLeftRight size={11} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ── Folder delete modal ──────────────────────────────────────────────── */}
    {folderDeleteModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        onClick={() => setFolderDeleteModal(null)}
      >
        <div
          className="rounded-xl p-6 w-80 flex flex-col gap-4"
          style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-sm font-semibold text-white">
            Delete "{folderDeleteModal.folderPath.split("/").pop()}"?
          </h2>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
            {folderDeleteModal.filePaths.length === 0
              ? "This folder is empty."
              : `This folder contains ${folderDeleteModal.filePaths.length} file${folderDeleteModal.filePaths.length !== 1 ? "s" : ""}. What should happen to them?`}
          </p>
          <div className="flex flex-col gap-2">
            {folderDeleteModal.filePaths.length > 0 && (
              <button
                onClick={() => confirmFolderDelete("move")}
                className="w-full px-3 py-2 rounded-lg text-xs font-medium text-left"
                style={{ background: "rgba(255,255,255,0.07)", color: "#fff" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
              >
                Move files to top level &amp; delete folder
              </button>
            )}
            <button
              onClick={() => confirmFolderDelete("delete")}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-left"
              style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(248,113,113,0.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(248,113,113,0.12)")}
            >
              {folderDeleteModal.filePaths.length > 0 ? "Delete folder and all files inside" : "Delete empty folder"}
            </button>
            <button
              onClick={() => setFolderDeleteModal(null)}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium text-left"
              style={{ background: "transparent", color: "rgba(255,255,255,0.4)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Propagate rename confirmation modal ──────────────────────────────── */}
    {/* ── Merge modal ──────────────────────────────────────────────────────── */}
    {mergeModal && openNode && (() => {
      const allOtherNodes = graphData.nodes.filter((n) => n.id !== openNode.id);
      const q = mergeModal.query.toLowerCase().trim();
      const filtered = q
        ? allOtherNodes.filter((n) => n.name.toLowerCase().includes(q) || n.id.includes(q) || (n.aliases || []).some((a) => a.toLowerCase().includes(q)))
        : allOtherNodes;
      const { step, picked, authorityId } = mergeModal;
      const isOpenAuthority = authorityId === openNode.id;
      const authorityNode = authorityId ? (isOpenAuthority ? openNode : picked) : null;
      const childNode = authorityId ? (isOpenAuthority ? picked : openNode) : null;
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
          onClick={() => { setMergeModal(null); setMergeStatus(null); }}
        >
          <div
            className="rounded-xl flex flex-col"
            style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", width: 400, maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <GitMerge size={14} style={{ color: "#fbbf24", flexShrink: 0 }} />
              <h2 className="text-sm font-semibold text-white flex-1">
                {step === "search" && <>Merge <span style={{ color: "#fbbf24" }}>{openNode.name}</span> with…</>}
                {step === "authority" && "Who is the authoritative node?"}
                {step === "confirm" && "Confirm merge"}
              </h2>
              <button onClick={() => { setMergeModal(null); setMergeStatus(null); }} style={{ color: "rgba(255,255,255,0.35)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")} onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}><X size={14} /></button>
            </div>

            {/* ── Step 1: Search ── */}
            {step === "search" && (
              <>
                <div className="px-4 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search nodes…"
                    value={mergeModal.query}
                    onChange={(e) => setMergeModal((m) => ({ ...m, query: e.target.value }))}
                    className="w-full bg-transparent outline-none text-sm"
                    style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                    spellCheck={false}
                  />
                </div>
                <div className="overflow-y-auto flex-1 py-1">
                  {filtered.length === 0 && (
                    <p className="text-xs px-4 py-3" style={{ color: "rgba(255,255,255,0.3)" }}>No nodes match</p>
                  )}
                  {filtered.map((n) => {
                    const cfg = NODE_TYPE_CONFIG[n.type] || NODE_TYPE_CONFIG.character;
                    return (
                      <button
                        key={n.id}
                        onClick={() => setMergeModal((m) => ({ ...m, step: "authority", picked: n, authorityId: null }))}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                        style={{ background: "transparent" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                        <span className="flex-1 text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{n.name}</span>
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="px-4 py-2 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Select the node to merge with. You'll then choose which name is authoritative.</p>
                </div>
              </>
            )}

            {/* ── Step 2: Authority picker ── */}
            {step === "authority" && picked && (
              <div className="flex flex-col gap-4 p-5">
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                  The authoritative node keeps its primary name. The other node's name becomes an alias on the merged result.
                </p>
                <div className="flex gap-3">
                  {[openNode, picked].map((n) => {
                    const cfg = NODE_TYPE_CONFIG[n.type] || NODE_TYPE_CONFIG.character;
                    return (
                      <button
                        key={n.id}
                        onClick={() => setMergeModal((m) => ({ ...m, step: "confirm", authorityId: n.id }))}
                        className="flex-1 flex flex-col items-center gap-2 rounded-xl p-4 text-center"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.09)"; e.currentTarget.style.borderColor = cfg.color + "88"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                      >
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cfg.color }} />
                        <span className="text-sm font-semibold text-white leading-tight">{n.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md" style={{ backgroundColor: cfg.color + "22", color: cfg.color }}>{cfg.label}</span>
                        {n.aliases?.length > 0 && (
                          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                            {n.aliases.slice(0, 2).join(", ")}{n.aliases.length > 2 ? "…" : ""}
                          </span>
                        )}
                        <span className="text-[10px] mt-1 font-medium" style={{ color: cfg.color + "cc" }}>Use as authority →</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setMergeModal((m) => ({ ...m, step: "search" }))}
                  style={{ color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: "0.75rem" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                >← Back</button>
              </div>
            )}

            {/* ── Step 3: Confirm ── */}
            {step === "confirm" && picked && authorityNode && childNode && (
              <div className="flex flex-col gap-4 p-5">
                <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                  <span style={{ color: "#fbbf24" }}>{childNode.name}</span> will be merged into{" "}
                  <span style={{ color: "#60a5fa" }}>{authorityNode.name}</span>.
                </p>
                <ul className="text-xs flex flex-col gap-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <li>• <span style={{ color: "#60a5fa" }}>{authorityNode.name}</span> remains the primary name</li>
                  <li>• <span style={{ color: "#fbbf24" }}>{childNode.name}</span> becomes an alias on the merged node (if not already)</li>
                  <li>• All connections are merged; duplicates removed</li>
                  <li>• All references to <span style={{ color: "#fbbf24" }}>{childNode.name}</span> across other nodes are updated</li>
                  <li>• The <span style={{ color: "#fbbf24" }}>{childNode.name}</span> node file is <span style={{ color: "#f87171" }}>permanently deleted</span></li>
                </ul>
                {mergeStatus?.error && (
                  <p className="text-xs" style={{ color: "#f87171" }}>{mergeStatus.error}</p>
                )}
                <div className="flex flex-col gap-2 mt-1">
                  <button
                    onClick={executeMerge}
                    disabled={!!mergeStatus?.loading}
                    className="w-full px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ background: mergeStatus?.loading ? "rgba(251,191,36,0.07)" : "rgba(251,191,36,0.15)", color: mergeStatus?.loading ? "rgba(251,191,36,0.4)" : "#fbbf24" }}
                    onMouseEnter={(e) => { if (!mergeStatus?.loading) e.currentTarget.style.background = "rgba(251,191,36,0.25)"; }}
                    onMouseLeave={(e) => { if (!mergeStatus?.loading) e.currentTarget.style.background = "rgba(251,191,36,0.15)"; }}
                  >
                    {mergeStatus?.loading ? "Merging…" : "Confirm merge"}
                  </button>
                  <button
                    onClick={() => setMergeModal((m) => ({ ...m, step: "authority", authorityId: null }))}
                    className="w-full px-3 py-2 rounded-lg text-xs"
                    style={{ background: "transparent", color: "rgba(255,255,255,0.4)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                  >Back</button>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    })()}

    {propagateConfirm && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        onClick={propagateConfirm.onCancel}
      >
        <div
          className="rounded-xl p-6 flex flex-col gap-4"
          style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", width: 340 }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-sm font-semibold text-white">Apply rename workspace-wide?</h2>
          <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
            Renaming <span style={{ color: "#fff" }}>{propagateConfirm.oldName}</span> to{" "}
            <span style={{ color: "#60a5fa" }}>{propagateConfirm.title}</span> will affect:
          </p>
          <ul className="text-xs flex flex-col gap-1" style={{ color: "rgba(255,255,255,0.6)" }}>
            {propagateConfirm.aliasesAffected > 0 && (
              <li>• <span style={{ color: "#fff" }}>{propagateConfirm.aliasesAffected}</span> alias{propagateConfirm.aliasesAffected !== 1 ? "es" : ""} on this node</li>
            )}
            {propagateConfirm.filesAffected > 0 && (
              <li>• references in <span style={{ color: "#fff" }}>{propagateConfirm.filesAffected}</span> file{propagateConfirm.filesAffected !== 1 ? "s" : ""}</li>
            )}
          </ul>
          <div className="flex flex-col gap-2 mt-1">
            <button
              onClick={propagateConfirm.onConfirm}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(96,165,250,0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(96,165,250,0.15)")}
            >
              Yes, update everywhere
            </button>
            <button
              onClick={propagateConfirm.onCancel}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: "transparent", color: "rgba(255,255,255,0.4)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

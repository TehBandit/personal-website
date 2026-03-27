import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import Header from "../components/Header.jsx";
import FilesEditor from "../components/FilesEditor.jsx";
import { X, Network, Upload, FileText, CheckCircle, AlertCircle, RotateCcw, ChevronDown, Search, Crosshair, SlidersHorizontal, Folder, FilePlus, MessageSquare } from "lucide-react";
import WorkspaceChat from "../components/WorkspaceChat.jsx";
import { NODE_TYPE_CONFIG } from "../constants/nodeTypes.js";
import { darkenHex } from "../utils/color.js";
import { computeOwnFileIds } from "../utils/graphHelpers.js";

const GRAPH_BG = "#0f0f1a";

const EXTRACT_FLAVOR = [
  "reading the manuscript...",
  "identifying characters...",
  "mapping locations...",
  "tracing alliances...",
  "following the red yarn...",
  "cross-referencing the archive...",
  "pinning connections...",
  "consulting the lore...",
];

// Read all top-level file entries from a dropped directory via the File System API
async function readDirEntries(dirEntry) {
  return new Promise((resolve) => {
    const results = [];
    const reader = dirEntry.createReader();
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (!entries.length) { resolve(results); return; }
        let pending = entries.length;
        const done = () => { if (--pending === 0) readBatch(); };
        for (const entry of entries) {
          if (entry.isFile) entry.file((file) => { results.push(file); done(); }, done);
          else done();
        }
      });
    };
    readBatch();
  });
}

// Build the derive POST body for a single file (shared by single + bulk derive)
async function buildFileBody(file) {
  if (file.name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return { base64: btoa(binary), type: "docx" };
  }
  return { text: await file.text(), type: "txt" };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function StoryGraph() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodeFileContent, setSelectedNodeFileContent] = useState(null); // raw file text | null
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const searchInputRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [disallowedAliases, setDisallowedAliases] = useState(new Set());
  // Imperative API surfaced by FilesEditor once it has loaded its file list
  const filesEditorApi = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState("note"); // "note" | "derive"
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFolderName, setUploadFolderName] = useState("");
  const [activeTab, setActiveTab] = useState("graph");
  const [uploadFile, setUploadFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractFlavorIdx, setExtractFlavorIdx] = useState(0);
  const [extractResult, setExtractResult] = useState(null);
  const [extractError, setExtractError] = useState(null);
  const [uploadFiles, setUploadFiles] = useState([]);    // bulk: multiple files from a folder
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, currentName }

  // Files list — seeded by a direct fetch on workspace load, then kept current
  // by FilesEditor's onFilesChange prop. Using both sources means nodes are
  // already coloured on the first render (direct fetch runs in parallel with
  // the graph fetch), and any add/delete in the editor propagates immediately.
  const [storyFiles, setStoryFiles] = useState([]);
  // Error state for node-level actions (e.g. "Add Notes" failure)
  const [nodeActionError, setNodeActionError] = useState(null);

  // Workspace hierarchy
  const [workspaces, setWorkspaces] = useState([]);
  const [workspace, setWorkspace] = useState(null);

  // Sidebar groups — all closed by default
  const [openGroups, setOpenGroups] = useState(() => new Set());
  // Derived sub-sections — collapsed by default
  const [openDerived, setOpenDerived] = useState(() => new Set());

  // Graph display settings
  const [nodeTransparent, setNodeTransparent] = useState(false);
  const [nodeBorder, setNodeBorder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleGroup = (type) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const toggleDerived = (type) =>
    setOpenDerived((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const graphContainerRef = useRef(null);
  const fgRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Load workspace list on mount
  useEffect(() => {
    fetch("/api/workspaces")
      .then((r) => r.json())
      .then((d) => {
        const list = d.workspaces || [];
        setWorkspaces(list);
        if (list.length > 0) setWorkspace(list[0].slug);
        else setLoading(false); // no workspaces — stop spinning
      })
      .catch(() => setLoading(false));
  }, []);

  const handleCreateWorkspace = async (name, closeCallback) => {
    if (!name?.trim()) return;
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const created = await res.json();
      setWorkspaces((prev) => [...prev, { slug: created.slug, name: created.name }]);
      setWorkspace(created.slug);
      closeCallback?.();
    }
  };

  // Fetch graph data — extracted into a callback so it can be called after upload too
  // silent=true skips the loading spinner (used for background auto-refresh)
  const loadGraph = useCallback((silent = false) => {
    if (!workspace) return;
    if (!silent) { setLoading(true); setLoadError(null); }
    fetch(`/api/story-notes?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setGraphData(data);
        setDisallowedAliases(new Set((data.disallowedAliases || []).map((a) => a.toLowerCase())));
        if (!silent) setLoading(false);
      })
      .catch((err) => {
        if (!silent) { setLoadError(err.message); setLoading(false); }
      });
  }, [workspace]);

  useEffect(() => { if (workspace) loadGraph(); }, [loadGraph, workspace]);

  // Reset graph state when switching workspaces
  const graphVersionRef = useRef(null);
  useEffect(() => {
    if (!workspace) return;
    graphVersionRef.current = null;
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
  }, [workspace]);

  // Poll /api/graph-version every 2s; silently reload when notes change
  useEffect(() => {
    if (!workspace) return;
    const interval = setInterval(() => {
      fetch(`/api/graph-version?workspace=${encodeURIComponent(workspace)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          if (graphVersionRef.current === null) {
            graphVersionRef.current = data.version; // seed on first read
            return;
          }
          if (data.version !== graphVersionRef.current) {
            graphVersionRef.current = data.version;
            loadGraph(true); // silent refresh
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [loadGraph, workspace]);

  // ownFileIds: node ids that have a dedicated notes-raw file.
  // Seeded immediately from a direct fetch when workspace loads (so nodes are
  // coloured on the very first render, in parallel with the graph fetch).
  // Kept current afterwards by FilesEditor's onFilesChange prop.
  useEffect(() => {
    if (!workspace) return;
    fetch(`/api/notes-raw-list?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d) => setStoryFiles(d.files || []))
      .catch(() => {});
  }, [workspace]); // workspace only — not graphData, so polling reloads don't cause double-fetches

  const ownFileIds = useMemo(
    () => computeOwnFileIds(graphData.nodes, storyFiles),
    [graphData.nodes, storyFiles]
  );

  // Degree map: node id → number of connections
  const degreeMap = useMemo(() => {
    const map = {};
    graphData.links.forEach((l) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      map[s] = (map[s] || 0) + 1;
      map[t] = (map[t] || 0) + 1;
    });
    return map;
  }, [graphData.links]);

  // Radius: min 4 at degree 0, grows with sqrt(degree), uncapped
  const nodeRadius = useCallback(
    (node) => 4 + Math.sqrt(degreeMap[node.id] || 0) * 4,
    [degreeMap]
  );

  // Reconfigure charge force whenever graph data changes so larger nodes repel more
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    // distanceMax of 300 lets islands repel each other enough to stay stable,
    // without pushing them so far apart they can't be seen together.
    fg.d3Force("charge").strength((node) => -(nodeRadius(node) ** 1.8) * 2).distanceMax(200);
    fg.d3ReheatSimulation();
  }, [graphData, nodeRadius]);

  // Flavor text cycling during extraction
  useEffect(() => {
    if (!extracting) return;
    setExtractFlavorIdx(0);
    const t = setInterval(
      () => setExtractFlavorIdx((i) => (i + 1) % EXTRACT_FLAVOR.length),
      1800
    );
    return () => clearInterval(t);
  }, [extracting]);

  const resetUploadModal = () => {
    setUploadFile(null);
    setUploadFiles([]);
    setBulkProgress(null);
    setUploadTitle("");
    setUploadFolderName("");
    setExtractResult(null);
    setExtractError(null);
    setExtracting(false);
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    const ok = file.name.endsWith(".txt") || file.name.endsWith(".md") || file.name.endsWith(".docx");
    if (!ok) { setExtractError("Only .txt, .md, and .docx files are supported."); return; }
    setExtractError(null);
    setExtractResult(null);
    setUploadFile(file);
    // Pre-populate title/folder from filename: strip ext, collapse separator runs, title-case
    const stem = file.name.replace(/\.(md|txt|docx)$/i, "");
    const derived = stem
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    setUploadTitle(derived);
    setUploadFolderName(derived);
  };

  const handleDerive = async () => {
    if (!uploadFile || !uploadFolderName.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);

    try {
      const body = await buildFileBody(uploadFile);

      const res = await fetch("/api/story-derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, workspace, folderName: uploadFolderName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      setExtractResult({ ...data, mode: "derive" });
      loadGraph();
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleFolderSelect = (files, folderName) => {
    const SUPPORTED = /\.(txt|md|docx)$/i;
    const filtered = [...files]
      .filter((f) => SUPPORTED.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!filtered.length) { setExtractError("No supported files found (.txt, .md, .docx)."); return; }
    setExtractError(null);
    setExtractResult(null);
    setUploadFile(null);
    setUploadFiles(filtered);
    if (folderName) {
      const derived = folderName.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
      setUploadFolderName(derived);
    }
  };

  const handleBulkDerive = async () => {
    if (!uploadFiles.length || !uploadFolderName.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);

    const results = [];
    const errors = [];

    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      setBulkProgress({ current: i + 1, total: uploadFiles.length, currentName: file.name });
      try {
        const body = await buildFileBody(file);
        const res = await fetch("/api/story-derive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, workspace, folderName: uploadFolderName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
        results.push({ file: file.name, ...data });
      } catch (err) {
        errors.push({ file: file.name, error: err.message });
      }
    }

    setExtracting(false);
    setBulkProgress(null);
    loadGraph();
    setExtractResult({ mode: "bulk", submode: "derive", results, errors, totalFiles: uploadFiles.length });
  };

  const handleBulkExtract = async () => {
    if (!uploadFiles.length) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);

    const results = [];
    const errors = [];

    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      setBulkProgress({ current: i + 1, total: uploadFiles.length, currentName: file.name });
      try {
        const body = await buildFileBody(file);
        const bodyWithFilename = file.name.endsWith(".docx")
          ? { ...body, filename: file.name }
          : { ...body, filename: file.name.replace(/\.txt$/i, ".md") };
        const res = await fetch("/api/story-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...bodyWithFilename, workspace, folderName: uploadFolderName.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
        results.push({ file: file.name, ...data });
      } catch (err) {
        errors.push({ file: file.name, error: err.message });
      }
    }

    setExtracting(false);
    setBulkProgress(null);
    loadGraph();
    setExtractResult({ mode: "bulk", submode: "note", results, errors, totalFiles: uploadFiles.length });
  };

  const handleExtract = async () => {
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);

    try {
      const body = {
        ...(await buildFileBody(uploadFile)),
        filename: uploadFile.name.endsWith(".docx") ? uploadFile.name : uploadFile.name.replace(/\.txt$/i, ".md"),
      };

      const res = await fetch("/api/story-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, workspace, title: uploadTitle.trim() || undefined }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      setExtractResult(data);
      // Refresh the graph with newly extracted nodes
      loadGraph();
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  // Measure the graph container — ref kept for future use
  // react-force-graph-2d auto-fills its container when no width/height props are passed
  // Resolve and open a node's own raw file in the editor.
  const openNodeFile = useCallback((node) => {
    if (!ownFileIds.has(node.id)) return;
    const api = filesEditorApi.current;
    if (!api?.openFileByName) return;
    const stemHyphen = node.id.replace(/_/g, "-");
    const stemUnder  = node.id;
    const fileSet    = new Set(storyFiles.map((f) => f.filename));
    const basenameToFull = new Map(storyFiles.map((f) => [f.filename.split("/").pop(), f.filename]));
    const gNode = graphData.nodes.find((n) => n.id === node.id);
    const addl = (gNode?.additionalSourceFiles || []).find((sf) => fileSet.has(sf));
    const filename =
      addl ??
      basenameToFull.get(stemHyphen + ".md") ??
      basenameToFull.get(stemHyphen + ".txt") ??
      basenameToFull.get(stemUnder  + ".md") ??
      basenameToFull.get(stemUnder  + ".txt");
    if (!filename) return;
    setActiveTab("files");
    setTimeout(() => api.openFileByName(filename), 80);
  }, [ownFileIds, graphData.nodes, storyFiles]);

  const openNodeById = useCallback((nodeId) => {
    const node = graphData.nodes.find((n) => n.id === nodeId);
    if (node) openNodeFile(node);
  }, [graphData.nodes, openNodeFile]);

  // react-force-graph-2d has no native onNodeDblClick — detect via click timing.
  const lastNodeClickRef = useRef({ id: null, time: 0 });

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    fgRef.current?.centerAt(node.x, node.y, 600);
    fgRef.current?.zoom(2.2, 600);

    // Double-click detection: same node clicked within 350 ms
    const now = Date.now();
    const last = lastNodeClickRef.current;
    if (last.id === node.id && now - last.time < 350) {
      lastNodeClickRef.current = { id: null, time: 0 };
      openNodeFile(node);
    } else {
      lastNodeClickRef.current = { id: node.id, time: now };
    }
  }, [openNodeFile]);

  const commitSearch = useCallback((node) => {
    setSearchQuery("");
    setSearchFocused(false);
    setSearchHighlight(-1);
    searchInputRef.current?.blur();
    handleNodeClick(node);
  }, [handleNodeClick]);

  // Search suggestions — nodes matching by name (or by tag when query starts with "tag:")
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const isTagSearch = q.startsWith("tag:");
    const tagQ = isTagSearch ? q.slice(4).trim() : null;
    if (isTagSearch) {
      if (!tagQ) return [];
      return graphData.nodes
        .filter((n) => (n.tags || []).some((t) => t.includes(tagQ)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 12);
    }
    return graphData.nodes
      .filter((n) => n.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q);
        const bStarts = b.name.toLowerCase().startsWith(q);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [searchQuery, graphData.nodes]);

  const handleSearchKey = useCallback((e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchHighlight((i) => Math.min(i + 1, searchSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const target = searchHighlight >= 0 ? searchSuggestions[searchHighlight] : searchSuggestions[0];
      if (target) commitSearch(target);
    } else if (e.key === "Escape") {
      setSearchQuery("");
      setSearchFocused(false);
      setSearchHighlight(-1);
      searchInputRef.current?.blur();
    }
  }, [searchHighlight, searchSuggestions, commitSearch]);

  const hoveredNeighborIds = useMemo(() => {
    if (!hoveredNode) return null;
    const ids = new Set([hoveredNode.id]);
    for (const link of graphData.links) {
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      if (sourceId === hoveredNode.id) ids.add(targetId);
      if (targetId === hoveredNode.id) ids.add(sourceId);
    }
    return ids;
  }, [hoveredNode, graphData.links]);

  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node || null);
  }, []);

  // ── Focus mode ───────────────────────────────────────────────────────────────
  const [focusNode, setFocusNode] = useState(null);

  const focusNeighborIds = useMemo(() => {
    if (!focusNode) return null;
    const ids = new Set([focusNode.id]);
    for (const link of graphData.links) {
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      if (s === focusNode.id) ids.add(t);
      if (t === focusNode.id) ids.add(s);
    }
    return ids;
  }, [focusNode, graphData.links]);

  // Zoom to focused node when entering focus mode
  useEffect(() => {
    if (!focusNode || !fgRef.current) return;
    fgRef.current.centerAt(focusNode.x, focusNode.y, 600);
    fgRef.current.zoom(2.8, 600);
  }, [focusNode]);

  // Escape to exit focus mode
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && focusNode) setFocusNode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusNode]);

  // Custom canvas rendering for each node
  const nodeCanvasObject = useCallback(
    (node, ctx, globalScale) => {
      const isDerived = !ownFileIds.has(node.id);
      const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
      const baseColor = isDerived ? "#6b7280" : cfg.color;
      const r = isDerived ? Math.max(nodeRadius(node) * 0.65, 3) : nodeRadius(node);
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const isInHoveredNeighborhood = !hoveredNeighborIds || hoveredNeighborIds.has(node.id);
      const inFocusSet = !focusNeighborIds || focusNeighborIds.has(node.id);

      if (!inFocusSet) {
        ctx.globalAlpha = 0.05; // outside focus — strongly dim
      } else if (!!hoveredNode && !isInHoveredNeighborhood) {
        ctx.globalAlpha = 0.2;  // inside focus but outside hover — mildly dim
      }

      // Glow halo when selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = baseColor + "35";
        ctx.fill();
      } else if (hoveredNode && isInHoveredNeighborhood) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
        ctx.fillStyle = baseColor + "22";
        ctx.fill();
      }

      // Circle — hollow or filled depending on settings
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      if (nodeTransparent) {
        // "Hollow": fill with viewport background to mask lines behind, then stroke border
        ctx.fillStyle = GRAPH_BG;
        ctx.fill();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2.2 : 1.8;
        ctx.stroke();
      } else {
        // Filled
        ctx.fillStyle = baseColor;
        ctx.fill();

        // Darken overlay on hover
        if (isHovered && !isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(0,0,0,0.30)";
          ctx.fill();
        }

        // Optional border (slightly darker than fill)
        if (nodeBorder) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.strokeStyle = darkenHex(baseColor === "#6b7280" ? "#6b7280" : baseColor, 0.58);
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Labels: fade out when zoomed out, hide entirely below threshold
      const LABEL_HIDE  = 0.45; // globalScale below this → no label
      const LABEL_FADE  = 0.70; // globalScale below this → fade
      if (globalScale < LABEL_HIDE) { ctx.globalAlpha = 1; return; }
      const zoomAlpha = globalScale < LABEL_FADE
        ? (globalScale - LABEL_HIDE) / (LABEL_FADE - LABEL_HIDE)
        : 1;

      // Mirror the same dim logic used for the node body so labels follow suit
      const dimAlpha = !inFocusSet ? 0.05 : (!!hoveredNode && !isInHoveredNeighborhood) ? 0.2 : 1;
      const labelAlpha = zoomAlpha * dimAlpha;

      const fontSize = Math.max(12 / globalScale, 3.5);
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      const label = node.name;
      const labelY = node.y + r + fontSize * 0.3 + 4 / globalScale;

      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = isSelected ? "#ffffff" : "#cbd5e1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, node.x, labelY);
      ctx.globalAlpha = 1;
    },
    [selectedNode, hoveredNode, hoveredNeighborIds, focusNeighborIds, nodeRadius, ownFileIds, nodeTransparent, nodeBorder]
  );

  const linkColor = useCallback(
    (link) => {
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      if (focusNeighborIds) {
        const bothInFocus = focusNeighborIds.has(sourceId) && focusNeighborIds.has(targetId);
        if (!bothInFocus) return "rgba(255,255,255,0.03)";
        const isFocusLink = sourceId === focusNode.id || targetId === focusNode.id;
        if (!hoveredNode) return isFocusLink ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
      }
      if (!hoveredNode) return "rgba(255,255,255,0.18)";
      const isImmediateNeighborLink = sourceId === hoveredNode.id || targetId === hoveredNode.id;
      return isImmediateNeighborLink ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.06)";
    },
    [hoveredNode, focusNode, focusNeighborIds]
  );

  const linkWidth = useCallback(
    (link) => {
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      if (focusNeighborIds) {
        const bothInFocus = focusNeighborIds.has(sourceId) && focusNeighborIds.has(targetId);
        if (!bothInFocus) return 0.3;
        return sourceId === focusNode.id || targetId === focusNode.id ? 2.2 : 1.5;
      }
      if (!hoveredNode) return 1.5;
      return sourceId === hoveredNode.id || targetId === hoveredNode.id ? 2.2 : 1;
    },
    [hoveredNode, focusNode, focusNeighborIds]
  );

  // Expand click hit-area beyond the visual radius
  const nodePointerAreaPaint = useCallback((node, color, ctx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeRadius(node) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, [nodeRadius]);

  // Create a dedicated notes file for a grey (no-file) node then open it in the editor
  const handleAddNotes = useCallback((node) => {
    if (!filesEditorApi.current || !workspace) return;
    const stem = node.id.replace(/_/g, "-");
    const filename = stem + ".md";
    const title = node.name;
    const body = node.notes?.trim() ? node.notes.trim() : node.excerpt?.trim() ?? "";
    const content = `# ${title}\n\n${body}`;
    fetch(
      `/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${encodeURIComponent(workspace)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }
    )
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then(() => {
        setActiveTab("files");
        const { openFileByName, loadFiles } = filesEditorApi.current;
        if (loadFiles) loadFiles();
        setTimeout(() => openFileByName(filename), 80);
        loadGraph(true);
      })
      .catch((err) => {
        console.error("handleAddNotes failed:", err);
        setNodeActionError("Failed to create notes file");
        setTimeout(() => setNodeActionError(null), 3000);
      });
  }, [workspace, loadGraph]);

  // Connections list for the selected node — memoized to avoid double-compute in render
  // Show raw file content preview for nodes that own a file.
  // Prefer filePreview baked into the graph cache (instant, no fetch).
  // Fall back to a fetch only if the cache predates this feature.
  useEffect(() => {
    if (!selectedNode || !workspace || !ownFileIds.has(selectedNode.id)) {
      setSelectedNodeFileContent(null);
      return;
    }
    // Fast path: graph cache already has the preview
    if (selectedNode.filePreview !== undefined) {
      setSelectedNodeFileContent({ id: selectedNode.id, content: selectedNode.filePreview });
      return;
    }
    // Slow path: fetch from API (cache not yet rebuilt)
    const stemHyphen = selectedNode.id.replace(/_/g, "-");
    const stemUnder  = selectedNode.id;
    const fileSet    = new Set(storyFiles.map((f) => f.filename));
    const basenameToFull = new Map(storyFiles.map((f) => [f.filename.split("/").pop(), f.filename]));
    const gNode = graphData.nodes.find((n) => n.id === selectedNode.id);
    const addl = (gNode?.additionalSourceFiles || []).find((sf) => fileSet.has(sf));
    const filename =
      addl ??
      basenameToFull.get(stemHyphen + ".md") ??
      basenameToFull.get(stemHyphen + ".txt") ??
      basenameToFull.get(stemUnder  + ".md") ??
      basenameToFull.get(stemUnder  + ".txt");
    if (!filename) { setSelectedNodeFileContent(null); return; }
    const nodeId = selectedNode.id;
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.content) { setSelectedNodeFileContent(null); return; }
        const body = d.content.replace(/^[^\n]*\n\n?/, "").trimStart();
        const LIMIT = 600;
        const preview = body.length > LIMIT ? body.slice(0, LIMIT).trimEnd() + "…" : body;
        setSelectedNodeFileContent({ id: nodeId, content: preview });
      })
      .catch(() => setSelectedNodeFileContent(null));
  }, [selectedNode, workspace, ownFileIds, storyFiles, graphData.nodes]);

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) return [];
    return graphData.links
      .filter((l) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        return s === selectedNode.id || t === selectedNode.id;
      })
      .map((l) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        const otherId = s === selectedNode.id ? t : s;
        const other = graphData.nodes.find((n) => n.id === otherId);
        return { other, label: l.label };
      });
  }, [selectedNode, graphData.links, graphData.nodes]);

  if (loading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "#0f0f1a" }}>
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "#60a5fa", borderTopColor: "transparent" }}
            />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading notes...</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "#0f0f1a" }}>
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "#f87171" }}>Failed to load notes: {loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "#0f0f1a" }}>
      <Header />

      {/* Page title bar */}
      <div
        className="flex items-center gap-3 px-6 py-3 border-b"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <Network size={20} className="text-blue-400" />
        <h1 className="text-lg font-semibold text-white tracking-tight">Story Graph</h1>

        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd" }}
        >
          {graphData.nodes.length} nodes · {graphData.links.length} connections
        </span>

        {/* Tab switcher */}
        <div className="flex items-center gap-0.5 ml-4 p-0.5 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
          {[{ id: "graph", icon: <Network size={12} />, label: "Graph" }, { id: "files", icon: <FileText size={12} />, label: "Files" }, { id: "chat", icon: <MessageSquare size={12} />, label: "Chat" }].map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === id ? "rgba(96,165,250,0.2)" : "transparent",
                color: activeTab === id ? "#93c5fd" : "rgba(255,255,255,0.4)",
              }}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        <button
          onClick={() => { resetUploadModal(); setUploadOpen(true); }}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.25)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.15)")}
        >
          <Upload size={14} />
          Upload Notes
        </button>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Files tab (kept mounted to preserve open-file state) ── */}
        <div className="flex flex-1 overflow-hidden min-h-0" style={{ display: activeTab === "files" ? "flex" : "none" }}>
          <FilesEditor
            graphData={graphData}
            workspace={workspace}
            workspaceName={workspaces.find((w) => w.slug === workspace)?.name ?? workspace}
            workspaces={workspaces}
            onWorkspaceChange={setWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            nodeTransparent={nodeTransparent}
            nodeBorder={nodeBorder}
            disallowedAliases={disallowedAliases}
            onReady={(api) => { filesEditorApi.current = api; }}
            onFilesChange={setStoryFiles}
          />
        </div>

        {/* ── Chat tab ── */}
        {activeTab === "chat" && (
          <WorkspaceChat workspace={workspace} onOpenNode={openNodeById} />
        )}

        {/* ── Graph tab (kept mounted to preserve simulation state) ── */}
        <div className="flex flex-1 overflow-hidden min-h-0" style={{ display: activeTab === "graph" ? "flex" : "none" }}>

        {/* ── Left sidebar: grouped collapsible element list ── */}
        <aside
          className="w-60 flex-shrink-0 flex flex-col overflow-y-auto border-r"
          style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <div className="p-3">
            {Object.entries(NODE_TYPE_CONFIG).map(([type, cfg]) => {
              const nodesOfType = graphData.nodes.filter((n) => (n.type || "character") === type);
              if (nodesOfType.length === 0) return null;
              const isOpen = openGroups.has(type);
              const sourceNodes  = nodesOfType.filter((n) =>  ownFileIds.has(n.id));
              const derivedNodes = nodesOfType.filter((n) => !ownFileIds.has(n.id));
              const isDerivedOpen = openDerived.has(type);
              return (
                <div key={type} className="mb-0.5">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(type)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cfg.color }}
                    />
                    <span className="text-xs font-semibold uppercase tracking-widest flex-1 text-left" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {cfg.label}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md font-medium mr-1"
                      style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}
                    >
                      {nodesOfType.length}
                    </span>
                    <ChevronDown
                      size={13}
                      style={{
                        color: "rgba(255,255,255,0.25)",
                        transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 0.2s ease",
                        flexShrink: 0,
                      }}
                    />
                  </button>

                  {/* Node rows */}
                  {isOpen && (
                    <div className="ml-2 flex flex-col gap-0.5 mb-1">
                      {/* Source nodes */}
                      {sourceNodes.map((node) => {
                        const isActive = selectedNode?.id === node.id;
                        return (
                          <button
                            key={node.id}
                            onClick={() => handleNodeClick(node)}
                            className="text-left px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2"
                            style={{ backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "transparent" }}
                            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = isActive ? "rgba(255,255,255,0.08)" : "transparent"; }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: isActive ? cfg.color : "rgba(255,255,255,0.2)" }}
                            />
                            <span className="text-sm leading-tight truncate" style={{ color: isActive ? "#fff" : "rgba(255,255,255,0.65)" }}>
                              {node.name}
                            </span>
                          </button>
                        );
                      })}

                      {/* Derived sub-section */}
                      {derivedNodes.length > 0 && (
                        <div className="ml-3 mt-0.5 border-l" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                          <button
                            onClick={() => toggleDerived(type)}
                            className="w-full flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md transition-colors"
                            style={{ backgroundColor: "transparent" }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: "#6b7280" }} />
                            <span className="text-[10px] uppercase tracking-widest flex-1 text-left" style={{ color: "rgba(255,255,255,0.2)" }}>
                              Derived
                            </span>
                            <span
                              className="text-[10px] px-1 py-0.5 rounded font-medium mr-0.5"
                              style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.18)" }}
                            >
                              {derivedNodes.length}
                            </span>
                            <ChevronDown
                              size={10}
                              style={{
                                color: "rgba(255,255,255,0.15)",
                                transform: isDerivedOpen ? "rotate(0deg)" : "rotate(-90deg)",
                                transition: "transform 0.2s ease",
                                flexShrink: 0,
                              }}
                            />
                          </button>
                          {isDerivedOpen && (
                            <div className="ml-1 flex flex-col gap-0.5 pb-1">
                              {derivedNodes.map((node) => {
                                const isActive = selectedNode?.id === node.id;
                                return (
                                  <button
                                    key={node.id}
                                    onClick={() => handleNodeClick(node)}
                                    className="text-left pl-2 pr-2 py-1 rounded-md transition-colors flex items-center gap-1.5"
                                    style={{ backgroundColor: isActive ? "rgba(255,255,255,0.06)" : "transparent" }}
                                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
                                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = isActive ? "rgba(255,255,255,0.06)" : "transparent"; }}
                                  >
                                    <span
                                      className="w-1 h-1 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: isActive ? "#9ca3af" : "rgba(255,255,255,0.15)" }}
                                    />
                                    <span className="text-xs leading-tight truncate" style={{ color: isActive ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.35)" }}>
                                      {node.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Graph canvas ── */}
        <div ref={graphContainerRef} className="flex-1 relative overflow-hidden">
          {/* Search overlay */}
          <div className="absolute top-3 left-3 z-10" style={{ width: "220px" }}>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                backgroundColor: "rgba(15,15,26,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(8px)",
              }}
            >
              <Search size={13} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search nodes..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchHighlight(-1); }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onKeyDown={handleSearchKey}
                className="bg-transparent outline-none text-sm w-full"
                style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setSearchQuery(""); setSearchHighlight(-1); searchInputRef.current?.focus(); }}
                  style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Suggestions dropdown */}
            {searchFocused && searchSuggestions.length > 0 && (
              <div
                className="mt-1 rounded-xl overflow-hidden"
                style={{
                  backgroundColor: "rgba(15,15,26,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(8px)",
                }}
              >
                {searchSuggestions.map((node, idx) => {
                  const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
                  const isHighlighted = idx === searchHighlight;
                  const isTagSearch = searchQuery.trim().toLowerCase().startsWith("tag:");
                  const tagQ = isTagSearch ? searchQuery.trim().toLowerCase().slice(4).trim() : null;
                  const matchingTags = isTagSearch ? (node.tags || []).filter((t) => t.includes(tagQ)) : [];
                  return (
                    <button
                      key={node.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitSearch(node)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                      style={{
                        backgroundColor: isHighlighted ? "rgba(255,255,255,0.08)" : "transparent",
                      }}
                      onMouseEnter={() => setSearchHighlight(idx)}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ownFileIds.has(node.id) ? cfg.color : "#6b7280" }}
                      />
                      <span className="text-sm truncate" style={{ color: "rgba(255,255,255,0.8)" }}>
                        {node.name}
                      </span>
                      {matchingTags.length > 0 ? (
                        <div className="ml-auto flex gap-1 flex-shrink-0">
                          {matchingTags.map((t) => (
                            <span key={t} className="text-[10px] px-1 rounded" style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd" }}>#{t}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs ml-auto flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
                          {cfg.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            backgroundColor={GRAPH_BG}
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={nodePointerAreaPaint}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkLabel="label"
            nodeLabel={() => ""}
            cooldownTicks={120}
            onEngineStop={() => fgRef.current?.zoomToFit(500, 80)}
            d3AlphaDecay={0.025}
            d3VelocityDecay={0.3}
          />

          {/* Settings button + popover — top-right of graph canvas */}
          <div className="absolute top-3 right-3 z-10">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex items-center justify-center w-8 h-8 rounded-xl transition-colors"
              title="Graph settings"
              style={{
                backgroundColor: settingsOpen ? "rgba(96,165,250,0.18)" : "rgba(15,15,26,0.85)",
                border: `1px solid ${settingsOpen ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.1)"}`,
                backdropFilter: "blur(8px)",
                color: settingsOpen ? "#93c5fd" : "rgba(255,255,255,0.5)",
              }}
            >
              <SlidersHorizontal size={14} />
            </button>

            {settingsOpen && (
              <div
                className="absolute top-10 right-0 rounded-xl overflow-hidden"
                style={{
                  width: "210px",
                  backgroundColor: "rgba(15,15,26,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(12px)",
                }}
              >
                <div className="px-3 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Graph Settings
                  </p>
                </div>
                <div className="p-2 flex flex-col gap-0.5">
                  {/* Hollow nodes toggle */}
                  <button
                    onClick={() => setNodeTransparent((v) => !v)}
                    className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: nodeTransparent ? "rgba(96,165,250,0.1)" : "transparent" }}
                    onMouseEnter={(e) => { if (!nodeTransparent) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { if (!nodeTransparent) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <span className="text-sm" style={{ color: nodeTransparent ? "#93c5fd" : "rgba(255,255,255,0.7)" }}>
                      Outline nodes
                    </span>
                    {/* Toggle pill */}
                    <span
                      className="relative inline-flex flex-shrink-0 h-4 w-7 rounded-full transition-colors"
                      style={{ backgroundColor: nodeTransparent ? "#3b82f6" : "rgba(255,255,255,0.12)" }}
                    >
                      <span
                        className="absolute top-0.5 h-3 w-3 rounded-full transition-transform"
                        style={{
                          backgroundColor: "#fff",
                          transform: nodeTransparent ? "translateX(14px)" : "translateX(2px)",
                        }}
                      />
                    </span>
                  </button>
                  {/* Node border toggle — only relevant when not hollow */}
                  <button
                    onClick={() => setNodeBorder((v) => !v)}
                    className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: nodeBorder ? "rgba(96,165,250,0.1)" : "transparent",
                      opacity: nodeTransparent ? 0.35 : 1,
                      pointerEvents: nodeTransparent ? "none" : "auto",
                    }}
                    onMouseEnter={(e) => { if (!nodeBorder && !nodeTransparent) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { if (!nodeBorder) e.currentTarget.style.backgroundColor = nodeTransparent ? "transparent" : "transparent"; }}
                  >
                    <span className="text-sm" style={{ color: nodeBorder ? "#93c5fd" : "rgba(255,255,255,0.7)" }}>
                      Node border
                    </span>
                    <span
                      className="relative inline-flex flex-shrink-0 h-4 w-7 rounded-full transition-colors"
                      style={{ backgroundColor: nodeBorder ? "#3b82f6" : "rgba(255,255,255,0.12)" }}
                    >
                      <span
                        className="absolute top-0.5 h-3 w-3 rounded-full transition-transform"
                        style={{
                          backgroundColor: "#fff",
                          transform: nodeBorder ? "translateX(14px)" : "translateX(2px)",
                        }}
                      />
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Focus mode banner */}
          {focusNode && (
            <div
              className="absolute top-3 left-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                transform: "translateX(-50%)",
                backgroundColor: "rgba(15,15,26,0.88)",
                border: "1px solid rgba(96,165,250,0.35)",
                backdropFilter: "blur(8px)",
              }}
            >
              <Crosshair size={11} style={{ color: "#60a5fa", flexShrink: 0 }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                Focusing on <span style={{ color: "#93c5fd", fontWeight: 600 }}>{focusNode.name}</span>
              </span>
              <button
                onClick={() => setFocusNode(null)}
                className="ml-1 transition-opacity opacity-50 hover:opacity-100"
                style={{ color: "rgba(255,255,255,0.7)" }}
                title="Exit focus (Esc)"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* Click-to-dismiss hint */}
          {!selectedNode && !focusNode && (
            <p
              className="absolute bottom-4 left-1/2 text-xs pointer-events-none"
              style={{ color: "rgba(255,255,255,0.25)", transform: "translateX(-50%)" }}
            >
              Click any node to explore its details
            </p>
          )}
        </div>

        {/* ── Right detail panel ── */}
        {selectedNode && (
          <div
            className="w-80 flex-shrink-0 flex flex-col overflow-y-auto border-l"
            style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-4 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {/* Top row: type badge + icon buttons */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ownFileIds.has(selectedNode.id) ? NODE_TYPE_CONFIG[selectedNode.type]?.color : "#6b7280" }}
                  />
                  <span
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  >
                    {NODE_TYPE_CONFIG[selectedNode.type]?.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setFocusNode((prev) => prev?.id === selectedNode.id ? null : selectedNode)}
                    title={focusNode?.id === selectedNode.id ? "Exit focus mode" : "Focus on this node (double-click also works)"}
                    className="p-1 rounded-md transition-colors"
                    style={{ color: focusNode?.id === selectedNode.id ? "#60a5fa" : "rgba(255,255,255,0.3)", backgroundColor: focusNode?.id === selectedNode.id ? "rgba(96,165,250,0.12)" : "transparent" }}
                    onMouseEnter={(e) => { if (focusNode?.id !== selectedNode.id) e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
                    onMouseLeave={(e) => { if (focusNode?.id !== selectedNode.id) e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
                  >
                    <Crosshair size={15} />
                  </button>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="p-1 rounded-md transition-colors"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Name */}
              <h2
                className="text-lg font-semibold leading-tight"
                style={ownFileIds.has(selectedNode.id) ? { color: "#fff", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 } : { color: "#fff" }}
                onClick={() => openNodeFile(selectedNode)}
                title={ownFileIds.has(selectedNode.id) ? "Open file" : undefined}
              >
                {selectedNode.name}
              </h2>

              {/* Excerpt */}
              <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                {selectedNode.excerpt}
              </p>

              {/* Add notes button (grey nodes only) */}
              {!ownFileIds.has(selectedNode.id) && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => handleAddNotes(selectedNode)}
                    title="Create a notes file for this node"
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors"
                    style={{ color: "rgba(255,255,255,0.5)", backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.11)"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
                  >
                    <FilePlus size={13} />
                    Add notes
                  </button>
                  {nodeActionError && (
                    <span className="text-xs" style={{ color: "#f87171" }}>{nodeActionError}</span>
                  )}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="p-5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                Notes
              </p>
              <p
                className="text-sm leading-relaxed whitespace-pre-line"
                style={{ color: "rgba(255,255,255,0.65)" }}
              >
                {(() => {
                  if (ownFileIds.has(selectedNode.id)) {
                    const content = selectedNodeFileContent?.id === selectedNode.id
                      ? selectedNodeFileContent.content
                      : null;
                    return content ?? null;
                  }
                  return selectedNode.notes;
                })()}
              </p>
            </div>

            {/* Connections */}
            <div className="p-5">
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                Connections ({selectedNodeConnections.length})
              </p>
              <div className="flex flex-col gap-1">
                {selectedNodeConnections.map(({ other, label }, i) =>
                  other ? (
                    <button
                      key={i}
                      onClick={() => handleNodeClick(other)}
                      className="text-left px-3 py-2.5 rounded-lg transition-colors"
                      style={{ backgroundColor: "transparent" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: ownFileIds.has(other.id) ? NODE_TYPE_CONFIG[other.type]?.color : "#6b7280" }}
                        />
                        <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>
                          {other.name}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 ml-4" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {label}
                      </p>
                    </button>
                  ) : null
                )}
              </div>
            </div>
          </div>
        )}
        </div> {/* end graph tab */}
      </div>

      {/* ── Upload modal ── */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setUploadOpen(false); } }}
        >
          <div
            className="relative flex flex-col rounded-2xl shadow-2xl w-[92vw] max-w-md"
            style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div>
                <h2 className="text-base font-semibold text-white">Upload Story Notes</h2>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {uploadMode === "note"
                    ? "The AI will extract entities and map their connections automatically."
                    : "The AI will extract every significant entity and create a source file for each."}
                </p>
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
              >
                <X size={16} />
              </button>
            </div>

            {/* Mode toggle — only shown before file is selected or result is shown */}
            {!extracting && !extractResult && (
              <div className="flex gap-1 mx-6 mt-5 p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                {[["note", "Focused Note"], ["derive", "Derive from Text"]].map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => { setUploadMode(mode); resetUploadModal(); }}
                    className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                    style={{
                      background: uploadMode === mode ? "rgba(96,165,250,0.2)" : "transparent",
                      color: uploadMode === mode ? "#93c5fd" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="px-6 py-5 flex flex-col gap-4">

              {/* Result state */}
              {extractResult ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  {extractResult.mode === "bulk" ? (
                    <>
                      <CheckCircle size={36} className="text-emerald-400" />
                      <p className="text-white font-medium text-center">
                        {extractResult.results.length}/{extractResult.totalFiles} files processed
                        {extractResult.errors.length > 0 && (
                          <span style={{ color: "#f87171" }}> · {extractResult.errors.length} failed</span>
                        )}
                      </p>
                      <div className="w-full flex flex-col gap-1 mt-1 max-h-52 overflow-y-auto">
                        {extractResult.results.map((r) => {
                          let summary;
                          if (extractResult.submode === "note") {
                            const created = r.added ?? 0;
                            const updated = r.updated ?? 0;
                            summary = [
                              created > 0 && `${created} new`,
                              updated > 0 && `${updated} updated`,
                            ].filter(Boolean).join(" · ") || "no changes";
                          } else {
                            const created = r.nodesCreated?.length ?? 0;
                            const updated = r.nodesUpdated?.length ?? 0;
                            const mentions = r.mentionsCreated?.length ?? 0;
                            summary = [
                              created > 0 && `${created} new`,
                              updated > 0 && `${updated} updated`,
                              mentions > 0 && `${mentions} minor`,
                            ].filter(Boolean).join(" · ") || (r.alreadyDerived ? "unchanged" : "no changes");
                          }
                          return (
                            <div key={r.file} className="flex items-center gap-2 text-xs">
                              <CheckCircle size={10} className="text-emerald-400 flex-shrink-0" />
                              <span className="font-mono truncate flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>{r.file}</span>
                              <span style={{ color: "rgba(255,255,255,0.3)" }}>{summary}</span>
                            </div>
                          );
                        })}
                        {extractResult.errors.map((e) => (
                          <div key={e.file} className="flex items-center gap-2 text-xs" style={{ color: "#f87171" }}>
                            <AlertCircle size={10} className="flex-shrink-0" />
                            <span className="font-mono truncate flex-1">{e.file}</span>
                            <span className="truncate" style={{ maxWidth: "130px" }}>{e.error}</span>
                          </div>
                        ))}
                      </div>
                      {(() => {
                        const tc = extractResult.submode === "note"
                          ? extractResult.results.reduce((s, r) => s + (r.added ?? 0), 0)
                          : extractResult.results.reduce((s, r) => s + (r.nodesCreated?.length ?? 0), 0);
                        const tu = extractResult.submode === "note"
                          ? extractResult.results.reduce((s, r) => s + (r.updated ?? 0), 0)
                          : extractResult.results.reduce((s, r) => s + (r.nodesUpdated?.length ?? 0), 0);
                        return (tc > 0 || tu > 0) && (
                          <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {[tc > 0 && `${tc} nodes created`, tu > 0 && `${tu} existing updated`].filter(Boolean).join(" · ")}
                          </p>
                        );
                      })()}
                    </>
                  ) : extractResult.alreadyDerived ? (
                    <>
                      <CheckCircle size={36} style={{ color: "#facc15" }} />
                      <p className="text-white font-medium text-center">Already derived</p>
                      <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                        This file is identical to the one previously derived on{" "}
                        {new Date(extractResult.derivedAt).toLocaleDateString()}. No changes made.
                      </p>
                    </>
                  ) : extractResult.mode === "derive" ? (
                    <>
                      <CheckCircle size={36} className="text-emerald-400" />
                      <p className="text-white font-medium text-center">
                        {(extractResult.nodesCreated?.length ?? 0) > 0 && (
                          <>Created {extractResult.nodesCreated.length} source {extractResult.nodesCreated.length === 1 ? "file" : "files"} in <span style={{ color: "#93c5fd" }}>{extractResult.folder}/</span></>
                        )}
                        {(extractResult.nodesCreated?.length ?? 0) > 0 && (extractResult.nodesUpdated?.length ?? 0) > 0 && <span style={{ color: "rgba(255,255,255,0.4)" }}> · </span>}
                        {(extractResult.nodesUpdated?.length ?? 0) > 0 && (
                          <span style={{ color: "#86efac" }}>{extractResult.nodesUpdated.length} existing {extractResult.nodesUpdated.length === 1 ? "node" : "nodes"} updated</span>
                        )}
                        {(extractResult.mentionsCreated?.length ?? 0) > 0 && (
                          <span style={{ color: "rgba(255,255,255,0.5)" }}> · {extractResult.mentionsCreated.length} minor {extractResult.mentionsCreated.length === 1 ? "mention" : "mentions"}</span>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={36} className="text-emerald-400" />
                      <p className="text-white font-medium text-center">
                        {extractResult.added > 0
                          ? `Added ${extractResult.added} new ${extractResult.added === 1 ? "element" : "elements"} to the graph`
                          : extractResult.updated > 0
                            ? "No new elements — existing elements updated."
                            : "No new elements found — they may already be in the graph."}
                      </p>
                      {extractResult.updated > 0 && (
                        <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {extractResult.updated} existing {extractResult.updated === 1 ? "element" : "elements"} updated with new information
                        </p>
                      )}
                      {extractResult.connectionsPatched > 0 && (
                        <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                          +{extractResult.connectionsPatched} new {extractResult.connectionsPatched === 1 ? "connection" : "connections"} added to existing elements
                        </p>
                      )}
                    </>
                  )}

                  {/* Node list — shown for single-file modes only */}
                  {extractResult.mode !== "bulk" && ((extractResult.mode === "derive" ? extractResult.nodesCreated : extractResult.nodes) || []).length > 0 && (
                    <div className="w-full flex flex-col gap-1 mt-1">
                      {(extractResult.mode === "derive" ? extractResult.nodesCreated : extractResult.nodes).map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: NODE_TYPE_CONFIG[n.type]?.color || "#60a5fa" }}
                          />
                          {n.name}
                          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{NODE_TYPE_CONFIG[n.type]?.label}</span>
                        </div>
                      ))}
                      {extractResult.mode === "derive" && (extractResult.nodesUpdated || []).length > 0 && (
                        <>
                          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>Updated existing nodes</p>
                          {extractResult.nodesUpdated.map((n) => (
                            <div key={n.id} className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_TYPE_CONFIG[n.type]?.color || "#60a5fa", opacity: 0.5 }} />
                              {n.name}
                              <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>updated</span>
                            </div>
                          ))}
                        </>
                      )}
                      {extractResult.mode === "derive" && (extractResult.mentionsCreated || []).length > 0 && (
                        <>
                          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>Minor mentions (grey nodes)</p>
                          {extractResult.mentionsCreated.map((n) => (
                            <div key={n.id} className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#6b7280" }} />
                              {n.name}
                              <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>{NODE_TYPE_CONFIG[n.type]?.label}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={resetUploadModal}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                      style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
                    >
                      <RotateCcw size={13} /> Upload another
                    </button>
                    <button
                      onClick={() => setUploadOpen(false)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium"
                      style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                    >
                      View graph
                    </button>
                  </div>
                </div>
              ) : extracting ? (
                /* Extracting state */
                <div className="flex flex-col items-center gap-4 py-6">
                  <div
                    className="w-9 h-9 rounded-full border-2 animate-spin"
                    style={{ borderColor: "#60a5fa", borderTopColor: "transparent" }}
                  />
                  {bulkProgress ? (
                    <>
                      <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                        Processing file {bulkProgress.current} of {bulkProgress.total}
                      </p>
                      <p className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {bulkProgress.currentName}
                      </p>
                    </>
                  ) : (
                    <p
                      key={extractFlavorIdx}
                      className="text-sm"
                      style={{ color: "rgba(255,255,255,0.45)", animation: "fadeIn 0.4s ease" }}
                    >
                      {EXTRACT_FLAVOR[extractFlavorIdx]}
                    </p>
                  )}
                  <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }`}</style>
                </div>
              ) : (
                /* File picker state */
                <>
                  {/* Drop zone */}
                  <div
                    className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-8 px-4 cursor-pointer transition-colors"
                    style={{
                      borderColor: dragOver ? "#60a5fa" : "rgba(255,255,255,0.12)",
                      backgroundColor: dragOver ? "rgba(96,165,250,0.06)" : "transparent",
                    }}
                    onClick={() => folderInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const items = e.dataTransfer.items;
                      if (items?.length) {
                        const entry = items[0].webkitGetAsEntry?.();
                        if (entry?.isDirectory) {
                          const files = await readDirEntries(entry);
                          handleFolderSelect(files, entry.name);
                          return;
                        }
                      }
                      handleFileSelect(e.dataTransfer.files[0]);
                    }}
                  >
                    {uploadFiles.length > 0 ? (
                      <>
                        <Folder size={28} style={{ color: "#60a5fa" }} />
                        <p className="text-sm font-medium text-white">{uploadFiles.length} {uploadFiles.length === 1 ? "file" : "files"} selected</p>
                        <div className="w-full max-h-24 overflow-y-auto flex flex-col gap-0.5">
                          {uploadFiles.map((f) => (
                            <p key={f.name} className="text-xs text-center truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{f.name}</p>
                          ))}
                        </div>
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>click to change folder</p>
                      </>
                    ) : uploadFile ? (
                      <>
                        <FileText size={28} style={{ color: "#60a5fa" }} />
                        <p className="text-sm font-medium text-white">{uploadFile.name}</p>
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                          {(uploadFile.size / 1024).toFixed(1)} KB — click to change
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload size={28} style={{ color: "rgba(255,255,255,0.25)" }} />
                        <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                          Drop a file or folder or <span style={{ color: "#93c5fd" }}>browse</span>
                        </p>
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>Supports .txt, .md, .docx — drop a folder to process all files at once</p>
                      </>
                    )}
                  </div>

                  {/* Fallback: single file picker — always shown when nothing is selected */}
                  {!uploadFile && !uploadFiles.length && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-center w-full"
                      style={{ color: "rgba(255,255,255,0.3)", marginTop: "-8px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                    >
                      or select a single file
                    </button>
                  )}

                  {/* Title / folder name field — shown once a file or folder is selected */}
                  {(uploadFile || uploadFiles.length > 0) && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {(uploadMode === "derive" || uploadFiles.length > 0) ? "Folder name" : "Document title"}
                      </label>
                      <input
                        type="text"
                        value={(uploadMode === "derive" || uploadFiles.length > 0) ? uploadFolderName : uploadTitle}
                        onChange={(e) => (uploadMode === "derive" || uploadFiles.length > 0) ? setUploadFolderName(e.target.value) : setUploadTitle(e.target.value)}
                        placeholder={uploadMode === "derive" ? "e.g. The Sunken Archive" : uploadFiles.length > 0 ? "Optional — leave blank for uploads/" : "e.g. Aldric Senn"}
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", caretColor: "#60a5fa" }}
                        spellCheck={false}
                      />
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                        {uploadMode === "derive" && uploadFiles.length > 1
                          ? `Each of the ${uploadFiles.length} files will be derived and their entities added to this folder.`
                          : uploadMode === "derive"
                          ? "A folder will be created with this name. Each extracted entity gets its own source file inside it."
                          : uploadFiles.length > 1
                          ? `Files will be saved into this folder. Leave blank to save into uploads/.`
                          : "Used as context to help the AI identify the primary subject."}
                      </p>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.docx"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-ignore — webkitdirectory is non-standard but widely supported
                    webkitdirectory=""
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (!files?.length) return;
                      const dirName = files[0].webkitRelativePath.split("/")[0];
                      handleFolderSelect(files, dirName);
                      e.target.value = "";
                    }}
                  />

                  {extractError && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "#f87171" }}>
                      <AlertCircle size={14} />
                      {extractError}
                    </div>
                  )}

                  <button
                    disabled={
                      (!uploadFile && !uploadFiles.length) ||
                      (uploadMode === "derive" && !uploadFolderName.trim())
                    }
                    onClick={
                      uploadFiles.length > 0
                        ? uploadMode === "derive" ? handleBulkDerive : handleBulkExtract
                        : uploadMode === "derive" ? handleDerive : handleExtract
                    }
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                    style={{
                      backgroundColor: ((uploadFile || uploadFiles.length > 0) && (uploadMode !== "derive" || uploadFolderName.trim())) ? "#3b82f6" : "rgba(59,130,246,0.3)",
                      color: ((uploadFile || uploadFiles.length > 0) && (uploadMode !== "derive" || uploadFolderName.trim())) ? "#fff" : "rgba(255,255,255,0.3)",
                      cursor: ((uploadFile || uploadFiles.length > 0) && (uploadMode !== "derive" || uploadFolderName.trim())) ? "pointer" : "not-allowed",
                    }}
                  >
                    {uploadFiles.length > 1
                      ? uploadMode === "derive"
                        ? `Extract Entities (${uploadFiles.length} files)`
                        : `Analyze & Map Connections (${uploadFiles.length} files)`
                      : uploadMode === "derive" ? "Extract Entities" : "Analyze & Map Connections"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

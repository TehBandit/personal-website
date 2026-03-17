import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import Header from "../components/Header.jsx";
import FilesEditor from "../components/FilesEditor.jsx";
import { X, Network, Upload, FileText, CheckCircle, AlertCircle, RotateCcw, ChevronDown, Search } from "lucide-react";

// ── Node type styling ─────────────────────────────────────────────────────────
const NODE_TYPE_CONFIG = {
  character: { color: "#60a5fa", label: "Character" },
  location:  { color: "#34d399", label: "Location"  },
  faction:   { color: "#fb923c", label: "Faction"   },
  artifact:  { color: "#c084fc", label: "Artifact"  },
};

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

// ── Component ─────────────────────────────────────────────────────────────────
export default function StoryGraph() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const searchInputRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("graph");
  const [uploadFile, setUploadFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractFlavorIdx, setExtractFlavorIdx] = useState(0);
  const [extractResult, setExtractResult] = useState(null);
  const [extractError, setExtractError] = useState(null);

  // Sidebar groups — all closed by default
  const [openGroups, setOpenGroups] = useState(() => new Set());
  // Derived sub-sections — collapsed by default
  const [openDerived, setOpenDerived] = useState(() => new Set());

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

  // Fetch graph data — extracted into a callback so it can be called after upload too
  // silent=true skips the loading spinner (used for background auto-refresh)
  const loadGraph = useCallback((silent = false) => {
    if (!silent) { setLoading(true); setLoadError(null); }
    fetch("/api/story-notes")
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setGraphData(data);
        if (!silent) setLoading(false);
      })
      .catch((err) => {
        if (!silent) { setLoadError(err.message); setLoading(false); }
      });
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Poll /api/graph-version every 2s; silently reload when notes change
  const graphVersionRef = useRef(null);
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/graph-version")
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
  }, [loadGraph]);

  // Track which nodes have their own notes-raw file
  const [rawFileSet, setRawFileSet] = useState(new Set());
  useEffect(() => {
    fetch("/api/notes-raw-list")
      .then((r) => r.json())
      .then((d) => setRawFileSet(new Set((d.files || []).map((f) => f.filename))))
      .catch(() => {});
  }, [graphData]); // re-check whenever graph reloads

  // node ids that have a dedicated notes-raw file
  const ownFileIds = useMemo(() => {
    const ids = new Set();
    for (const node of graphData.nodes) {
      const candidate = node.id.replace(/_/g, "-") + ".txt";
      if (rawFileSet.has(candidate)) ids.add(node.id);
    }
    return ids;
  }, [graphData.nodes, rawFileSet]);

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

  // Radius: min 5 at degree 0, grows with sqrt(degree), capped at 16
  const nodeRadius = useCallback(
    (node) => Math.min(5 + Math.sqrt(degreeMap[node.id] || 0) * 3.5, 16),
    [degreeMap]
  );

  // Reconfigure charge force whenever graph data changes so larger nodes repel more
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    fg.d3Force("charge").strength((node) => -(nodeRadius(node) ** 1.8) * 2).distanceMax(120);
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
    setExtractResult(null);
    setExtractError(null);
    setExtracting(false);
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    const ok = file.name.endsWith(".txt") || file.name.endsWith(".docx");
    if (!ok) { setExtractError("Only .txt and .docx files are supported."); return; }
    setExtractError(null);
    setExtractResult(null);
    setUploadFile(file);
  };

  const handleExtract = async () => {
    if (!uploadFile) return;
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);

    try {
      let body;
      if (uploadFile.name.endsWith(".docx")) {
        const arrayBuffer = await uploadFile.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        body = { base64, type: "docx", filename: uploadFile.name };
      } else {
        const text = await uploadFile.text();
        body = { text, type: "txt", filename: uploadFile.name };
      }

      const res = await fetch("/api/story-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    fgRef.current?.centerAt(node.x, node.y, 600);
    fgRef.current?.zoom(2.2, 600);
  }, []);

  const commitSearch = useCallback((node) => {
    setSearchQuery("");
    setSearchFocused(false);
    setSearchHighlight(-1);
    searchInputRef.current?.blur();
    handleNodeClick(node);
  }, [handleNodeClick]);

  // Search suggestions — nodes whose name contains the query (case-insensitive)
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
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
      const shouldDim = !!hoveredNode && !isInHoveredNeighborhood;

      if (shouldDim) {
        ctx.globalAlpha = 0.2;
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

      // Flat filled circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Darken overlay on hover
      if (isHovered && !isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.fill();
      }

      // Labels: fade out when zoomed out, hide entirely below threshold
      const LABEL_HIDE  = 0.45; // globalScale below this → no label
      const LABEL_FADE  = 0.70; // globalScale below this → fade
      if (globalScale < LABEL_HIDE) return;
      const labelAlpha = globalScale < LABEL_FADE
        ? (globalScale - LABEL_HIDE) / (LABEL_FADE - LABEL_HIDE)
        : 1;

      const fontSize = Math.max(12 / globalScale, 3.5);
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      const label = node.name;
      const textWidth = ctx.measureText(label).width;

      const padX = 3 / globalScale;
      const padY = 2 / globalScale;
      const labelY = node.y + r + fontSize * 0.3 + 4 / globalScale;

      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = "rgba(15,15,26,0.75)";
      ctx.fillRect(
        node.x - textWidth / 2 - padX,
        labelY - fontSize / 2 - padY,
        textWidth + padX * 2,
        fontSize + padY * 2
      );

      ctx.fillStyle = isSelected ? "#ffffff" : "#cbd5e1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, node.x, labelY);
      ctx.globalAlpha = 1;
    },
    [selectedNode, hoveredNode, hoveredNeighborIds, nodeRadius, ownFileIds]
  );

  const linkColor = useCallback(
    (link) => {
      if (!hoveredNode) return "rgba(255,255,255,0.18)";
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      const isImmediateNeighborLink = sourceId === hoveredNode.id || targetId === hoveredNode.id;
      return isImmediateNeighborLink ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.06)";
    },
    [hoveredNode]
  );

  const linkWidth = useCallback(
    (link) => {
      if (!hoveredNode) return 1.5;
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      return sourceId === hoveredNode.id || targetId === hoveredNode.id ? 2.2 : 1;
    },
    [hoveredNode]
  );

  // Expand click hit-area beyond the visual radius
  const nodePointerAreaPaint = useCallback((node, color, ctx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeRadius(node) + 4, 0, 2 * Math.PI);
    ctx.fill();
  }, [nodeRadius]);

  // Connections list for the detail panel
  const getNodeConnections = (node) =>
    graphData.links
      .filter((l) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        return s === node.id || t === node.id;
      })
      .map((l) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        const otherId = s === node.id ? t : s;
        const other = graphData.nodes.find((n) => n.id === otherId);
        return { other, label: l.label };
      });

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
        <span className="text-sm text-white/30 ml-1 hidden sm:inline">— The Veldmoor Chronicles</span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd" }}
        >
          {graphData.nodes.length} nodes · {graphData.links.length} connections
        </span>

        {/* Tab switcher */}
        <div className="flex items-center gap-0.5 ml-4 p-0.5 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
          {[{ id: "graph", icon: <Network size={12} />, label: "Graph" }, { id: "files", icon: <FileText size={12} />, label: "Files" }].map(({ id, icon, label }) => (
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
          <FilesEditor graphData={graphData} />
        </div>

        {/* ── Graph tab ── */}
        {activeTab === "graph" && <>

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
                      <span
                        className="text-xs ml-auto flex-shrink-0"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        {cfg.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            backgroundColor="#0f0f1a"
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

          {/* Click-to-dismiss hint */}
          {!selectedNode && (
            <p
              className="absolute bottom-4 left-1/2 text-xs pointer-events-none"
              style={{ color: "rgba(255,255,255,0.25)", transform: "translateX(-50%)" }}
            >
              Click any node to explore its details
            </p>
          )}
        </div>

        {/* ── Right detail panel ── */}
        {activeTab === "graph" && selectedNode && (
          <div
            className="w-80 flex-shrink-0 flex flex-col overflow-y-auto border-l"
            style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
          >
            {/* Header */}
            <div className="p-5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: ownFileIds.has(selectedNode.id) ? NODE_TYPE_CONFIG[selectedNode.type]?.color : "#6b7280" }}
                    />
                    <span
                      className="text-xs font-semibold uppercase tracking-widest"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      {NODE_TYPE_CONFIG[selectedNode.type]?.label}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-white leading-tight">{selectedNode.name}</h2>
                  <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {selectedNode.excerpt}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="flex-shrink-0 mt-0.5 transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                >
                  <X size={16} />
                </button>
              </div>
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
                {selectedNode.notes}
              </p>
            </div>

            {/* Connections */}
            <div className="p-5">
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                Connections ({getNodeConnections(selectedNode).length})
              </p>
              <div className="flex flex-col gap-1">
                {getNodeConnections(selectedNode).map(({ other, label }, i) =>
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
        </> /* end graph tab */}
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
                  The AI will extract entities and map their connections automatically.
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

            <div className="px-6 py-5 flex flex-col gap-4">

              {/* Result state */}
              {extractResult ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle size={36} className="text-emerald-400" />
                  <p className="text-white font-medium text-center">
                    {extractResult.added > 0
                      ? `Added ${extractResult.added} new ${extractResult.added === 1 ? "element" : "elements"} to the graph`
                      : "No new elements found — they may already be in the graph."}
                  </p>
                  {extractResult.connectionsPatched > 0 && (
                    <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                      +{extractResult.connectionsPatched} new {extractResult.connectionsPatched === 1 ? "connection" : "connections"} added to existing elements
                    </p>
                  )}
                  {extractResult.nodes?.length > 0 && (
                    <div className="w-full flex flex-col gap-1 mt-1">
                      {extractResult.nodes.map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: NODE_TYPE_CONFIG[n.type]?.color || "#60a5fa" }}
                          />
                          {n.name}
                          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{NODE_TYPE_CONFIG[n.type]?.label}</span>
                        </div>
                      ))}
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
                  <p
                    key={extractFlavorIdx}
                    className="text-sm"
                    style={{ color: "rgba(255,255,255,0.45)", animation: "fadeIn 0.4s ease" }}
                  >
                    {EXTRACT_FLAVOR[extractFlavorIdx]}
                  </p>
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
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      handleFileSelect(e.dataTransfer.files[0]);
                    }}
                  >
                    {uploadFile ? (
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
                          Drop a file here or <span style={{ color: "#93c5fd" }}>browse</span>
                        </p>
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>Supports .txt and .docx</p>
                      </>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.docx"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />

                  {extractError && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "#f87171" }}>
                      <AlertCircle size={14} />
                      {extractError}
                    </div>
                  )}

                  <button
                    disabled={!uploadFile}
                    onClick={handleExtract}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                    style={{
                      backgroundColor: uploadFile ? "#3b82f6" : "rgba(59,130,246,0.3)",
                      color: uploadFile ? "#fff" : "rgba(255,255,255,0.3)",
                      cursor: uploadFile ? "pointer" : "not-allowed",
                    }}
                  >
                    Analyze &amp; Map Connections
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

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Extension, Mark, Node as TiptapNode } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import { Underline as UnderlineExt } from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import {
  FileText, Plus, Save, Trash2, X, Tag, ChevronRight,
  Folder, FolderOpen, FolderPlus, FilePlus, MoreHorizontal,
  Bold, Italic, Underline, List, ListOrdered,
  Strikethrough, Superscript as SuperscriptIcon, Subscript as SubscriptIcon,
  Heading1, Heading2, Heading3,
  Quote, Code, Minus, Undo, Redo, Eraser, Lock,
  CheckCircle, AlertCircle, Loader, ArrowLeftRight,
  ChevronsDownUp, ChevronsUpDown, Copy, GitMerge, Scissors, Clipboard, Search, Upload,
  Download, Pencil, ChevronDown, Sparkles, WandSparkles, Type, Info, Palette, Highlighter,
} from "lucide-react";
import { TYPE_PRESETS } from "../constants/nodeTypes.js";
import { useNodeTypeConfig } from "../contexts/NodeTypeContext.jsx";
import { darkenHex } from "../utils/color.js";
import { computeOwnFileIds, normalizeToId, extractTitleFromContent } from "../utils/graphHelpers.js";
import { buildWordBoundaryPattern, collectGreedyMatches } from "../../shared/story-rules.js";
import { requestJson } from "../utils/storygraphApi.js";
const MINIMAP_BG = "#0f0f1a";
const DEFAULT_FONT_SIZE_PX = 16;
const MIN_FONT_SIZE_PX = 10;
const MAX_FONT_SIZE_PX = 72;
const DOODLE_PEN_COLOR = "#111827";
const DOODLE_PEN_SIZE = 3;
const DOODLE_ERASER_SIZE = 10;
const DOODLE_CANVAS_WIDTH = 960;
const DOODLE_CANVAS_HEIGHT = 360;
const PROGRAMMATIC_LOAD_SUPPRESS_MS = 2500;
const FONT_FAMILY_OPTIONS = [
  { label: "Roboto", family: '"Roboto", sans-serif', match: ["roboto"] },
  { label: "Open Sans", family: '"Open Sans", sans-serif', match: ["open sans"] },
  { label: "Ubuntu", family: '"Ubuntu", sans-serif', match: ["ubuntu"] },
  { label: "Inter", family: '"Inter", sans-serif', match: ["inter"] },
  { label: "Montserrat", family: '"Montserrat", sans-serif', match: ["montserrat"] },
  { label: "Lato", family: '"Lato", sans-serif', match: ["lato"] },
  { label: "Arimo", family: '"Arimo", sans-serif', match: ["arimo"] },
  { label: "Noto Sans", family: '"Noto Sans", sans-serif', match: ["noto sans"] },
  { label: "Playfair Display", family: '"Playfair Display", serif', match: ["playfair display"] },
  { label: "Arial", family: "Arial, sans-serif", match: ["arial"] },
  { label: "Times New Roman", family: '"Times New Roman", Times, serif', match: ["times new roman"] },
];

const TEXT_COLOR_OPTIONS = [
  { label: "Default", value: "", swatch: "" },
  { label: "Black", value: "#111111", swatch: "#111111" },
  { label: "Slate", value: "#e2e8f0", swatch: "#e2e8f0" },
  { label: "Blue", value: "#60a5fa", swatch: "#60a5fa" },
  { label: "Green", value: "#4ade80", swatch: "#4ade80" },
  { label: "Amber", value: "#fbbf24", swatch: "#fbbf24" },
  { label: "Rose", value: "#fb7185", swatch: "#fb7185" },
  { label: "Purple", value: "#c084fc", swatch: "#c084fc" },
];

const HIGHLIGHT_COLOR_OPTIONS = [
  { label: "None", value: "", swatch: "" },
  { label: "Yellow", value: "rgba(254, 240, 138, 0.42)", swatch: "rgba(254, 240, 138, 0.42)" },
  { label: "Mint", value: "rgba(187, 247, 208, 0.42)", swatch: "rgba(187, 247, 208, 0.42)" },
  { label: "Sky", value: "rgba(191, 219, 254, 0.42)", swatch: "rgba(191, 219, 254, 0.42)" },
  { label: "Peach", value: "rgba(254, 215, 170, 0.42)", swatch: "rgba(254, 215, 170, 0.42)" },
  { label: "Pink", value: "rgba(251, 207, 232, 0.42)", swatch: "rgba(251, 207, 232, 0.42)" },
];

function normalizeCssColorValue(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function colorsMatch(a, b) {
  return normalizeCssColorValue(a) === normalizeCssColorValue(b);
}

function hexToRgbColor(hex) {
  const cleaned = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cleaned)) return null;
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

function findMatchingColorValue(rawValue, options) {
  const rawSig = normalizeCssColorValue(rawValue);
  if (!rawSig) return "";
  for (const option of options) {
    if (!option.value) continue;
    const optionSig = normalizeCssColorValue(option.value);
    if (rawSig === optionSig) return option.value;
    if (option.value.startsWith("#")) {
      const rgb = hexToRgbColor(option.value);
      if (rgb && rawSig === normalizeCssColorValue(rgb)) return option.value;
    }
  }
  return "";
}

function shiftHexTone(hex, amount) {
  const cleaned = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cleaned)) return hex;
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const blend = (channel) => {
    if (amount >= 0) return Math.round(channel + (255 - channel) * amount);
    return Math.round(channel * (1 + amount));
  };
  const toHex = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`;
}

function getTextColorTints(baseColor) {
  if (!baseColor) return [];
  if (!String(baseColor).startsWith("#")) {
    return [{ label: "Default", value: baseColor }];
  }
  return [
    { label: "Lighter 3", value: shiftHexTone(baseColor, 0.52) },
    { label: "Lighter 2", value: shiftHexTone(baseColor, 0.36) },
    { label: "Lighter 1", value: shiftHexTone(baseColor, 0.2) },
    { label: "Default", value: baseColor },
    { label: "Darker 1", value: shiftHexTone(baseColor, -0.16) },
    { label: "Darker 2", value: shiftHexTone(baseColor, -0.3) },
    { label: "Darker 3", value: shiftHexTone(baseColor, -0.44) },
  ];
}

function swatchBackground(value) {
  if (!value) {
    return "rgba(255,255,255,0.18)";
  }
  return value;
}

function findFontFamilyOption(fontFamily) {
  const signature = String(fontFamily || "")
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return FONT_FAMILY_OPTIONS.find((option) => option.match.some((token) => signature.includes(token)));
}

/**
 * Greedy non-overlapping matcher for entity names.
 *
 * Assumes entities are already sorted longest-first. Longer phrases claim spans
 * first ("management history"), then shorter names can only match elsewhere.
 */
function collectGreedyEntityMatches(text, entities, currentFilename = null) {
  const candidates = [];
  for (const entity of (entities || [])) {
    if (currentFilename && entity.filename === currentFilename) continue;
    candidates.push({
      ...entity,
      patternSource: entity.patternSource || buildWordBoundaryPattern(entity.name || ""),
    });
  }

  return collectGreedyMatches(text, candidates).map((m) => ({
    start: m.start,
    end: m.end,
    text: m.text,
    entity: m.item,
  }));
}

/**
 * Small interactive ForceGraph2D showing the focal node + its immediate neighbors.
 * Clicking a neighbor node calls onOpen with that node's file path.
 */
function NodeMinimap({ nodeId, graphData, files, onOpen, nodeTransparent = false, nodeBorder = false }) {
  const NODE_TYPE_CONFIG = useNodeTypeConfig();
  const nodeTypeFallback = Object.values(NODE_TYPE_CONFIG)[0];
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
    () => new Map(files.map((f) => [f.filename.split("/").pop().toLowerCase(), f.filename])),
    [files]
  );

  // Mirror ownFileIds logic from StoryGraph: only nodes with a dedicated stem-named
  // file get their type colour; all others are gray.
  const ownFileIds = useMemo(
    () => computeOwnFileIds(graphData.nodes, files),
    [graphData.nodes, files]
  );

  // react-force-graph-2d has no native dblclick event — detect via click timing.
  const lastMinimapClickRef = useRef({ id: null, time: 0 });

  const handleNodeClick = useCallback(
    (node) => {
      if (node.id === nodeId) return; // clicking focal node does nothing
      if (!ownFileIds.has(node.id)) return; // grey nodes have no file

      // Double-click detection: same node clicked within 350 ms opens its file
      const now = Date.now();
      const last = lastMinimapClickRef.current;
      if (last.id === node.id && now - last.time < 350) {
        lastMinimapClickRef.current = { id: null, time: 0 };
        // Use stem-basename matching — do NOT use node.sourceFile because that
        // is a provenance field (which bulk file it was extracted from) and may
        // point to a different entity's file.
        const stemHyphen = node.id.replace(/_/g, "-");
        const stemUnder = node.id;
        const fullPath =
          fileBasenameMap.get(stemHyphen + ".md") ?? fileBasenameMap.get(stemHyphen + ".txt") ??
          fileBasenameMap.get(stemUnder + ".md") ?? fileBasenameMap.get(stemUnder + ".txt");
        if (fullPath) onOpen(fullPath);
      } else {
        lastMinimapClickRef.current = { id: node.id, time: now };
      }
    },
    [nodeId, ownFileIds, fileBasenameMap, onOpen]
  );

  const nodeCanvasObject = useCallback(
    (node, ctx, globalScale) => {
      const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;
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
    [nodeId, ownFileIds, nodeTransparent, nodeBorder, NODE_TYPE_CONFIG, nodeTypeFallback]
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
      let lastDoc = null;
      let lastSet = DecorationSet.empty;
      let lastFilename = undefined;
      return [
        new Plugin({
          key: entityLinksKey,
          props: {
            decorations(state) {
              const currentFilename = dataRef.current?.currentFilename ?? null;
              if (state.doc === lastDoc && currentFilename === lastFilename) return lastSet;
              lastDoc = state.doc;
              lastFilename = currentFilename;
              const entities = dataRef.current?.entities;
              if (!entities?.length) { lastSet = DecorationSet.empty; return lastSet; }
              const decorations = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                const text = node.text;
                const matches = collectGreedyEntityMatches(text, entities, currentFilename);
                for (const { start, end, entity } of matches) {
                  decorations.push(
                    Decoration.inline(pos + start, pos + end, {
                      class: "entity-link",
                      "data-filename": entity.filename,
                      style: `color:${entity.color};cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:${entity.color}55;`,
                    })
                  );
                }
              });
              lastSet = DecorationSet.create(state.doc, decorations);
              return lastSet;
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

// ── Inline autocomplete dropdown extension ───────────────────────────────────
const autocompleteKey = new PluginKey("autocomplete");
const MIN_AUTOCOMPLETE_PREFIX = 2; // chars typed before suggestions appear
const INDENT_TEXT = "\u00A0\u00A0\u00A0\u00A0";

function insertIndentText(editor) {
  if (!editor?.view) return false;
  const { state, view } = editor;
  view.dispatch(state.tr.insertText(INDENT_TEXT, state.selection.from, state.selection.to));
  return true;
}

function getOutdentRange(state) {
  const { from, $from } = state.selection;
  const lineStart = from - $from.parentOffset;
  const lineTextBeforeCursor = state.doc.textBetween(lineStart, from, "\n", "\0");
  const leadingIndent = lineTextBeforeCursor.match(/^(?:\u00A0{1,4}| {1,4}|\t)/);
  if (!leadingIndent) return null;
  return { from: lineStart, to: lineStart + leadingIndent[0].length };
}

/**
 * Find all completions for the text immediately before the cursor.
 * Returns sorted array of { name, completion, prefixLen, color } or null.
 */
function computeCompletions(state, candidates) {
  if (!candidates?.length) return null;
  const { selection } = state;
  if (!selection.empty) return null; // don’t suggest while text is selected

  const { from } = selection;
  const textBefore = state.doc.textBetween(Math.max(0, from - 80), from, "\n");
  if (!textBefore) return null;

  const lower = textBefore.toLowerCase();
  const items = [];

  for (const { name, color } of candidates) {
    if (name.length <= MIN_AUTOCOMPLETE_PREFIX) continue;
    const maxPrefix = Math.min(name.length - 1, textBefore.length);
    for (let prefixLen = maxPrefix; prefixLen >= MIN_AUTOCOMPLETE_PREFIX; prefixLen--) {
      const prefix = name.slice(0, prefixLen).toLowerCase();
      if (!lower.endsWith(prefix)) continue;
      const beforeIdx = textBefore.length - prefixLen - 1;
      const charBefore = beforeIdx >= 0 ? textBefore[beforeIdx] : null;
      if (charBefore !== null && /\w/.test(charBefore)) continue;
      items.push({ name, completion: name.slice(prefixLen), prefixLen, color });
      break;
    }
  }

  if (!items.length) return null;
  items.sort((a, b) => b.prefixLen - a.prefixLen || a.name.localeCompare(b.name));
  return items;
}

function buildAutocompleteExtension(dataRef) {
  return Extension.create({
    name: "autocomplete",
    // Higher priority than StarterKit (100) so our Tab/Arrow handlers win.
    priority: 1000,

    addKeyboardShortcuts() {
      const accept = (editor) => {
        const data = dataRef.current;
        if (!data?.acItems?.length) return false;
        const item = data.acItems[data.acSelectedIndex ?? 0];
        if (!item) return false;
        editor.commands.insertContent(item.completion);
        data.acItems = null;
        data.acSelectedIndex = 0;
        data.setAcDropdown?.(null);
        return true;
      };

      const insertIndent = (editor) =>
        editor.commands.sinkListItem("listItem") || insertIndentText(editor);

      return {
        Tab: ({ editor }) => accept(editor) || insertIndent(editor),
        "Shift-Tab": ({ editor }) =>
          editor.commands.liftListItem("listItem") || false,
        // Dismiss on Enter (without consuming — let StarterKit insert a newline)
        Enter: () => {
          const data = dataRef.current;
          if (!data?.acItems?.length) return false;
          data.acItems = null;
          data.acSelectedIndex = 0;
          data._acFirstName = undefined;
          data._acSuppressed = true;
          data.setAcDropdown?.(null);
          return false; // don't consume; StarterKit still handles the newline
        },
        ArrowDown: () => {
          const data = dataRef.current;
          if (!data?.acItems?.length) return false;
          const next = ((data.acSelectedIndex ?? 0) + 1) % data.acItems.length;
          data.acSelectedIndex = next;
          data.setAcDropdown?.((prev) => prev ? { ...prev, selectedIndex: next } : null);
          return true;
        },
        ArrowUp: () => {
          const data = dataRef.current;
          if (!data?.acItems?.length) return false;
          const prev = ((data.acSelectedIndex ?? 0) - 1 + data.acItems.length) % data.acItems.length;
          data.acSelectedIndex = prev;
          data.setAcDropdown?.((d) => d ? { ...d, selectedIndex: prev } : null);
          return true;
        },
        Escape: () => {
          const data = dataRef.current;
          if (!data?.acItems?.length) return false;
          data.acItems = null;
          data.acSelectedIndex = 0;
          data._acFirstName = undefined;
          data._acSuppressed = true; // prevent view.update() from immediately reopening
          data.setAcDropdown?.(null);
          return true;
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: autocompleteKey,
          view() {
            return {
              update(view, prevState) {
                const data = dataRef.current;
                if (!data) return;
                // Clear suppress flag only when the document content changes
                // (i.e. the user typed something new after Escape/Enter)
                if (prevState && prevState.doc !== view.state.doc) {
                  data._acSuppressed = false;
                }
                if (data._acSuppressed) return;
                const items = computeCompletions(view.state, data.candidates);
                if (!items) {
                  if (data.acItems) {
                    data.acItems = null;
                    data.acSelectedIndex = 0;
                    data._acFirstName = undefined;
                    data.setAcDropdown?.(null);
                  }
                  return;
                }
                // Reset selected index only when the leading candidate changes
                const newFirst = items[0].name;
                if (data._acFirstName !== newFirst) {
                  data.acSelectedIndex = 0;
                  data._acFirstName = newFirst;
                }
                data.acItems = items;
                const { from } = view.state.selection;
                const coords = view.coordsAtPos(from);
                const x = Math.round(coords.left);
                const y = Math.round(coords.bottom);
                const selectedIndex = data.acSelectedIndex ?? 0;
                // Use a functional updater so React can bail out (same reference)
                // when nothing meaningful changed — prevents spurious re-renders
                // triggered by decoration-only dispatches and cursor-position
                // recalculations that produce semantically identical state.
                data.setAcDropdown?.((prev) => {
                  if (
                    prev &&
                    prev.x === x &&
                    prev.y === y &&
                    prev.selectedIndex === selectedIndex &&
                    prev.items.length === items.length &&
                    prev.items[0]?.name === items[0]?.name
                  ) return prev; // same dropdown — React skips re-render
                  return { x, y, items, selectedIndex };
                });
              },
              destroy() {
                const data = dataRef.current;
                if (data) {
                  data.acItems = null;
                  data.setAcDropdown?.(null);
                }
              },
            };
          },
        }),
      ];
    },
  });
}

const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const FontFamily = Extension.create({
  name: "fontFamily",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => element.style.fontFamily || null,
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) return {};
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily:
        (fontFamily) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontFamily }).run(),
      unsetFontFamily:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});

const TextColor = Extension.create({
  name: "textColor",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => {
              const tag = String(element?.tagName || "").toLowerCase();
              return element.style.color || element.getAttribute("color") || (tag === "font" ? element.getAttribute("color") : null) || null;
            },
            renderHTML: (attributes) => {
              if (!attributes.color) return {};
              return { style: `color: ${attributes.color}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ chain }) =>
          chain().setMark("textStyle", { color }).run(),
      unsetTextColor:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { color: null }).removeEmptyTextStyle().run(),
    };
  },
});

const TextHighlight = Extension.create({
  name: "textHighlight",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element) => {
              const tag = String(element?.tagName || "").toLowerCase();
              return element.style.backgroundColor || element.getAttribute("data-color") || (tag === "mark" ? (element.getAttribute("data-color") || "#FFFF00") : null) || null;
            },
            renderHTML: (attributes) => {
              if (!attributes.backgroundColor) return {};
              return { style: `background-color: ${attributes.backgroundColor}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextHighlight:
        (backgroundColor) =>
        ({ chain }) =>
          chain().setMark("textStyle", { backgroundColor }).run(),
      unsetTextHighlight:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { backgroundColor: null }).removeEmptyTextStyle().run(),
    };
  },
});

const SuperscriptMark = Mark.create({
  name: "superscript",
  excludes: "subscript",

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setSuperscript:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSuperscript:
        () =>
        ({ chain }) =>
          chain().unsetMark("subscript").toggleMark(this.name).run(),
      unsetSuperscript:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sup>", close: "</sup>", mixable: true, expelEnclosingWhitespace: true },
      },
    };
  },
});

const SubscriptMark = Mark.create({
  name: "subscript",
  excludes: "superscript",

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setSubscript:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSubscript:
        () =>
        ({ chain }) =>
          chain().unsetMark("superscript").toggleMark(this.name).run(),
      unsetSubscript:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: "<sub>", close: "</sub>", mixable: true, expelEnclosingWhitespace: true },
      },
    };
  },
});

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textStyleOpenTag(mark) {
  const attrs = mark?.attrs || {};
  let open = "";
  if (attrs.color) open += `<font color="${escapeHtmlAttr(attrs.color)}">`;
  if (attrs.backgroundColor) open += `<mark data-color="${escapeHtmlAttr(attrs.backgroundColor)}">`;

  const extraStyles = [];
  if (attrs.fontSize) extraStyles.push(`font-size: ${attrs.fontSize}`);
  if (attrs.fontFamily) extraStyles.push(`font-family: ${attrs.fontFamily}`);
  if (extraStyles.length) open += `<span style="${escapeHtmlAttr(extraStyles.join("; "))}">`;

  return open;
}

function textStyleCloseTag(mark) {
  const attrs = mark?.attrs || {};
  let close = "";
  if (attrs.fontSize || attrs.fontFamily) close += "</span>";
  if (attrs.backgroundColor) close += "</mark>";
  if (attrs.color) close += "</font>";
  return close;
}

function DoodleNodeView({ node, updateAttributes, selected }) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [tool, setTool] = useState("pen"); // pen | eraser
  const isFrozen = Boolean(node.attrs.frozen);
  const [showDoodleControls, setShowDoodleControls] = useState(false);
  const [eraserPreview, setEraserPreview] = useState({ x: 0, y: 0, size: DOODLE_ERASER_SIZE, visible: false });

  const ensureCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(240, Number(node.attrs.width) || DOODLE_CANVAS_WIDTH);
    const height = Math.max(120, Number(node.attrs.height) || DOODLE_CANVAS_HEIGHT);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }, [node.attrs.width, node.attrs.height]);

  const paintWhiteBackground = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const loadFromDataUrl = useCallback((dataUrl) => {
    ensureCanvasSize();
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!dataUrl) {
      paintWhiteBackground();
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (typeof window === "undefined" || typeof window.Image !== "function") {
      paintWhiteBackground();
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      paintWhiteBackground();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => paintWhiteBackground();
    img.src = dataUrl;
  }, [ensureCanvasSize, paintWhiteBackground]);

  useEffect(() => {
    loadFromDataUrl(node.attrs.dataUrl || "");
  }, [node.attrs.dataUrl, node.attrs.width, node.attrs.height, loadFromDataUrl]);

  useEffect(() => {
    if (tool !== "eraser") {
      setEraserPreview((prev) => ({ ...prev, visible: false }));
    }
  }, [tool]);

  useEffect(() => {
    if (!isFrozen) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    setShowDoodleControls(false);
    setEraserPreview((prev) => ({ ...prev, visible: false }));
  }, [isFrozen]);

  const getCanvasPoint = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const viewX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const viewY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return {
      x: viewX * scaleX,
      y: viewY * scaleY,
      viewX,
      viewY,
      scale: rect.width / canvas.width,
    };
  }, []);

  const drawSegment = useCallback((from, to, activeTool) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = activeTool === "eraser" ? "#ffffff" : DOODLE_PEN_COLOR;
    ctx.lineWidth = activeTool === "eraser" ? DOODLE_ERASER_SIZE : DOODLE_PEN_SIZE;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }, []);

  const commitDoodle = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateAttributes({ dataUrl: canvas.toDataURL("image/png") });
  }, [updateAttributes]);

  const stopDrawing = useCallback((commit = true) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (commit) commitDoodle();
  }, [commitDoodle]);

  const handleMouseDown = useCallback((event) => {
    if (isFrozen) return;
    if (event.button !== 0) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    setShowDoodleControls(true);
    isDrawingRef.current = true;
    lastPointRef.current = point;
    drawSegment(point, point, tool);
    if (tool === "eraser") {
      setEraserPreview({
        x: point.viewX,
        y: point.viewY,
        size: DOODLE_ERASER_SIZE * point.scale,
        visible: true,
      });
    }
  }, [getCanvasPoint, drawSegment, tool, isFrozen]);

  const handleMouseMove = useCallback((event) => {
    if (isFrozen) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    if (tool === "eraser") {
      setEraserPreview({
        x: point.viewX,
        y: point.viewY,
        size: DOODLE_ERASER_SIZE * point.scale,
        visible: true,
      });
    }
    if (!isDrawingRef.current || !lastPointRef.current) return;
    event.preventDefault();
    drawSegment(lastPointRef.current, point, tool);
    lastPointRef.current = point;
  }, [getCanvasPoint, drawSegment, tool, isFrozen]);

  const handleMouseEnter = useCallback((event) => {
    if (isFrozen) return;
    setShowDoodleControls(true);
    if (tool !== "eraser") return;
    const point = getCanvasPoint(event);
    if (!point) return;
    setEraserPreview({
      x: point.viewX,
      y: point.viewY,
      size: DOODLE_ERASER_SIZE * point.scale,
      visible: true,
    });
  }, [tool, getCanvasPoint, isFrozen]);

  const handleMouseLeave = useCallback(() => {
    setShowDoodleControls(false);
    setEraserPreview((prev) => ({ ...prev, visible: false }));
    stopDrawing(true);
  }, [stopDrawing]);

  return (
    <NodeViewWrapper as="div" className="my-3">
      <div style={{ paddingLeft: 8, paddingRight: 8 }}>
        <div
          style={{
            position: "relative",
            borderRadius: 10,
            border: selected ? "1px solid rgba(96,165,250,0.45)" : "1px solid rgba(255,255,255,0.16)",
            backgroundColor: "rgba(255,255,255,0.02)",
            padding: 10,
          }}
        >
          <div
            style={{ position: "relative" }}
            onMouseEnter={() => setShowDoodleControls(true)}
            onMouseLeave={handleMouseLeave}
          >
            <div
              className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-md px-1.5 py-1 transition-opacity duration-150"
              style={{
                backgroundColor: "rgba(15,15,26,0.78)",
                border: "1px solid rgba(255,255,255,0.12)",
                opacity: showDoodleControls ? 1 : 0,
                pointerEvents: showDoodleControls ? "auto" : "none",
              }}
            >
              <button
                type="button"
                title="Pen"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (isFrozen) return;
                  setTool("pen");
                  setShowDoodleControls(true);
                }}
                className="p-1 rounded"
                style={{
                  color: isFrozen ? "rgba(255,255,255,0.34)" : tool === "pen" ? "#93c5fd" : "rgba(255,255,255,0.62)",
                  backgroundColor: tool === "pen" && !isFrozen ? "rgba(96,165,250,0.2)" : "transparent",
                  cursor: isFrozen ? "not-allowed" : "pointer",
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title="Eraser"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (isFrozen) return;
                  setTool("eraser");
                  setShowDoodleControls(true);
                }}
                className="p-1 rounded"
                style={{
                  color: isFrozen ? "rgba(255,255,255,0.34)" : tool === "eraser" ? "#93c5fd" : "rgba(255,255,255,0.62)",
                  backgroundColor: tool === "eraser" && !isFrozen ? "rgba(96,165,250,0.2)" : "transparent",
                  cursor: isFrozen ? "not-allowed" : "pointer",
                }}
              >
                <Eraser size={12} />
              </button>
            </div>

            {isFrozen && (
              <div
                className="absolute top-3 right-3 z-10 px-1.5 py-1 rounded text-[10px] font-semibold"
                style={{
                  backgroundColor: "rgba(17,24,39,0.72)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.72)",
                  pointerEvents: "none",
                }}
              >
                <Lock size={12} />
              </div>
            )}

            <canvas
              ref={canvasRef}
              width={Number(node.attrs.width) || DOODLE_CANVAS_WIDTH}
              height={Number(node.attrs.height) || DOODLE_CANVAS_HEIGHT}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={() => stopDrawing(true)}
              onMouseEnter={handleMouseEnter}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                backgroundColor: "#ffffff",
                borderRadius: 8,
                cursor: isFrozen ? "not-allowed" : tool === "eraser" ? "none" : "crosshair",
                userSelect: "none",
              }}
            />

            {tool === "eraser" && eraserPreview.visible && (
              <div
                style={{
                  position: "absolute",
                  left: eraserPreview.x,
                  top: eraserPreview.y,
                  width: eraserPreview.size,
                  height: eraserPreview.size,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  border: "1px solid rgba(17,24,39,0.55)",
                  backgroundColor: "rgba(255,255,255,0.18)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

const DoodleBlock = TiptapNode.create({
  name: "doodleBlock",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      dataUrl: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url") || "",
        renderHTML: (attributes) => ({ "data-url": attributes.dataUrl || "" }),
      },
      width: {
        default: DOODLE_CANVAS_WIDTH,
        parseHTML: (element) => Number.parseInt(element.getAttribute("data-width") || String(DOODLE_CANVAS_WIDTH), 10) || DOODLE_CANVAS_WIDTH,
        renderHTML: (attributes) => ({ "data-width": attributes.width || DOODLE_CANVAS_WIDTH }),
      },
      height: {
        default: DOODLE_CANVAS_HEIGHT,
        parseHTML: (element) => Number.parseInt(element.getAttribute("data-height") || String(DOODLE_CANVAS_HEIGHT), 10) || DOODLE_CANVAS_HEIGHT,
        renderHTML: (attributes) => ({ "data-height": attributes.height || DOODLE_CANVAS_HEIGHT }),
      },
      frozen: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-frozen") === "true",
        renderHTML: (attributes) => ({ "data-frozen": attributes.frozen ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-doodle="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-doodle": "true" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DoodleNodeView);
  },

  addCommands() {
    return {
      insertDoodleBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              dataUrl: "",
              width: DOODLE_CANVAS_WIDTH,
              height: DOODLE_CANVAS_HEIGHT,
              frozen: false,
            },
          }),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const escapeAttr = (value) => String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;");
          const attrs = node?.attrs || {};
          state.write(
            `\n<div data-doodle="true" data-url="${escapeAttr(attrs.dataUrl || "")}" data-width="${escapeAttr(attrs.width || DOODLE_CANVAS_WIDTH)}" data-height="${escapeAttr(attrs.height || DOODLE_CANVAS_HEIGHT)}" data-frozen="${attrs.frozen ? "true" : "false"}"></div>\n`
          );
        },
      },
    };
  },
});

function findDoodleNodeAtPos(doc, pos) {
  if (!doc || typeof pos !== "number") return null;
  const candidatePositions = [pos, Math.max(0, pos - 1), Math.min(doc.content.size, pos + 1)];
  for (const probePos of candidatePositions) {
    const direct = doc.nodeAt(probePos);
    if (direct?.type?.name === "doodleBlock") {
      return { pos: probePos, node: direct };
    }
  }

  let found = null;
  const from = Math.max(0, pos - 1);
  const to = Math.min(doc.content.size, pos + 1);
  doc.nodesBetween(from, to, (node, nodePos) => {
    if (node.type?.name === "doodleBlock") {
      found = { pos: nodePos, node };
      return false;
    }
    return true;
  });
  return found;
}

function findImageNodeAtPos(doc, pos) {
  if (!doc || typeof pos !== "number") return null;
  const candidatePositions = [pos, Math.max(0, pos - 1), Math.min(doc.content.size, pos + 1)];
  for (const probePos of candidatePositions) {
    const direct = doc.nodeAt(probePos);
    if (direct?.type?.name === "image") {
      return { pos: probePos, node: direct };
    }
  }

  let found = null;
  const from = Math.max(0, pos - 1);
  const to = Math.min(doc.content.size, pos + 1);
  doc.nodesBetween(from, to, (node, nodePos) => {
    if (node.type?.name === "image") {
      found = { pos: nodePos, node };
      return false;
    }
    return true;
  });
  return found;
}

function sanitizeDownloadStem(stem) {
  return String(stem || "image")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "image";
}

function triggerDownload(href, fileName) {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadImageSourceAsPng(src, fileNameBase) {
  if (!src || typeof window === "undefined") return;

  // Data URLs from local uploads and doodles can be downloaded directly.
  if (src.startsWith("data:image/")) {
    triggerDownload(src, `${fileNameBase}.png`);
    return;
  }

  const img = new window.Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    try {
      triggerDownload(canvas.toDataURL("image/png"), `${fileNameBase}.png`);
    } catch {
      triggerDownload(src, `${fileNameBase}.png`);
    }
  };
  img.onerror = () => triggerDownload(src, `${fileNameBase}.png`);
  img.src = src;
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
  return (
    <span
      className="mx-1 h-4 w-px"
      style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
      aria-hidden="true"
    />
  );
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

function treeUpdateFileMtime(nodes, targetPath, mtime) {
  return nodes.map((node) => {
    if (node.type === "file") {
      return node.path === targetPath ? { ...node, mtime } : node;
    }
    if (node.type === "folder" && node.children) {
      return { ...node, children: treeUpdateFileMtime(node.children, targetPath, mtime) };
    }
    return node;
  });
}

// ── Main component ─────────────────────────────────────────────────────────────
const EMPTY_GRAPH = { nodes: [], links: [] };
const EMPTY_SET = new Set();
const EMPTY_ARR = [];
const TYPE_COLOR_PALETTE = ["#60a5fa","#34d399","#fb923c","#c084fc","#f472b6","#facc15","#38bdf8","#a78bfa","#4ade80","#f87171"];

export default function FilesEditor({ graphData = EMPTY_GRAPH, workspace = null, nodeTransparent = false, nodeBorder = false, disallowedAliases = EMPTY_SET, onReady = null, onFilesChange = null, onWorkspaceNodeTypesChanged = null }) {
  const NODE_TYPE_CONFIG = useNodeTypeConfig();
  const nodeTypeFallback = Object.values(NODE_TYPE_CONFIG)[0];
  const [files, setFiles] = useState([]);
  const ownFileIds = useMemo(
    () => computeOwnFileIds(graphData.nodes, files),
    [graphData.nodes, files]
  );
  const [tree, setTree] = useState([]);
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const [inlineNew, setInlineNew] = useState(null); // { parentPath, type: "file"|"folder", value }
  const [inlineRename, setInlineRename] = useState(null); // { path, value } | null
  const [fileMenuOpen, setFileMenuOpen] = useState(null); // path of file whose menu is open
  const [dragItem, setDragItem] = useState(null);       // { path: string } — drives isDragging visual only
  const dragItemRef = useRef(null);                        // always-current, read inside event handlers
  const [dropIndicator, setDropIndicator] = useState(null); // null | { type:"folder"|"line"|"root", path?, position? }
  const [openFile, setOpenFile] = useState(null);   // { filename, content }
  const [folderDeleteModal, setFolderDeleteModal] = useState(null); // { folderPath, filePaths[] } | null

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const [selectedPaths, setSelectedPaths] = useState(new Set()); // Set<string>
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false); // move-to folder picker open
  const lastClickedPathRef = useRef(null); // anchor for shift-click range

  // ── File menu (toolbar) ───────────────────────────────────────────────────────
  const [fileMenuToolbarOpen, setFileMenuToolbarOpen] = useState(false);
  const [viewMenuToolbarOpen, setViewMenuToolbarOpen] = useState(false);
  const [insertMenuToolbarOpen, setInsertMenuToolbarOpen] = useState(false);
  const [insertTableSubmenuOpen, setInsertTableSubmenuOpen] = useState(false);
  const [insertTableRows, setInsertTableRows] = useState(3);
  const [insertTableCols, setInsertTableCols] = useState(3);
  const [insertTableWithHeaderRow, setInsertTableWithHeaderRow] = useState(true);
  const [fileMenuRename, setFileMenuRename] = useState(null); // { value } | null
  const [nodeInfoOpen, setNodeInfoOpen] = useState(false);   // (i) metadata popup
  const fileMenuToolbarRef = useRef(null);
  const viewMenuToolbarRef = useRef(null);
  const insertMenuToolbarRef = useRef(null);
  const insertTableSubmenuCloseTimerRef = useRef(null);
  const fileMenuRenameInputRef = useRef(null);

  const cancelInsertTableSubmenuClose = useCallback(() => {
    if (insertTableSubmenuCloseTimerRef.current) {
      clearTimeout(insertTableSubmenuCloseTimerRef.current);
      insertTableSubmenuCloseTimerRef.current = null;
    }
  }, []);

  const openInsertTableSubmenu = useCallback(() => {
    cancelInsertTableSubmenuClose();
    setInsertTableSubmenuOpen(true);
  }, [cancelInsertTableSubmenuClose]);

  const queueCloseInsertTableSubmenu = useCallback(() => {
    cancelInsertTableSubmenuClose();
    insertTableSubmenuCloseTimerRef.current = setTimeout(() => {
      setInsertTableSubmenuOpen(false);
      insertTableSubmenuCloseTimerRef.current = null;
    }, 170);
  }, [cancelInsertTableSubmenuClose]);

  useEffect(() => {
    if (!fileMenuToolbarOpen) return;
    const handler = (e) => {
      if (fileMenuToolbarRef.current && !fileMenuToolbarRef.current.contains(e.target)) {
        setFileMenuToolbarOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fileMenuToolbarOpen]);

  useEffect(() => {
    if (!viewMenuToolbarOpen) return;
    const handler = (e) => {
      if (viewMenuToolbarRef.current && !viewMenuToolbarRef.current.contains(e.target)) {
        setViewMenuToolbarOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuToolbarOpen]);

  useEffect(() => {
    if (!insertMenuToolbarOpen) return;
    const handler = (e) => {
      if (insertMenuToolbarRef.current && !insertMenuToolbarRef.current.contains(e.target)) {
        cancelInsertTableSubmenuClose();
        setInsertMenuToolbarOpen(false);
        setInsertTableSubmenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [insertMenuToolbarOpen, cancelInsertTableSubmenuClose]);

  useEffect(() => {
    if (!insertMenuToolbarOpen) {
      cancelInsertTableSubmenuClose();
      setInsertTableSubmenuOpen(false);
    }
  }, [insertMenuToolbarOpen, cancelInsertTableSubmenuClose]);

  useEffect(() => () => cancelInsertTableSubmenuClose(), [cancelInsertTableSubmenuClose]);

  useEffect(() => {
    if (fileMenuRename) fileMenuRenameInputRef.current?.select();
  }, [fileMenuRename]);

  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [propagateMsg, setPropagateMsg] = useState(""); // e.g. "3 files updated"
  const [propagateConfirm, setPropagateConfirm] = useState(null); // { title, oldName, filesAffected, referencesAffected, aliasesAffected } | null
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef(null);
  const workspaceRef = useRef(workspace);
  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);

  // Close file context menu on outside click
  useEffect(() => {
    if (!fileMenuOpen) return;
    const handler = () => setFileMenuOpen(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fileMenuOpen]);

  // Close bulk-move picker on outside click; Escape clears selection
  useEffect(() => {
    const handler = (e) => {
      if (e.type === "keydown" && e.key === "Escape") {
        setSelectedPaths((prev) => { if (prev.size > 0) { lastClickedPathRef.current = null; return new Set(); } return prev; });
        setBulkMoveOpen(false);
        return;
      }
      if (e.type === "mousedown") {
        setBulkMoveOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, []);
  const entityDataRef = useRef({ entities: [], onOpen: null, onHover: null, onHoverEnd: null, currentFilename: null });
  const lastSavedContentRef = useRef(""); // tracks last-written markdown to skip no-op saves
  const openFileRef = useRef(null);        // always current openFile — safe to read inside onUpdate
  const saveFileRef = useRef(null);        // always current saveFile — safe to call inside onUpdate
  const suppressSaveRef = useRef(false);   // true while loading a file — blocks onUpdate from queueing saves
  const userEditIntentRef = useRef(false); // flips true on user input (typing/paste/drop/cut)
  const fileCacheRef = useRef({});         // filename → content string (cleared on workspace change)
  const backlinksCache = useRef({});       // filename → backlinks array (cleared on workspace change)

  // ── Docx import (ref + state only — handler defined after loadFiles/openFileByName)
  const docxImportRef = useRef(null);
  const insertImageInputRef = useRef(null);
  const [docxImporting, setDocxImporting] = useState(false);

  // ── Resizable sidebar ─────────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(224); // 224 = w-56
  const startSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (mv) => setSidebarWidth(Math.max(140, Math.min(480, startW + mv.clientX - startX)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // ── File search ───────────────────────────────────────────────────────────────
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const fileSearchRef = useRef(null);

  // ── Show titles toggle ────────────────────────────────────────────────────────
  const [showTitles, setShowTitles] = useState(true);
  const [fileSortMode, setFileSortMode] = useState("alpha"); // "alpha" | "recent"
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [visualLineTops, setVisualLineTops] = useState([0]);
  const [lineNumberGutterHeight, setLineNumberGutterHeight] = useState(0);
  const editorContentWrapRef = useRef(null);
  const [fontSizeInput, setFontSizeInput] = useState(String(DEFAULT_FONT_SIZE_PX));
  const [fontFamilyMenuOpen, setFontFamilyMenuOpen] = useState(false);
  const [activeFontFamilyLabel, setActiveFontFamilyLabel] = useState("Open Sans");
  const [activeTextColor, setActiveTextColor] = useState("");
  const [activeHighlightColor, setActiveHighlightColor] = useState("");
  const [textColorMenuOpen, setTextColorMenuOpen] = useState(false);
  const [highlightColorMenuOpen, setHighlightColorMenuOpen] = useState(false);
  const [textColorTintBase, setTextColorTintBase] = useState("");
  const fontFamilyMenuRef = useRef(null);
  const textColorMenuRef = useRef(null);
  const highlightColorMenuRef = useRef(null);

  // ── Entity hover preview tooltip ─────────────────────────────────────────────
  const [entityTooltip, setEntityTooltip] = useState(null); // { node, x, y } | null

  // ── Editor context menu (right-click in editor) ──────────────────────────────
  const [editorContextMenu, setEditorContextMenu] = useState(null); // { x, y, selectedText, hasAnySelection, inTable, inDoodle, doodlePos, doodleFrozen, doodleDataUrl, inImage, imagePos, imageSrc } | null
  const [acDropdown, setAcDropdown] = useState(null);              // { x, y, items, selectedIndex } | null

  // ── AI writing assistant ─────────────────────────────────────────────────────
  // aiAssist: null | { action, streaming, result, error, selectionFrom, selectionTo }
  const [aiAssist, setAiAssist] = useState(null);
  const [aiCustomInput, setAiCustomInput] = useState("");
  const aiCustomInputRef = useRef(null);

  // ── Aliases state ────────────────────────────────────────────────────────────
  const [aliases, setAliases] = useState([]);
  const [aliasInput, setAliasInput] = useState("");
  const aliasInputRef = useRef(null);

  // ── Tags state ───────────────────────────────────────────────────────────────
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");

  // ── Node type dropdown ───────────────────────────────────────────────────────
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [newTypeInput, setNewTypeInput] = useState("");
  const typeDropdownRef = useRef(null);
  const newTypeInputRef = useRef(null);

  // Close type dropdown on outside click
  useEffect(() => {
    if (!typeDropdownOpen) return;
    const handler = (e) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target)) {
        setTypeDropdownOpen(false);
        setNewTypeInput("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [typeDropdownOpen]);

  useEffect(() => {
    if (!fontFamilyMenuOpen) return;
    const handler = (e) => {
      if (fontFamilyMenuRef.current && !fontFamilyMenuRef.current.contains(e.target)) {
        setFontFamilyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fontFamilyMenuOpen]);

  useEffect(() => {
    if (!textColorMenuOpen && !highlightColorMenuOpen) return;
    const handler = (e) => {
      if (textColorMenuOpen && textColorMenuRef.current && !textColorMenuRef.current.contains(e.target)) {
        setTextColorMenuOpen(false);
        setTextColorTintBase("");
      }
      if (highlightColorMenuOpen && highlightColorMenuRef.current && !highlightColorMenuRef.current.contains(e.target)) {
        setHighlightColorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [textColorMenuOpen, highlightColorMenuOpen]);

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
    requestJson("/api/notes-backlinks", {
      query: { workspace, filename },
      signal: controller.signal,
    })
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
  // Fallback: match by sourceFile basename — but ONLY when the node id matches the
  // file stem, so a multi-entity extract upload (many nodes sharing one sourceFile)
  // doesn't spuriously attach the first extracted character as the file's node.
  const openNode = useMemo(() => {
    if (!openFile) return null;
    const filename = openFile.filename;
    const basename = filename.split("/").pop();
    const rawStem = basename.replace(/\.(md|txt)$/i, "");
    // Normalize the same way the server does: lowercase + non-alphanumeric → _
    const stemId = normalizeToId(rawStem);
    // Also try the legacy simple form (hyphen→underscore only) as a fallback
    const stemIdLegacy = rawStem.replace(/-/g, "_");
    // 1. Stem ID match (standard notes-raw files and focused-note uploads)
    const byId = graphData.nodes.find((n) => n.id === stemId || n.id === stemIdLegacy);
    if (byId) return byId;
    // 2. Content-title match — for story-extract uploads where the node ID is derived
    //    from the file's title line rather than the filename (e.g. "monitoring_and_controlling_chapter_8"
    //    for a file named "BIT_4484_Notes_8_9_2020.md").
    if (openFile.content) {
      const titleFromContent = extractTitleFromContent(openFile.content);
      if (titleFromContent) {
        const titleId = normalizeToId(titleFromContent);
        const byTitleId = graphData.nodes.find((n) => n.id === titleId);
        if (byTitleId) return byTitleId;
      }
    }
    // 3. Primary sourceFile basename match — only when the node id matches the file stem
    const bySourceFile = graphData.nodes.find(
      (n) => n.sourceFile && n.sourceFile.split("/").pop() === basename && (n.id === stemId || n.id === stemIdLegacy)
    );
    if (bySourceFile) return bySourceFile;
    // 4. Full path match against primarySourceFile — same id-must-match guard
    const byFullPath = graphData.nodes.find(
      (n) => n.sourceFile === filename && (n.id === stemId || n.id === stemIdLegacy)
    );
    if (byFullPath) return byFullPath;
    // 5. Full path match against additionalSourceFiles (merged copies with different names)
    return graphData.nodes.find((n) => (n.additionalSourceFiles || []).includes(filename)) ?? null;
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
      await requestJson("/api/notes-merge", {
        method: "POST",
        body: { workspace, sourceId, targetId },
      });
      setMergeModal(null);
      setMergeStatus(null);
      if (!isOpenAuthority) setOpenFile(null); // open node was the source — it's been deleted
      // if openNode is authority it survives; graph refreshes via version poll
    } catch (err) {
      setMergeStatus({ error: err.message });
    }
  };

  // Map from filename → human-readable node name (for "show titles" mode in sidebar)
  const fileTitleMap = useMemo(() => {
    const map = new Map();
    // Build sourceFile → node lookup.
    // When multiple nodes share a sourceFile (e.g. a story-extract upload creates
    // both a focused document node and many extracted entity nodes), prefer the
    // documentNode — the node explicitly created to represent the file itself.
    const sourceFileMap = new Map();
    for (const node of graphData.nodes) {
      if (!node.sourceFile) continue;
      const key = node.sourceFile.toLowerCase();
      if (!sourceFileMap.has(key) || node.documentNode) sourceFileMap.set(key, node);
    }
    for (const f of files) {
      const basename = f.filename.split("/").pop();
      const rawStem = basename.replace(/\.(md|txt)$/i, "");
      const stemId = normalizeToId(rawStem);
      const stemIdLegacy = rawStem.replace(/-/g, "_");
      // 1. Stem ID match
      const byId = graphData.nodes.find((n) => n.id === stemId || n.id === stemIdLegacy);
      if (byId) { map.set(f.filename, byId.name); continue; }
      // 2. sourceFile match (content-title-derived nodes; documentNode preferred over extracted entities)
      const bySrc = sourceFileMap.get(f.filename.toLowerCase());
      if (bySrc) { map.set(f.filename, bySrc.name); }
    }
    return map;
  }, [files, graphData.nodes]);

  const sortedTree = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const labelForNode = (node) => {
      if (node.type === "file" && showTitles) {
        return fileTitleMap.get(node.path) ?? node.name;
      }
      return node.name;
    };

    const sortNodes = (nodes) => {
      const withSortMeta = (nodes || []).map((node) => {
        if (node.type === "folder") {
          const children = sortNodes(node.children || []);
          const latestMtime = children.reduce(
            (max, child) => Math.max(max, child._sortLatestMtime ?? 0),
            0
          );
          return { ...node, children, _sortLatestMtime: latestMtime };
        }
        const latestMtime = Number.isFinite(node.mtime) ? node.mtime : 0;
        return { ...node, _sortLatestMtime: latestMtime };
      });

      withSortMeta.sort((a, b) => {
        if (fileSortMode === "recent") {
          const recentDiff = (b._sortLatestMtime ?? 0) - (a._sortLatestMtime ?? 0);
          if (recentDiff !== 0) return recentDiff;
        }
        return collator.compare(labelForNode(a), labelForNode(b));
      });

      return withSortMeta;
    };

    return sortNodes(tree);
  }, [tree, fileSortMode, showTitles, fileTitleMap]);

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
    setNodeInfoOpen(false); // close metadata popup whenever file or node changes
    if (!openNode) { setAliases([]); setNodeTitle(""); setTags([]); setNodeTypeOverride(null); return; }
    setAliases(openNode.aliases || []);
    setTags(openNode.tags || []);
    setNodeTitle(openNode.name ?? "");
    setNodeTypeOverride(null); // clear override — graphData now has the authoritative type
  }, [openNode]);

  const saveNodeTitle = useCallback((title) => {
    if (!openFile || !title.trim()) return;
    const trimmed = title.trim();
    const currentName = openNode?.name ?? "";
    if (trimmed === currentName) return;

    const commitChange = () => {
      requestJson("/api/notes-raw-file", {
        method: "PATCH",
        query: { filename: openFile.filename, workspace: workspace ?? "" },
        body: { name: trimmed, propagate: true, affectedFiles: backlinks.map((b) => b.filename) },
      })
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
    requestJson("/api/notes-raw-file", {
      method: "PATCH",
      query: { filename: openFile.filename, workspace: workspaceRef.current ?? "" },
      body: { aliases: next },
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

  const saveTags = useCallback((next) => {
    if (!openFile) return;
    requestJson("/api/notes-raw-file", {
      method: "PATCH",
      query: { filename: openFile.filename, workspace: workspaceRef.current ?? "" },
      body: { tags: next },
    }).catch(() => {});
  }, [openFile]);

  const addTag = useCallback((raw) => {
    const val = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!val || tags.some((t) => t === val)) { setTagInput(""); return; }
    const next = [...tags, val];
    setTags(next);
    saveTags(next);
    setTagInput("");
  }, [tags, saveTags]);

  const removeTag = useCallback((tag) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    saveTags(next);
  }, [tags, saveTags]);

  // ── Node type ────────────────────────────────────────────────────────────────
  // Palette for auto-assigning a color to a brand-new type key is TYPE_COLOR_PALETTE (module scope).
  // Optimistic override — set immediately on selection, cleared when graphData refreshes
  const [nodeTypeOverride, setNodeTypeOverride] = useState(null);

  const saveNodeType = useCallback((typeKey) => {
    if (!openFile) return;
    setNodeTypeOverride(typeKey);
    requestJson("/api/notes-raw-file", {
      method: "PATCH",
      query: { filename: openFile.filename, workspace: workspaceRef.current ?? "" },
      body: { type: typeKey },
    }).catch(() => {});
  }, [openFile]);

  const addWorkspaceType = useCallback((rawKey) => {
    const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
    if (!key) return;
    const usedColors = new Set(Object.values(NODE_TYPE_CONFIG).map((c) => c.color));
    const color = TYPE_COLOR_PALETTE.find((c) => !usedColors.has(c)) ?? "#94a3b8";
    const label = rawKey.trim().charAt(0).toUpperCase() + rawKey.trim().slice(1);
    requestJson("/api/workspaces", {
      method: "PATCH",
      query: { slug: workspace ?? "" },
      body: { addType: { key, color, label } },
    })
      .then((d) => {
        if (d.nodeTypes) {
          onWorkspaceNodeTypesChanged?.(d.nodeTypes);
          saveNodeType(key);
        }
      })
      .catch(() => {});
    setTypeDropdownOpen(false);
    setNewTypeInput("");
  }, [NODE_TYPE_CONFIG, workspace, onWorkspaceNodeTypesChanged, saveNodeType]);

  // Keep refs in sync with their state/callback counterparts every render
  openFileRef.current = openFile;

  // ── Entity link decoration extension (stable ref, never recreated) ───────────
  const entityLinksExtension  = useMemo(() => buildEntityLinksExtension(entityDataRef), []);
  const autocompleteExtension = useMemo(() => buildAutocompleteExtension(entityDataRef), []);

  // ── TipTap editor ────────────────────────────────────────────────────────────
  // Extend UnderlineExt with a tiptap-markdown serializer so underline marks
  // round-trip through the .md file as <u>text</u> HTML.
  const UnderlineWithMd = useMemo(() =>
    UnderlineExt.extend({
      addStorage() {
        return {
          ...this.parent?.(),
          markdown: {
            serialize: { open: "<u>", close: "</u>", mixable: true, expelEnclosingWhitespace: true },
          },
        };
      },
    })
  , []);

  // Serialize textStyle mark attrs as inline span styles so imported color/
  // highlight/font styling survives markdown autosave round-trips.
  const TextStyleWithMd = useMemo(() =>
    TextStyle.extend({
      parseHTML() {
        return [
          ...(this.parent?.() || []),
          {
            tag: "font[color]",
            consuming: false,
            getAttrs: () => ({}),
          },
          {
            tag: "mark[data-color]",
            consuming: false,
            getAttrs: () => ({}),
          },
        ];
      },
      addStorage() {
        return {
          ...this.parent?.(),
          markdown: {
            serialize: {
              open: (_state, mark) => textStyleOpenTag(mark),
              close: (_state, mark) => textStyleCloseTag(mark),
              mixable: true,
              expelEnclosingWhitespace: true,
            },
          },
        };
      },
    })
  , []);

  const editor = useEditor({
    extensions: [
      TextStyleWithMd,
      FontSize,
      FontFamily,
      TextColor,
      TextHighlight,
      StarterKit.configure({ codeBlock: { languageClassPrefix: "" }, underline: false }),
      Markdown.configure({ html: true, tightLists: true }),
      UnderlineWithMd,
      SuperscriptMark,
      SubscriptMark,
      Placeholder.configure({ placeholder: "Start writing your story notes…" }),
      CharacterCount,
      entityLinksExtension,
      autocompleteExtension,
      DoodleBlock,
      Image.configure({ inline: true, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "notes-editor prose prose-invert focus:outline-none max-w-none",
        spellcheck: spellCheckEnabled ? "true" : "false",
      },
      handleDOMEvents: {
        beforeinput() {
          userEditIntentRef.current = true;
          return false;
        },
        paste() {
          userEditIntentRef.current = true;
          return false;
        },
        drop() {
          userEditIntentRef.current = true;
          return false;
        },
        cut() {
          userEditIntentRef.current = true;
          return false;
        },
      },
      handleKeyDown(view, event) {
        // Treat user key actions as edit intent so only user-driven doc changes
        // can trigger autosave.
        if (
          event.key === "Backspace" ||
          event.key === "Delete" ||
          event.key === "Enter" ||
          event.key === "Tab" ||
          event.key.length === 1
        ) {
          userEditIntentRef.current = true;
        }

        if (event.key !== "Tab") return false;
        event.preventDefault();

        const data = entityDataRef.current;
        if (!event.shiftKey && data?.acItems?.length) {
          const item = data.acItems[data.acSelectedIndex ?? 0];
          if (item) {
            const { state, dispatch } = view;
            dispatch(state.tr.insertText(item.completion, state.selection.from, state.selection.to));
          }
          data.acItems = null;
          data.acSelectedIndex = 0;
          data.setAcDropdown?.(null);
          return true;
        }

        const { state, dispatch } = view;
        const listItemType = state.schema.nodes.listItem;
        if (event.shiftKey) {
          if (listItemType && liftListItem(listItemType)(state, dispatch)) return true;
          const range = getOutdentRange(state);
          if (range) dispatch(state.tr.delete(range.from, range.to));
          return true;
        }

        if (listItemType && sinkListItem(listItemType)(state, dispatch)) return true;
        dispatch(state.tr.insertText(INDENT_TEXT, state.selection.from, state.selection.to));
        return true;
      },
    },
    onUpdate: ({ transaction }) => {
      // Suppress saves that fire during programmatic content loads.
      // tiptap-markdown's appendTransaction can normalise the doc even when
      // setContent is called with emitUpdate=false, causing a real onUpdate.
      if (suppressSaveRef.current) return;
      // Skip decoration-only (meta) transactions — docChanged=false means no
      // actual content change, so no dirty mark or save timer needed.
      if (!transaction.docChanged) return;
      // Ignore programmatic/normalization doc changes that happen without
      // explicit user edit intent; this prevents stripping style spans on load.
      if (!userEditIntentRef.current) return;
      setIsDirty(true);
      // Auto-save after 1.5s of inactivity — use ref so we always call the
      // current saveFile even if openFile has changed since editor was created
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveFileRef.current?.(), 1500);
    },
  });

  const getSelectionFontSizePx = useCallback(() => {
    if (!editor) return DEFAULT_FONT_SIZE_PX;
    const raw = editor.getAttributes("textStyle")?.fontSize;
    const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_FONT_SIZE_PX;
  }, [editor]);

  const applyFontSizePx = useCallback((nextRaw) => {
    if (!editor || !openFile) return;
    const parsed = Number.parseInt(String(nextRaw).replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(parsed)) {
      setFontSizeInput(String(getSelectionFontSizePx()));
      return;
    }
    const next = Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, parsed));
    if (next === DEFAULT_FONT_SIZE_PX) {
      editor.chain().focus().unsetFontSize().run();
    } else {
      editor.chain().focus().setFontSize(`${next}px`).run();
    }
    setFontSizeInput(String(next));
  }, [editor, openFile, getSelectionFontSizePx]);

  const increaseFontSize = useCallback(() => {
    applyFontSizePx(getSelectionFontSizePx() + 1);
  }, [applyFontSizePx, getSelectionFontSizePx]);

  const decreaseFontSize = useCallback(() => {
    applyFontSizePx(getSelectionFontSizePx() - 1);
  }, [applyFontSizePx, getSelectionFontSizePx]);

  const getSelectionFontFamilyLabel = useCallback(() => {
    if (!editor) return "Open Sans";
    const raw = editor.getAttributes("textStyle")?.fontFamily;
    if (!raw) return "Open Sans";
    return findFontFamilyOption(raw)?.label ?? "Custom";
  }, [editor]);

  const applyFontFamily = useCallback((fontFamily) => {
    if (!editor || !openFile || !fontFamily) return;
    editor.chain().focus().setFontFamily(fontFamily).run();
    setActiveFontFamilyLabel(findFontFamilyOption(fontFamily)?.label ?? "Custom");
    setFontFamilyMenuOpen(false);
  }, [editor, openFile]);

  const getSelectionTextColor = useCallback(() => {
    if (!editor) return "";
    const raw = editor.getAttributes("textStyle")?.color;
    if (!raw) return "";
    const matched = findMatchingColorValue(raw, TEXT_COLOR_OPTIONS);
    return matched || String(raw).trim();
  }, [editor]);

  const getSelectionHighlightColor = useCallback(() => {
    if (!editor) return "";
    const raw = editor.getAttributes("textStyle")?.backgroundColor;
    if (!raw) return "";
    const matched = findMatchingColorValue(raw, HIGHLIGHT_COLOR_OPTIONS);
    return matched || String(raw).trim();
  }, [editor]);

  const applyTextColor = useCallback((nextColor) => {
    if (!editor || !openFile) return;
    if (!nextColor) {
      editor.chain().focus().unsetTextColor().run();
      setActiveTextColor("");
      setTextColorMenuOpen(false);
      setTextColorTintBase("");
      return;
    }
    editor.chain().focus().setTextColor(nextColor).run();
    setActiveTextColor(nextColor);
    setTextColorMenuOpen(false);
    setTextColorTintBase("");
  }, [editor, openFile]);

  const applyHighlightColor = useCallback((nextColor) => {
    if (!editor || !openFile) return;
    if (!nextColor) {
      editor.chain().focus().unsetTextHighlight().run();
      setActiveHighlightColor("");
      setHighlightColorMenuOpen(false);
      return;
    }
    editor.chain().focus().setTextHighlight(nextColor).run();
    setActiveHighlightColor(nextColor);
    setHighlightColorMenuOpen(false);
  }, [editor, openFile]);

  useEffect(() => {
    if (!editor) return;
    const syncFontSizeInput = () => setFontSizeInput(String(getSelectionFontSizePx()));
    syncFontSizeInput();
    editor.on("selectionUpdate", syncFontSizeInput);
    editor.on("focus", syncFontSizeInput);
    return () => {
      editor.off("selectionUpdate", syncFontSizeInput);
      editor.off("focus", syncFontSizeInput);
    };
  }, [editor, getSelectionFontSizePx]);

  useEffect(() => {
    if (!editor) return;
    const syncFontFamilyLabel = () => setActiveFontFamilyLabel(getSelectionFontFamilyLabel());
    syncFontFamilyLabel();
    editor.on("selectionUpdate", syncFontFamilyLabel);
    editor.on("focus", syncFontFamilyLabel);
    return () => {
      editor.off("selectionUpdate", syncFontFamilyLabel);
      editor.off("focus", syncFontFamilyLabel);
    };
  }, [editor, getSelectionFontFamilyLabel]);

  useEffect(() => {
    if (!editor) return;
    const syncTextColor = () => setActiveTextColor(getSelectionTextColor());
    syncTextColor();
    editor.on("selectionUpdate", syncTextColor);
    editor.on("focus", syncTextColor);
    return () => {
      editor.off("selectionUpdate", syncTextColor);
      editor.off("focus", syncTextColor);
    };
  }, [editor, getSelectionTextColor]);

  useEffect(() => {
    if (!editor) return;
    const syncHighlightColor = () => setActiveHighlightColor(getSelectionHighlightColor());
    syncHighlightColor();
    editor.on("selectionUpdate", syncHighlightColor);
    editor.on("focus", syncHighlightColor);
    return () => {
      editor.off("selectionUpdate", syncHighlightColor);
      editor.off("focus", syncHighlightColor);
    };
  }, [editor, getSelectionHighlightColor]);

  useEffect(() => {
    if (!editor?.view?.dom) return;
    editor.view.dom.setAttribute("spellcheck", spellCheckEnabled ? "true" : "false");
  }, [editor, spellCheckEnabled]);

  useEffect(() => {
    if (!editor || !showLineNumbers) return;

    const syncVisualLines = () => {
      const dom = editor.view?.dom;
      if (!dom) {
        setVisualLineTops([0]);
        setLineNumberGutterHeight(0);
        return;
      }

      const rootRect = dom.getBoundingClientRect();
      if (rootRect.height <= 0) {
        setVisualLineTops([0]);
        setLineNumberGutterHeight(0);
        return;
      }

      const topSet = new Set();
      const addTop = (rawTop) => {
        const rounded = Math.max(0, Math.round(rawTop));
        topSet.add(rounded);
      };

      // Track every rendered text fragment so wrapped lines get their own number.
      const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if ((textNode.textContent || "").trim().length > 0) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const rects = Array.from(range.getClientRects());
          rects.forEach((rect) => {
            if (rect.height > 0) addTop(rect.top - rootRect.top);
          });
        }
        textNode = walker.nextNode();
      }

      // Empty paragraphs don't have text nodes, so include their visual line top.
      dom.querySelectorAll("p, li").forEach((node) => {
        if ((node.textContent || "").trim().length === 0) {
          const rect = node.getBoundingClientRect();
          if (rect.height > 0) addTop(rect.top - rootRect.top);
        }
      });

      const sorted = Array.from(topSet).sort((a, b) => a - b);
      setVisualLineTops(sorted.length > 0 ? sorted : [0]);
      setLineNumberGutterHeight(Math.max(rootRect.height, dom.scrollHeight));
    };

    syncVisualLines();
    editor.on("update", syncVisualLines);
    editor.on("selectionUpdate", syncVisualLines);

    const resizeObserver = new ResizeObserver(syncVisualLines);
    resizeObserver.observe(editor.view.dom);
    if (editorContentWrapRef.current) resizeObserver.observe(editorContentWrapRef.current);

    window.addEventListener("resize", syncVisualLines);

    return () => {
      editor.off("update", syncVisualLines);
      editor.off("selectionUpdate", syncVisualLines);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncVisualLines);
    };
  }, [editor, showLineNumbers, openFile]);

  const indentSelection = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("listItem") && editor.chain().focus().sinkListItem("listItem").run()) return;
    editor.commands.focus();
    insertIndentText(editor);
  }, [editor]);

  const outdentSelection = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("listItem") && editor.chain().focus().liftListItem("listItem").run()) return;
    const range = getOutdentRange(editor.state);
    if (range) editor.chain().focus().deleteRange(range).run();
  }, [editor]);

  const clearFormatting = useCallback(() => {
    if (!editor || !openFile) return;

    // First clear mark-based formatting (bold/italic/underline/code/colors/fonts).
    editor.chain().focus().unsetAllMarks().unsetFontSize().unsetFontFamily().unsetTextColor().unsetTextHighlight().run();

    // Then flatten list nesting as much as possible for the current selection/cursor.
    for (let i = 0; i < 12; i++) {
      if (!editor.isActive("listItem")) break;
      const lifted = editor.chain().focus().liftListItem("listItem").run();
      if (!lifted) break;
    }

    // Finally normalize blocks back to default paragraphs/plain text containers.
    editor.chain().focus().clearNodes().run();
  }, [editor, openFile]);

  const insertTableAtCursor = useCallback((presetRows, presetCols) => {
    if (!editor || !openFile) return;
    const rowsRaw = presetRows ?? insertTableRows;
    const colsRaw = presetCols ?? insertTableCols;
    const rows = Math.max(1, Math.min(20, Number.parseInt(String(rowsRaw), 10) || 3));
    const cols = Math.max(1, Math.min(12, Number.parseInt(String(colsRaw), 10) || 3));

    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: insertTableWithHeaderRow })
      .run();

    setInsertTableRows(rows);
    setInsertTableCols(cols);
    cancelInsertTableSubmenuClose();
    setInsertMenuToolbarOpen(false);
    setInsertTableSubmenuOpen(false);
  }, [editor, openFile, insertTableRows, insertTableCols, insertTableWithHeaderRow, cancelInsertTableSubmenuClose]);

  const quickDownloadPng = useCallback((src, kind = "image") => {
    if (!src) return;
    const rawStem = openFile?.filename?.split("/").pop()?.replace(/\.(md|txt)$/i, "") || kind;
    const fileStem = sanitizeDownloadStem(`${rawStem}-${kind}`);
    downloadImageSourceAsPng(src, fileStem);
  }, [openFile]);

  const handleInsertImageFromDevice = useCallback((file) => {
    if (!editor || !openFile || !file) return;
    if (!file.type?.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) return;
      editor.chain().focus().setImage({ src, alt: file.name || "uploaded image" }).run();
      cancelInsertTableSubmenuClose();
      setInsertMenuToolbarOpen(false);
      setInsertTableSubmenuOpen(false);
    };
    reader.readAsDataURL(file);
  }, [editor, openFile, cancelInsertTableSubmenuClose]);

  // ── Load file list ───────────────────────────────────────────────────────────
  const loadFiles = useCallback(() => {
    if (!workspace) return;
    requestJson("/api/notes-raw-list", { query: { workspace } })
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
    setSelectedPaths(new Set());
    lastClickedPathRef.current = null;
    setBulkMoveOpen(false);
    loadFiles();
  }, [loadFiles]);

  // Notify parent whenever the file list changes (used by StoryGraph to compute ownFileIds
  // without a separate fetch against /api/notes-raw-list).
  useEffect(() => { onFilesChange?.(files); }, [files, onFilesChange]);

  // ── Open a file ──────────────────────────────────────────────────────────────
  const openFileByName = useCallback((filename) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setIsDirty(false);
    setSaveState("idle");

    const applyContent = (filename, content, cachedJson) => {
      setOpenFile({ filename, content });
      userEditIntentRef.current = false;
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
      }, PROGRAMMATIC_LOAD_SUPPRESS_MS);
    };

    // Serve from cache if available — no network round-trip needed
    const cached = fileCacheRef.current[filename];
    if (cached !== undefined) {
      applyContent(filename, cached.content, cached.json ?? null);
      return;
    }

    setLoadingFile(true);
    requestJson("/api/notes-raw-file", { query: { filename, workspace: workspaceRef.current ?? "" } })
      .then((d) => {
        fileCacheRef.current[d.filename] = { content: d.content, json: null };
        applyContent(d.filename, d.content, null);
      })
      .catch(console.error)
      .finally(() => setLoadingFile(false));
  }, [editor]);

  // ── Docx import handler — defined here so loadFiles + openFileByName are in scope ──
  const handleDocxImport = useCallback(async (file) => {
    if (!file || !workspace) return;
    setDocxImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK)
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      const base64 = btoa(binary);

      const stem = file.name.replace(/\.docx$/i, "");
      const slug = stem.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

      const { markdown } = await requestJson("/api/docx-to-md", {
        method: "POST",
        body: { base64, workspace },
      });

      const currentFolder = openFileRef.current?.filename.includes("/")
        ? openFileRef.current.filename.split("/").slice(0, -1).join("/")
        : "";

      // Reuse an existing file when only punctuation differs (e.g. spaces,
      // hyphens, underscores) so imports consistently overwrite the file the
      // user is looking at instead of creating a near-duplicate filename.
      const normalizeStemKey = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/\.(md|txt)$/i, "")
          .replace(/[^a-z0-9]/g, "");
      const stemKey = normalizeStemKey(stem);
      const inCurrentFolder = files.filter((f) => {
        const folder = f.filename.includes("/") ? f.filename.split("/").slice(0, -1).join("/") : "";
        return folder === currentFolder;
      });
      const existing = inCurrentFolder.find((f) => {
        const base = f.filename.split("/").pop() || f.filename;
        return /\.(md|txt)$/i.test(base) && normalizeStemKey(base) === stemKey;
      });

      const filename = slug + ".md";
      const defaultPath = currentFolder ? `${currentFolder}/${filename}` : filename;
      const filePath = existing?.filename || defaultPath;

      // Create on first import; overwrite on subsequent imports of the same file.
      try {
        await requestJson("/api/notes-raw-file", {
          method: "POST",
          query: { filename: filePath, workspace },
          body: { content: markdown, name: stem },
        });
      } catch (writeErr) {
        const isAlreadyExists = String(writeErr?.message || "").includes("File already exists");
        if (!isAlreadyExists) throw writeErr;

        await requestJson("/api/notes-raw-file", {
          method: "PUT",
          query: { filename: filePath, workspace },
          body: { content: markdown },
        });
      }

      // Keep in-memory cache aligned with the just-written upload so reopening
      // the same filename doesn't show stale pre-import content.
      fileCacheRef.current[filePath] = { content: markdown, json: null };

      if (currentFolder) setOpenFolders((prev) => new Set([...prev, currentFolder]));
      loadFiles();
      openFileByName(filePath);
    } catch (err) {
      console.error("docx import error:", err);
    } finally {
      setDocxImporting(false);
    }
  }, [workspace, loadFiles, openFileByName, files]);

  // When editor is ready and we already have openFile set, push content in
  useEffect(() => {
    if (editor && openFile) {
      userEditIntentRef.current = false;
      suppressSaveRef.current = true;
      editor.commands.setContent(openFile.content, false);
      setTimeout(() => {
        lastSavedContentRef.current = editor.storage.markdown.getMarkdown();
        suppressSaveRef.current = false;
        setIsDirty(false);
      }, PROGRAMMATIC_LOAD_SUPPRESS_MS);
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
    requestJson("/api/notes-raw-file", {
      method: "PUT",
      query: { filename: currentFile.filename, workspace: workspaceRef.current ?? "" },
      body: { content },
    })
      .then(() => {
        const savedAt = Date.now();
        lastSavedContentRef.current = content;
        // Update cache — store new content and capture the current parsed JSON
        // so the very next open also skips re-parsing.
        fileCacheRef.current[currentFile.filename] = {
          content,
          json: editor?.getJSON() ?? null,
        };
        setOpenFile((prev) => (prev?.filename === currentFile.filename ? { ...prev, content } : prev));
        setFiles((prev) => prev.map((f) => (f.filename === currentFile.filename ? { ...f, mtime: savedAt } : f)));
        setTree((prev) => treeUpdateFileMtime(prev, currentFile.filename, savedAt));
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

  // ── Create note from selected text ─────────────────────────────────────────
  const createNoteFromSelection = useCallback((selectedText) => {
    if (!selectedText.trim() || !openFile) return;
    const title = selectedText.trim();
    // Slugify: lowercase, collapse whitespace to hyphens, strip non-alphanumeric (keep hyphens)
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-");
    const filename = slug + ".md";
    // Place the new file in the same folder as the current file
    const currentFolder = openFile.filename.includes("/")
      ? openFile.filename.split("/").slice(0, -1).join("/")
      : "";
    const filePath = currentFolder ? `${currentFolder}/${filename}` : filename;
    const content = "";
    requestJson("/api/notes-raw-file", {
      method: "POST",
      query: { filename: filePath, workspace: workspaceRef.current ?? "" },
      body: { content, name: title },
    })
      .then(() => {
        if (currentFolder) setOpenFolders((prev) => new Set([...prev, currentFolder]));
        loadFiles();
        // Save the current file immediately so syncConnectionsForFile picks up
        // the reference to the newly created note and creates the graph connection.
        saveFileRef.current?.();
        openFileByName(filePath);
      })
      .catch(console.error);
  }, [openFile, loadFiles, openFileByName]);

  // ── Create new file ──────────────────────────────────────────────────────────
  const createFile = useCallback((parentPath, name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const filename = /\.(md|txt)$/i.test(trimmed) ? trimmed : trimmed + ".md";
    const nodeName = filename.replace(/\.(md|txt)$/i, "");
    const filePath = parentPath ? `${parentPath}/${filename}` : filename;
    setInlineNew(null);
    requestJson("/api/notes-raw-file", {
      method: "POST",
      query: { filename: filePath, workspace: workspace ?? "" },
      body: { content: "", name: nodeName },
    })
      .then(() => {
        if (parentPath) setOpenFolders((prev) => new Set([...prev, parentPath]));
        loadFiles();
        openFileByName(filePath);
      })
      .catch(console.error);
  }, [loadFiles, openFileByName, workspace]);

  // Expose openFileByName + createFile + loadFiles to the parent on every change.
  // Using a ref-based guard (onReadyCalledRef) here would prevent the parent from
  // getting updated callbacks after a workspace switch, so we call onReady freely.
  useEffect(() => {
    onReady?.({ openFileByName, createFile, loadFiles });
  }, [onReady, openFileByName, createFile, loadFiles]);

  // ── Create new folder ──────────────────────────────────────────────────
  const createFolder = useCallback((parentPath, name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const folderPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    setInlineNew(null);
    requestJson("/api/notes-raw-file", {
      method: "POST",
      query: { filename: folderPath, workspace: workspace ?? "" },
      body: { isFolder: true },
    })
      .then(() => {
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
    requestJson("/api/notes-raw-move", {
      method: "POST",
      query: { workspace: workspace ?? "" },
      body: { from: fromPath, to: toPath },
    })
      .catch((err) => {
        console.error("Move error:", err);
        setFiles(prevFiles);
        setTree(prevTree);
        setOpenFile(prevOpenFile);
        if (prevOpenFile?.filename === fromPath)
          entityDataRef.current.currentFilename = fromPath;
      });
  }, [files, tree, openFile, workspace]);

  // ── Rename file ─────────────────────────────────────────────────────────────
  const renameFile = useCallback(async (oldPath, newName) => {
    if (!newName.trim()) return;
    const dir = oldPath.includes("/") ? oldPath.split("/").slice(0, -1).join("/") : "";
    const ext = oldPath.match(/\.(md|txt)$/i)?.[0] ?? ".md";
    const newBasename = newName.trim().endsWith(".md") || newName.trim().endsWith(".txt")
      ? newName.trim()
      : newName.trim() + ext;
    const newPath = dir ? `${dir}/${newBasename}` : newBasename;
    if (newPath === oldPath) return;
    try {
      await requestJson("/api/notes-raw-move", {
        method: "POST",
        query: { workspace: workspaceRef.current ?? "" },
        body: { from: oldPath, to: newPath },
      });
    } catch (err) {
      window.alert(err.message ?? "Rename failed");
      return;
    }
    if (openFile?.filename === oldPath) setOpenFile((f) => f ? { ...f, filename: newPath } : f);
    loadFiles();
  }, [openFile, loadFiles]);

  // ── Delete file ──────────────────────────────────────────────────────────────
  const deleteFile = useCallback((filename, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${encodeURIComponent(workspaceRef.current ?? "")}`, { method: "DELETE" })
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

  // ── Bulk delete ───────────────────────────────────────────────────────────────
  const bulkDeleteFiles = useCallback(async (paths) => {
    if (!paths.size) return;
    if (!window.confirm(`Delete ${paths.size} file${paths.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    const ws = encodeURIComponent(workspaceRef.current ?? "");
    for (const filename of paths) {
      await fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}&workspace=${ws}`, { method: "DELETE" })
        .catch(console.error);
    }
    setSelectedPaths(new Set());
    lastClickedPathRef.current = null;
    loadFiles();
    if (openFile && paths.has(openFile.filename)) {
      setOpenFile(null);
      editor?.commands.setContent("");
      setIsDirty(false);
    }
  }, [loadFiles, openFile, editor]);

  // ── Bulk move ─────────────────────────────────────────────────────────────────
  const bulkMoveFiles = useCallback(async (paths, toFolderPath) => {
    if (!paths.size) return;
    const ws = encodeURIComponent(workspaceRef.current ?? "");
    for (const fromPath of paths) {
      const basename = fromPath.split("/").pop();
      const toPath = toFolderPath ? `${toFolderPath}/${basename}` : basename;
      if (toPath === fromPath) continue;
      await fetch(`/api/notes-raw-move?workspace=${ws}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromPath, to: toPath }),
      }).catch(console.error);
    }
    setSelectedPaths(new Set());
    lastClickedPathRef.current = null;
    setBulkMoveOpen(false);
    if (toFolderPath) setOpenFolders((prev) => new Set([...prev, toFolderPath]));
    loadFiles();
  }, [loadFiles]);

  // ── Download file ─────────────────────────────────────────────────────────────
  const downloadFile = useCallback(() => {
    if (!openFile) return;
    const content = editor ? editor.storage.markdown.getMarkdown() : openFile.content;
    const basename = openFile.filename.split("/").pop();
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = basename;
    a.click();
    URL.revokeObjectURL(url);
  }, [openFile, editor]);

  // ── AI writing assistant ──────────────────────────────────────────────────────
  const runAiAssist = useCallback(async (action, selectedText, customInstruction = "") => {
    if (!selectedText || !editor) return;
    const { from, to } = editor.state.selection;
    const docContext = editor.storage.markdown.getMarkdown();
    setAiAssist({ action, streaming: true, result: "", error: null, selectionFrom: from, selectionTo: to });
    try {
      const res = await fetch("/api/editor-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text: selectedText,
          context: docContext,
          workspace: workspaceRef.current ?? "",
          custom: customInstruction,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAiAssist((prev) => prev ? { ...prev, streaming: false, error: err.error ?? "Request failed" } : null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === "token") {
              accumulated += msg.content;
              setAiAssist((prev) => prev ? { ...prev, result: accumulated } : null);
            } else if (msg.type === "done") {
              setAiAssist((prev) => prev ? { ...prev, streaming: false } : null);
            } else if (msg.type === "error") {
              setAiAssist((prev) => prev ? { ...prev, streaming: false, error: msg.message } : null);
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (err) {
      setAiAssist((prev) => prev ? { ...prev, streaming: false, error: err.message ?? "Network error" } : null);
    }
  }, [editor]);

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
    const fileBasenameMap = new Map(files.map((f) => [f.filename.split("/").pop().toLowerCase(), f.filename]));
    const fileSet = new Set(files.map((f) => f.filename.toLowerCase()));
    // Derive the node ID for the currently open file so we can exclude all supplemental copies
    // of the same node (not just the exact filename). Prefer openNode.id (handles merged copies
    // whose filename doesn't match the canonical node ID).
    const openBasename = openFile?.filename.split("/").pop() ?? "";
    const openFileNodeId = openNode?.id ?? openBasename.replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
    // For a given text (name or alias) and array of candidate files for one node,
    // return the file whose stem best matches the text. Falls back to first file.
    function bestFileForText(text, nodeFiles) {
      const norm = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const f of nodeFiles) {
        const stem = f.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/[-_]/g, "").toLowerCase();
        if (stem === norm) return f;
      }
      return nodeFiles[0];
    }

    const result = [];
    for (const node of graphData.nodes) {
      if (node.id === openFileNodeId) continue; // skip self AND all supplemental files for the same node
      // Skip grey nodes — they have no dedicated file so they shouldn't appear in References
      if (!ownFileIds.has(node.id)) continue;
      // Resolve the primary file path via stem-based lookup only.
      // Do NOT use node.sourceFile — that is provenance (which bulk file the node was
      // extracted from) and may point to a completely different entity's file.
      const stem = node.id.replace(/_/g, "-");
      const primaryPath =
        fileBasenameMap.get(stem + ".md") ??
        fileBasenameMap.get(stem + ".txt") ??
        fileBasenameMap.get(node.id + ".md") ??
        fileBasenameMap.get(node.id + ".txt");
      if (!primaryPath) continue;

      // Collect ALL files that belong to this node: primary + additionalSourceFiles that exist.
      // Used to route aliases to the most contextually appropriate file.
      const allNodeFiles = [primaryPath];
      for (const sf of (node.additionalSourceFiles || [])) {
        if (sf !== primaryPath && fileSet.has((sf || "").toLowerCase())) allNodeFiles.push(sf);
      }

      const cfg = NODE_TYPE_CONFIG[node.type] || nodeTypeFallback;

      // Push entry for the canonical name, and each alias, each routed to the best-matching file
      // (e.g. alias "Shouyou" routes to dads/shouyou.md rather than hinata_wiki/sh_y_hinata.md).
      const pushEntity = (name) => result.push({
        name,
        filename: bestFileForText(name, allNodeFiles),
        color: cfg.color,
        nodeId: node.id,
        patternSource: buildWordBoundaryPattern(name),
      });

      pushEntity(node.name);

      // Only use explicit aliases defined in the node's aliases array.
      const allAliases = (node.aliases || []).filter((a) => !disallowedAliases.has(a.toLowerCase()));
      for (const alias of allAliases) {
        if (alias.toLowerCase() !== node.name.toLowerCase()) pushEntity(alias);
      }
    }
    // Sort longer names first to prevent partial shadowing
    return result.sort((a, b) => b.name.length - a.name.length);
  }, [graphData.nodes, files, openFile, openNode, disallowedAliases, ownFileIds, NODE_TYPE_CONFIG, nodeTypeFallback]);

  // Keep decoration ref in sync and force the decorator to rerun.
  // IMPORTANT: we must dispatch a ProseMirror transaction AFTER updating the
  // ref, because the decorator reads dataRef.current.currentFilename
  // synchronously during every transaction. TipTap loads new file content via
  // a transaction that fires BEFORE useEffect runs, so without the dispatch
  // below the decorator sees the previous file's name and wrongly
  // suppresses / shows self-links.
  useEffect(() => {
    entityDataRef.current.entities = mentionableEntities;
    entityDataRef.current.onOpen = openFileByName;
    entityDataRef.current.currentFilename = openFile?.filename ?? null;
    // Build a filename → nodeId map from mentionableEntities for fast tooltip lookup.
    // This handles cases where filename stem doesn't match node.id (e.g. shouyou.md → sh_y_hinata).
    const filenameToNodeId = new Map(
      mentionableEntities.filter((e) => e.nodeId).map((e) => [e.filename, e.nodeId])
    );
    entityDataRef.current.onHover = (filename, x, y) => {
      const nodeId = filenameToNodeId.get(filename);
      const node = nodeId
        ? graphData.nodes.find((n) => n.id === nodeId)
        : (() => {
            const basename = filename.split("/").pop();
            return graphData.nodes.find(
              (n) => n.id.replace(/_/g, "-") + ".md" === basename || n.id.replace(/_/g, "-") + ".txt" === basename
            );
          })();
      if (node) setEntityTooltip({ node, x, y });
    };
    entityDataRef.current.onHoverEnd = () => setEntityTooltip(null);

    // Autocomplete candidates are the same set as decoration entities —
    // mentionableEntities already includes aliases as separate entries.
    const candidates = [...mentionableEntities];
    entityDataRef.current.candidates = candidates;
    entityDataRef.current.setAcDropdown = setAcDropdown;

    // Dispatch an empty transaction so ProseMirror reruns decorations() now
    // that the ref values are fresh. Without this the decorator can run with
    // a stale currentFilename (see comment above).
    if (editor?.view) {
      editor.view.dispatch(editor.view.state.tr);
    }
  }, [mentionableEntities, openFileByName, openFile, graphData.nodes, setAcDropdown, editor]);

  // ── Bibliography: nodes mentioned in the open file's prose ──────────────────
  const bibliography = useMemo(() => {
    if (!openFile || !mentionableEntities.length) return [];
    const rawText = openFile.content.toLowerCase();
    const textMatches = collectGreedyEntityMatches(rawText, mentionableEntities);
    const stemWords = new Set(
      openFile.filename.split("/").pop().replace(/\.(md|txt)$/i, "").split(/[-_]/).map((w) => w.toLowerCase())
    );
    const seen = new Set(); // deduplicate by nodeId — one entry per node regardless of which alias or file matched
    const result = [];
    for (const { entity } of textMatches) {
      if (entity.nodeId && seen.has(entity.nodeId)) continue;
      // Skip if entity name words all appear in the filename stem (self)
      const words = entity.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
      if (words.length > 0 && words.every((w) => stemWords.has(w))) continue;
      if (entity.nodeId) seen.add(entity.nodeId);
      else seen.add(entity.filename);
      // Use entity.nodeId to look up the canonical node so aliases always display
      // with the node's proper name and color, even when linking to an additionalSourceFile
      // (e.g. "Shouyou" alias → dads/shouyou.md but node is sh_y_hinata).
      const node = entity.nodeId
        ? graphData.nodes.find((n) => n.id === entity.nodeId)
        : graphData.nodes.find((n) => {
            const nid = entity.filename.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
            return n.id === nid;
          });
      result.push({ ...entity, name: node?.name ?? entity.name });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [openFile, mentionableEntities, graphData.nodes]);

  // Set of filenames that appear in both bibliography and backlinks (mutual / bidirectional)
  const mutualFilenames = useMemo(() => {
    const backlinkSet = new Set(backlinks.map((b) => b.filename));
    return new Set(bibliography.map((e) => e.filename).filter((f) => backlinkSet.has(f)));
  }, [bibliography, backlinks]);

  // Map every workspace filename → canonical node.id, covering sourceFile, additionalSourceFiles,
  // and stem-based matches. Used to show folder prefixes in References and Backlinks.
  // NOTE: stem matching iterates files-first (not node-first via a basenameMap) so that
  // two files with the same basename in different folders (e.g. dads/akaashi.md and
  // tea_stained_polaroids/akaashi.md) both get mapped, rather than one overwriting the other.
  const filenameToNodeId = useMemo(() => {
    const map = new Map();
    const fileSet = new Set(files.map((f) => f.filename.toLowerCase()));

    // Pass 1: additionalSourceFiles for merged nodes (genuine ownership — the user
    // explicitly merged these files into one node). We deliberately exclude node.sourceFile
    // here because sourceFile is a *provenance* field (many extracted nodes can share the
    // same sourceFile) not an ownership field. Stem-based ownership is handled by Pass 2.
    for (const node of graphData.nodes) {
      for (const sf of (node.additionalSourceFiles || [])) {
        if (fileSet.has((sf || "").toLowerCase())) map.set(sf, node.id);
      }
    }

    // Pass 2: stem matching for any files not yet mapped — iterate files so every file
    // gets a chance regardless of whether another file shares the same basename.
    // Use normalizeToId so filenames with spaces, mixed-case, or special chars (e.g.
    // "MNode Value.md", "BIT_4484_Notes.md") match their canonical node IDs.
    for (const { filename } of files) {
      if (map.has(filename)) continue;
      const rawStem = filename.split("/").pop().replace(/\.(md|txt)$/i, "");
      const stemNorm = normalizeToId(rawStem);          // "MNode Value" → "mnode_value"
      const stemUnder = rawStem.toLowerCase().replace(/-/g, "_"); // legacy hyphen→_ fallback
      const node = graphData.nodes.find((n) => n.id === stemNorm || n.id === stemUnder);
      if (node) map.set(filename, node.id);
    }

    return map;
  }, [graphData.nodes, files]);

  // Node IDs that have files in 2+ locations — any entry in References or Backlinks
  // for such a node should display its folder prefix to disambiguate.
  const multiFileNodeIds = useMemo(() => {
    const perNode = new Map(); // nodeId → Set<filename>
    for (const [filename, nodeId] of filenameToNodeId) {
      if (!perNode.has(nodeId)) perNode.set(nodeId, new Set());
      perNode.get(nodeId).add(filename);
    }
    return new Set([...perNode.entries()].filter(([, s]) => s.size > 1).map(([id]) => id));
  }, [filenameToNodeId]);

  const isEditorReady = !!editor && !loadingFile;
  const canEdit = isEditorReady && !!openFile;
  const isPageLoading = loadingFile; // backlinks load in the background — don't block the editor

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
    collect(sortedTree);
    return paths;
  }, [sortedTree]);

  // Flat ordered list of visible file paths (depth-first, respecting open folders).
  // Used for shift-click range selection.
  const flatVisibleFiles = useMemo(() => {
    const result = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === "file") result.push(node.path);
        else if (node.type === "folder" && openFolders.has(node.path) && node.children) walk(node.children);
      }
    };
    walk(sortedTree);
    return result;
  }, [sortedTree, openFolders]);

  // Handle file row click — supports Ctrl/Cmd (toggle), Shift (range), plain (open).
  const handleFileClick = useCallback((path, e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrl) {
      e.preventDefault();
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      lastClickedPathRef.current = path;
      return;
    }

    if (isShift && lastClickedPathRef.current) {
      e.preventDefault();
      const anchor = lastClickedPathRef.current;
      const anchorIdx = flatVisibleFiles.indexOf(anchor);
      const targetIdx = flatVisibleFiles.indexOf(path);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        setSelectedPaths(new Set(flatVisibleFiles.slice(lo, hi + 1)));
      }
      return;
    }

    // Plain click — open file, clear multi-select
    lastClickedPathRef.current = path;
    setSelectedPaths(new Set());
    openFileByName(path);
  }, [flatVisibleFiles, openFileByName]);

  const explorerUltraCompact = sidebarWidth <= 180;
  const explorerCompact = sidebarWidth <= 235;
  const displayChipLabel = explorerUltraCompact
    ? (showTitles ? "T" : "F")
    : explorerCompact
    ? (showTitles ? "Title" : "File")
    : (showTitles ? "Titles" : "Files");
  const sortChipLabel = explorerUltraCompact
    ? (fileSortMode === "recent" ? "R" : "A")
    : explorerCompact
    ? (fileSortMode === "recent" ? "Recent" : "A-Z")
    : (fileSortMode === "recent" ? "Recent" : "A-Z");

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
            onDragOver={(e) => { if (!dragItemRef.current) return; e.preventDefault(); e.stopPropagation(); setDropIndicator({ type: "folder", path: node.path }); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropIndicator((p) => p?.path === node.path ? null : p); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const di = dragItemRef.current; dragItemRef.current = null; setDragItem(null); setDropIndicator(null); if (!di) return; if (di.paths) { bulkMoveFiles(di.paths, node.path); } else { moveFile(di.path, node.path); } }}
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
        const isSelected = selectedPaths.has(node.path);
        const isDragging = dragItem?.paths ? dragItem.paths.has(node.path) : dragItem?.path === node.path;
        const parentPath = node.path.includes("/") ? node.path.split("/").slice(0, -1).join("/") : "";
        const isLineBefore = dropIndicator?.type === "line" && dropIndicator.path === node.path && dropIndicator.position === "before";
        const isLineAfter = dropIndicator?.type === "line" && dropIndicator.path === node.path && dropIndicator.position === "after";
        const rowBg = isSelected
          ? "rgba(96,165,250,0.22)"
          : isActive
          ? "rgba(96,165,250,0.12)"
          : "transparent";

        items.push(
          <div key={node.path} style={{ opacity: isDragging ? 0.4 : 1 }}>
            {isLineBefore && (
              <div style={{ height: 2, margin: `1px 4px 1px ${indent + 20}px`, borderRadius: 1, backgroundColor: "#60a5fa" }} />
            )}
            <div
              draggable={true}
              className="group flex items-center gap-1.5 py-0.5 rounded-md cursor-pointer transition-colors"
              style={{ paddingLeft: indent + 20, paddingRight: 4, backgroundColor: rowBg }}
              onClick={(e) => handleFileClick(node.path, e)}
              onMouseEnter={(e) => { if (!isActive && !isSelected && !dragItem) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (!dragItem) e.currentTarget.style.backgroundColor = rowBg; }}
              onDragStart={(e) => {
                e.stopPropagation();
                // If dragging a file that's part of the multi-selection, carry all selected files.
                // Otherwise just drag the one file.
                const isInSelection = selectedPaths.size > 1 && selectedPaths.has(node.path);
                const item = isInSelection
                  ? { path: node.path, paths: new Set(selectedPaths) }
                  : { path: node.path };
                dragItemRef.current = item;
                setDragItem(item);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", node.path);
              }}
              onDragEnd={() => { dragItemRef.current = null; setDragItem(null); setDropIndicator(null); }}
              onDragOver={(e) => {
                if (!dragItemRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDropIndicator({ type: "line", path: node.path, position });
              }}
              onDragLeave={() => setDropIndicator((p) => p?.type === "line" && p.path === node.path ? null : p)}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation();
                const di = dragItemRef.current; dragItemRef.current = null; setDragItem(null); setDropIndicator(null);
                if (!di) return;
                if (di.paths) { bulkMoveFiles(di.paths, parentPath); } else { moveFile(di.path, parentPath); }
              }}
            >
              <FileText size={13} style={{ color: (isActive || isSelected) ? "#60a5fa" : "rgba(255,255,255,0.3)", flexShrink: 0 }} />
              {inlineRename?.path === node.path ? (
                <input
                  autoFocus
                  type="text"
                  value={inlineRename.value}
                  onChange={(e) => setInlineRename((r) => r ? { ...r, value: e.target.value } : r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); renameFile(node.path, inlineRename.value); setInlineRename(null); }
                    if (e.key === "Escape") setInlineRename(null);
                  }}
                  onBlur={() => setInlineRename(null)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 px-1 py-0 rounded text-sm outline-none bg-transparent"
                  style={{ border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                  spellCheck={false}
                />
              ) : (
                <span className="text-sm truncate flex-1" style={{ color: (isActive || isSelected) ? "#e2e8f0" : "rgba(255,255,255,0.6)" }}>
                  {showTitles ? (fileTitleMap.get(node.path) ?? node.name) : node.name}
                </span>
              )}
              {duplicateBasenames.has(node.name) && !inlineRename && (
                <Copy size={10} title="Appears in multiple folders" style={{ color: "#fbbf24", flexShrink: 0, opacity: 0.75, marginRight: 2 }} />
              )}
              <span className="flex gap-0 opacity-0 group-hover:opacity-100 flex-shrink-0 relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setFileMenuOpen((p) => p === node.path ? null : node.path); }}
                  className="p-0.5 rounded"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                  title="More options"
                ><MoreHorizontal size={11} /></button>
                {fileMenuOpen === node.path && (
                  <div
                    className="absolute z-50 py-1 rounded-lg shadow-xl"
                    style={{
                      top: "100%", right: 0, minWidth: 120,
                      backgroundColor: "#1e1e2e",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                      style={{ color: "rgba(255,255,255,0.75)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFileMenuOpen(null);
                        setInlineRename({ path: node.path, value: node.name });
                      }}
                    >
                      Rename
                    </button>
                  </div>
                )}
                <button
                  onClick={(e) => deleteFile(node.path, e)}
                  className="p-0.5 rounded flex-shrink-0"
                  style={{ color: "rgba(248,113,113,0.7)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(248,113,113,0.7)")}
                  title="Delete file"
                ><Trash2 size={11} /></button>
              </span>
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
        className="flex-shrink-0 flex flex-col border-r relative"
        style={{ width: sidebarWidth, backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={startSidebarResize}
          className="absolute top-0 right-0 w-1 h-full z-10 cursor-col-resize"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
        {/* Sidebar toolbar: new file, new folder, expand/collapse */}
        <div
          className="flex items-center gap-1 px-2 py-2 border-b flex-shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
        >
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
          <input
            ref={docxImportRef}
            type="file"
            accept=".docx"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.[0]) handleDocxImport(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <button
            title={docxImporting ? "Importing…" : "Import .docx"}
            onClick={() => docxImportRef.current?.click()}
            disabled={docxImporting}
            className="p-1 rounded-md flex-shrink-0"
            style={{ color: docxImporting ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.35)" }}
            onMouseEnter={(e) => { if (!docxImporting) e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={(e) => { if (!docxImporting) e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
          >{docxImporting ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}</button>
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
        </div>

        {/* File search */}
        <div className="px-2 py-1.5 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
            <Search size={11} style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
            <input
              ref={fileSearchRef}
              type="text"
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setFileSearchQuery(""); fileSearchRef.current?.blur(); } }}
              placeholder="Search files…"
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: "rgba(255,255,255,0.8)", caretColor: "#60a5fa" }}
              spellCheck={false}
            />
            {fileSearchQuery && (
              <button onMouseDown={(e) => { e.preventDefault(); setFileSearchQuery(""); }} style={{ color: "rgba(255,255,255,0.3)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")} onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Explorer display/sort menu */}
        <div className="px-2 py-1 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="flex items-center" style={{ fontSize: 11, gap: explorerUltraCompact ? 4 : 6 }}>
            <button
              type="button"
              aria-label={showTitles ? "Switch display to filenames" : "Switch display to titles"}
              title={showTitles ? "Display: Titles (click for filenames)" : "Display: Filenames (click for titles)"}
              onClick={() => setShowTitles((v) => !v)}
              className="flex-1 min-w-0 flex items-center justify-center rounded-md"
              style={{
                backgroundColor: showTitles ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.06)",
                color: showTitles ? "#bfdbfe" : "rgba(255,255,255,0.72)",
                border: `1px solid ${showTitles ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.12)"}`,
                whiteSpace: "nowrap",
                gap: explorerUltraCompact ? 3 : 6,
                padding: explorerUltraCompact ? "4px 6px" : "4px 8px",
              }}
              onMouseEnter={(e) => {
                if (showTitles) e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.24)";
                else e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
              }}
              onMouseLeave={(e) => {
                if (showTitles) e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.18)";
                else e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
              }}
            >
              <Type size={explorerUltraCompact ? 10 : 11} style={{ flexShrink: 0, opacity: 0.85 }} />
              <span
                className="truncate"
                style={{
                  letterSpacing: explorerUltraCompact ? "0.04em" : "normal",
                  fontWeight: explorerUltraCompact ? 600 : 500,
                }}
              >
                {displayChipLabel}
              </span>
            </button>

            <button
              type="button"
              aria-label={fileSortMode === "recent" ? "Switch sort to alphabetical" : "Switch sort to most recently edited"}
              title={fileSortMode === "recent" ? "Sort: Most recently edited (click for A-Z)" : "Sort: A-Z (click for most recently edited)"}
              onClick={() => setFileSortMode((mode) => (mode === "alpha" ? "recent" : "alpha"))}
              className="flex-1 min-w-0 flex items-center justify-center rounded-md"
              style={{
                backgroundColor: fileSortMode === "recent" ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.06)",
                color: fileSortMode === "recent" ? "#bfdbfe" : "rgba(255,255,255,0.72)",
                border: `1px solid ${fileSortMode === "recent" ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.12)"}`,
                whiteSpace: "nowrap",
                gap: explorerUltraCompact ? 3 : 6,
                padding: explorerUltraCompact ? "4px 6px" : "4px 8px",
              }}
              onMouseEnter={(e) => {
                if (fileSortMode === "recent") e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.24)";
                else e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
              }}
              onMouseLeave={(e) => {
                if (fileSortMode === "recent") e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.18)";
                else e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
              }}
            >
              <ChevronsUpDown size={explorerUltraCompact ? 10 : 11} style={{ flexShrink: 0, opacity: 0.85 }} />
              <span
                className="truncate"
                style={{
                  letterSpacing: explorerUltraCompact ? "0.04em" : "normal",
                  fontWeight: explorerUltraCompact ? 600 : 500,
                }}
              >
                {sortChipLabel}
              </span>
            </button>
          </div>
        </div>

        {/* Bulk action bar — shown when 2+ files are selected */}
        {selectedPaths.size > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(96,165,250,0.07)" }}>
            <span className="text-xs flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>
              {selectedPaths.size} selected
            </span>
            <div className="relative">
              <button
                title="Move to folder…"
                onClick={() => setBulkMoveOpen((v) => !v)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                style={{ color: "#93c5fd", backgroundColor: "rgba(96,165,250,0.12)" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.22)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.12)")}
              >
                <FolderOpen size={11} />Move
              </button>
              {bulkMoveOpen && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 py-1 rounded-lg shadow-xl"
                  style={{ minWidth: 160, backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)" }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs"
                    style={{ color: "rgba(255,255,255,0.6)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    onClick={() => bulkMoveFiles(selectedPaths, "")}
                  >
                    / (root)
                  </button>
                  {allFolderPaths.map((fp) => (
                    <button
                      key={fp}
                      className="w-full text-left px-3 py-1.5 text-xs truncate"
                      style={{ color: "rgba(255,255,255,0.6)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      onClick={() => bulkMoveFiles(selectedPaths, fp)}
                    >
                      {fp}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              title="Delete selected"
              onClick={() => bulkDeleteFiles(selectedPaths)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
              style={{ color: "#f87171", backgroundColor: "rgba(248,113,113,0.1)" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,113,113,0.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(248,113,113,0.1)")}
            >
              <Trash2 size={11} />Delete
            </button>
            <button
              title="Clear selection"
              onClick={() => { setSelectedPaths(new Set()); lastClickedPathRef.current = null; }}
              className="p-0.5 rounded"
              style={{ color: "rgba(255,255,255,0.3)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            ><X size={11} /></button>
          </div>
        )}

        {/* File tree (or flat search results) */}
        <div
          className="flex-1 overflow-y-auto py-1 px-1"
          style={{ outline: dropIndicator?.type === "root" ? "1px solid rgba(96,165,250,0.25)" : "none", outlineOffset: "-2px" }}
          onDragOver={(e) => { if (!dragItemRef.current) return; e.preventDefault(); setDropIndicator({ type: "root" }); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropIndicator(null); }}
          onDrop={(e) => { e.preventDefault(); const di = dragItemRef.current; dragItemRef.current = null; setDragItem(null); setDropIndicator(null); if (!di) return; if (di.paths) { bulkMoveFiles(di.paths, ""); } else { moveFile(di.path, ""); } }}
        >
          {inlineNew?.parentPath === "" && !fileSearchQuery && (
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
          {fileSearchQuery ? (() => {
            const raw = fileSearchQuery.toLowerCase();
            const isTagSearch = raw.startsWith("tag:");
            const tagQ = isTagSearch ? raw.slice(4).trim() : null;

            let matches;
            if (isTagSearch) {
              // Match files whose node has a tag containing the tag query
              matches = files.filter((f) => {
                const basename = f.filename.split("/").pop();
                const stemId = normalizeToId(basename.replace(/\.(md|txt)$/i, ""));
                const node = graphData.nodes.find((n) => n.id === stemId);
                return (node?.tags || []).some((t) => t.includes(tagQ));
              });
            } else {
              matches = files.filter((f) => f.filename.toLowerCase().includes(raw));
            }

            if (matches.length === 0) return (
              <p className="text-xs px-3 py-2" style={{ color: "rgba(255,255,255,0.2)" }}>No files match</p>
            );
            return matches.map((f) => {
              const basename = f.filename.split("/").pop();
              const isActive = openFile?.filename === f.filename;
              const q = isTagSearch ? null : raw;
              const loIdx = q ? basename.toLowerCase().indexOf(q) : -1;
              const highlighted = loIdx >= 0
                ? <>{basename.slice(0, loIdx)}<span style={{ color: "#60a5fa" }}>{basename.slice(loIdx, loIdx + q.length)}</span>{basename.slice(loIdx + q.length)}</>
                : basename;
              // For tag search, show matching tags as a hint
              const tagHints = isTagSearch ? (() => {
                const stemId = normalizeToId(basename.replace(/\.(md|txt)$/i, ""));
                const node = graphData.nodes.find((n) => n.id === stemId);
                return (node?.tags || []).filter((t) => t.includes(tagQ));
              })() : [];
              const title = showTitles ? (fileTitleMap.get(f.filename) ?? null) : null;
              return (
                <button
                  key={f.filename}
                  onClick={() => openFileByName(f.filename)}
                  title={f.filename}
                  className="w-full flex flex-col items-start px-2 py-1 rounded-md text-left"
                  style={{
                    backgroundColor: isActive ? "rgba(96,165,250,0.15)" : "transparent",
                    color: isActive ? "#93c5fd" : "rgba(255,255,255,0.7)",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span className="text-xs truncate">{title ?? highlighted}</span>
                  </div>
                  {title && (
                    <span className="text-[10px] ml-5 truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{basename}</span>
                  )}
                  {tagHints.length > 0 && (
                    <div className="flex gap-1 mt-0.5 ml-5 flex-wrap">
                      {tagHints.map((t) => (
                        <span key={t} className="text-[10px] px-1 rounded" style={{ backgroundColor: "rgba(96,165,250,0.12)", color: "#93c5fd" }}>#{t}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            });
          })() : (
            <>
              {sortedTree.length === 0 && !inlineNew && (
                <p className="text-xs px-3 py-2" style={{ color: "rgba(255,255,255,0.2)" }}>No files yet</p>
              )}
              {renderTree(sortedTree, 0)}
            </>
          )}
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

        {/* Menubar */}
        <div
          className="flex items-center gap-0.5 px-2 py-0.5 border-b flex-shrink-0"
          style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
        >
          {/* File menu */}
          <div className="relative" ref={fileMenuToolbarRef}>
            <button
              onClick={() => {
                setViewMenuToolbarOpen(false);
                setInsertMenuToolbarOpen(false);
                cancelInsertTableSubmenuClose();
                setInsertTableSubmenuOpen(false);
                setFileMenuToolbarOpen((v) => !v);
              }}
              disabled={!openFile}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                color: openFile ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)",
                backgroundColor: fileMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent",
              }}
              onMouseEnter={(e) => { if (openFile) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = fileMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent"; }}
            >
              File
              <ChevronDown size={11} style={{ opacity: 0.5, transform: fileMenuToolbarOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>

            {fileMenuToolbarOpen && openFile && (
              <div
                className="absolute left-0 top-full mt-1 z-50 rounded-xl py-1 shadow-2xl"
                style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", minWidth: "170px" }}
              >
                {fileMenuRename ? (
                  <div className="px-3 py-2">
                    <p className="text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Rename file</p>
                    <input
                      ref={fileMenuRenameInputRef}
                      type="text"
                      value={fileMenuRename.value}
                      onChange={(e) => setFileMenuRename({ value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          renameFile(openFile.filename, fileMenuRename.value);
                          setFileMenuRename(null);
                          setFileMenuToolbarOpen(false);
                        }
                        if (e.key === "Escape") { setFileMenuRename(null); }
                      }}
                      className="w-full bg-transparent outline-none text-xs rounded px-2 py-1"
                      style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa", border: "1px solid rgba(255,255,255,0.15)" }}
                      autoFocus
                    />
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                        onClick={() => {
                          renameFile(openFile.filename, fileMenuRename.value);
                          setFileMenuRename(null);
                          setFileMenuToolbarOpen(false);
                        }}
                      >Rename</button>
                      <button
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                        onClick={() => setFileMenuRename(null)}
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      onClick={() => {
                        const basename = openFile.filename.split("/").pop().replace(/\.(md|txt)$/, "");
                        setFileMenuRename({ value: basename });
                      }}
                    >
                      <Pencil size={12} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
                      Rename
                    </button>
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      onClick={() => { downloadFile(); setFileMenuToolbarOpen(false); }}
                    >
                      <Download size={12} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
                      Download
                    </button>
                    <div className="my-1 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }} />
                    <button
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs"
                      style={{ color: "#f87171" }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(248,113,113,0.07)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      onClick={(e) => { setFileMenuToolbarOpen(false); deleteFile(openFile.filename, e); }}
                    >
                      <Trash2 size={12} style={{ flexShrink: 0 }} />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* View menu */}
          <div className="relative" ref={viewMenuToolbarRef}>
            <button
              onClick={() => {
                setFileMenuToolbarOpen(false);
                setInsertMenuToolbarOpen(false);
                cancelInsertTableSubmenuClose();
                setInsertTableSubmenuOpen(false);
                setViewMenuToolbarOpen((v) => !v);
              }}
              disabled={!openFile}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                color: openFile ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)",
                backgroundColor: viewMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent",
              }}
              onMouseEnter={(e) => { if (openFile) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = viewMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent"; }}
            >
              View
              <ChevronDown size={11} style={{ opacity: 0.5, transform: viewMenuToolbarOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>

            {viewMenuToolbarOpen && openFile && (
              <div
                className="absolute left-0 top-full mt-1 z-50 rounded-xl py-1 shadow-2xl"
                style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", minWidth: "190px" }}
              >
                <button
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-xs"
                  style={{ color: "rgba(255,255,255,0.7)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  onClick={() => setSpellCheckEnabled((v) => !v)}
                >
                  <span>Spell check</span>
                  <span style={{ color: spellCheckEnabled ? "#34d399" : "rgba(255,255,255,0.35)" }}>
                    {spellCheckEnabled ? "On" : "Off"}
                  </span>
                </button>
                <button
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-xs"
                  style={{ color: "rgba(255,255,255,0.7)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  onClick={() => setShowLineNumbers((v) => !v)}
                >
                  <span>Show Line Numbers</span>
                  <span style={{ color: showLineNumbers ? "#34d399" : "rgba(255,255,255,0.35)" }}>
                    {showLineNumbers ? "On" : "Off"}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Insert menu */}
          <div className="relative" ref={insertMenuToolbarRef}>
            <input
              ref={insertImageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleInsertImageFromDevice(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => {
                setFileMenuToolbarOpen(false);
                setViewMenuToolbarOpen(false);
                cancelInsertTableSubmenuClose();
                setInsertTableSubmenuOpen(false);
                setInsertMenuToolbarOpen((v) => !v);
              }}
              disabled={!canEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                color: canEdit ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)",
                backgroundColor: insertMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent",
              }}
              onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = insertMenuToolbarOpen ? "rgba(255,255,255,0.08)" : "transparent"; }}
            >
              Insert
              <ChevronDown size={11} style={{ opacity: 0.5, transform: insertMenuToolbarOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>

            {insertMenuToolbarOpen && canEdit && (
              <div
                className="absolute left-0 top-full mt-1 z-50 rounded-xl py-1 shadow-2xl"
                style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", minWidth: "170px" }}
              >
                <div
                  className="relative"
                  onMouseEnter={openInsertTableSubmenu}
                  onMouseLeave={queueCloseInsertTableSubmenu}
                >
                  <button
                    className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-xs"
                    style={{
                      color: insertTableSubmenuOpen ? "#fff" : "rgba(255,255,255,0.75)",
                      backgroundColor: insertTableSubmenuOpen ? "rgba(255,255,255,0.09)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!insertTableSubmenuOpen) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (!insertTableSubmenuOpen) e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span>Insert table</span>
                    <ChevronRight size={12} style={{ color: "rgba(255,255,255,0.35)" }} />
                  </button>

                  {insertTableSubmenuOpen && (
                    <div
                      className="absolute left-full top-0 z-50 rounded-lg py-1 shadow-2xl"
                      style={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", minWidth: "250px" }}
                      onMouseEnter={openInsertTableSubmenu}
                      onMouseLeave={queueCloseInsertTableSubmenu}
                    >
                      <div className="px-3 py-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>Insert table</span>
                          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>1-20 rows, 1-12 cols</span>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          <label className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
                            Rows
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={insertTableRows}
                              onChange={(e) => setInsertTableRows(Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10) || 1)))}
                              className="w-14 px-1.5 py-0.5 rounded text-xs bg-transparent outline-none"
                              style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
                            Cols
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={insertTableCols}
                              onChange={(e) => setInsertTableCols(Math.max(1, Math.min(12, Number.parseInt(e.target.value, 10) || 1)))}
                              className="w-14 px-1.5 py-0.5 rounded text-xs bg-transparent outline-none"
                              style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                            />
                          </label>
                        </div>

                        <button
                          className="w-full flex items-center justify-between px-2 py-1 rounded text-xs"
                          style={{
                            color: "rgba(255,255,255,0.7)",
                            backgroundColor: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                          onClick={() => setInsertTableWithHeaderRow((v) => !v)}
                        >
                          <span>Header row</span>
                          <span style={{ color: insertTableWithHeaderRow ? "#34d399" : "rgba(255,255,255,0.35)" }}>
                            {insertTableWithHeaderRow ? "On" : "Off"}
                          </span>
                        </button>

                        <div className="mt-2">
                          <p className="text-[10px] mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>Quick insert</p>
                          <div className="flex items-center gap-1.5">
                            {[
                              { label: "2x2", rows: 2, cols: 2 },
                              { label: "3x3", rows: 3, cols: 3 },
                              { label: "4x4", rows: 4, cols: 4 },
                            ].map((preset) => (
                              <button
                                key={preset.label}
                                className="px-2 py-1 rounded text-xs"
                                style={{
                                  color: "rgba(255,255,255,0.72)",
                                  backgroundColor: "rgba(255,255,255,0.06)",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.11)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
                                onClick={() => insertTableAtCursor(preset.rows, preset.cols)}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          className="w-full mt-2 px-2 py-1 rounded text-xs font-medium"
                          style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.32)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.28)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.2)"; }}
                          onClick={() => insertTableAtCursor()}
                        >
                          Insert Table
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-xs"
                  style={{ color: "rgba(255,255,255,0.75)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    cancelInsertTableSubmenuClose();
                    setInsertTableSubmenuOpen(false);
                    setInsertMenuToolbarOpen(false);
                    insertImageInputRef.current?.click();
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Upload size={12} style={{ color: "rgba(255,255,255,0.4)" }} />
                    Upload image
                  </span>
                </button>

                <button
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-xs"
                  style={{ color: "rgba(255,255,255,0.75)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    cancelInsertTableSubmenuClose();
                    setInsertTableSubmenuOpen(false);
                    setInsertMenuToolbarOpen(false);
                    editor?.chain().focus().insertDoodleBlock().run();
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Pencil size={12} style={{ color: "rgba(255,255,255,0.4)" }} />
                    Insert doodle
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Formatting toolbar */}
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
          <div className="relative" ref={fontFamilyMenuRef}>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setFontFamilyMenuOpen((v) => !v);
              }}
              title="Font family"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
              style={{
                border: "1px solid rgba(255,255,255,0.16)",
                backgroundColor: fontFamilyMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                color: canEdit ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.25)",
                cursor: canEdit ? "pointer" : "not-allowed",
              }}
            >
              <Type size={12} />
              <span>{activeFontFamilyLabel}</span>
              <ChevronDown size={11} style={{ opacity: 0.6 }} />
            </button>
            {fontFamilyMenuOpen && canEdit && (
              <div
                className="absolute z-50 mt-1 rounded-lg overflow-hidden"
                style={{
                  top: "100%",
                  left: 0,
                  width: 220,
                  backgroundColor: "rgba(20,20,32,0.98)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                {FONT_FAMILY_OPTIONS.map((option) => {
                  const isActive = option.label === activeFontFamilyLabel;
                  return (
                    <button
                      key={option.label}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyFontFamily(option.family);
                      }}
                      className="w-full text-left px-3 py-2"
                      style={{
                        backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                        color: isActive ? "#fff" : "rgba(255,255,255,0.78)",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ fontFamily: option.family, fontSize: 13 }}>{option.label}</span>
                        {isActive && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>✓</span>}
                      </div>
                      <div
                        className="text-[10px] mt-0.5"
                        style={{
                          fontFamily: option.family,
                          color: "rgba(255,255,255,0.45)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        The quick brown fox jumps over the lazy dog
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ToolbarBtn title="Decrease font size" disabled={!canEdit} onClick={decreaseFontSize}>
              <Minus size={13} />
            </ToolbarBtn>
            <input
              type="text"
              inputMode="numeric"
              value={fontSizeInput}
              onChange={(e) => setFontSizeInput(e.target.value)}
              onBlur={() => applyFontSizePx(fontSizeInput)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  applyFontSizePx(fontSizeInput);
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setFontSizeInput(String(getSelectionFontSizePx()));
                  e.currentTarget.blur();
                }
              }}
              disabled={!canEdit}
              title="Font size"
              className="w-10 px-1 py-0.5 rounded text-xs text-center bg-transparent outline-none"
              style={{
                color: canEdit ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.25)",
                border: "1px solid rgba(255,255,255,0.16)",
                caretColor: "#60a5fa",
              }}
            />
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>px</span>
            <ToolbarBtn title="Increase font size" disabled={!canEdit} onClick={increaseFontSize}>
              <Plus size={13} />
            </ToolbarBtn>
          </div>
          <ToolbarDivider />
          <div
            className="flex items-center gap-1.5 px-0.5 py-0.5"
          >
            <div className="relative" ref={textColorMenuRef}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!canEdit) return;
                  setHighlightColorMenuOpen(false);
                  setTextColorTintBase("");
                  setTextColorMenuOpen((v) => !v);
                }}
                disabled={!canEdit}
                title="Text color"
                className="flex items-center gap-1 px-1 py-0.5 rounded-md transition-colors"
                style={{
                  backgroundColor: textColorMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                  color: canEdit ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.3)",
                }}
                onMouseEnter={(e) => {
                  if (!canEdit || textColorMenuOpen) return;
                  e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (textColorMenuOpen) {
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)";
                    return;
                  }
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Palette size={12} style={{ color: "rgba(255,255,255,0.45)" }} />
                <span
                  className="w-3.5 h-3.5 rounded-sm"
                  style={{
                    background: swatchBackground(activeTextColor),
                  }}
                />
                <ChevronDown size={11} style={{ opacity: 0.55, transform: textColorMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>

              {textColorMenuOpen && canEdit && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 shadow-2xl"
                  style={{ backgroundColor: "#1a1a2e", minWidth: 130 }}
                >
                  {TEXT_COLOR_OPTIONS.map((option) => {
                    const isActive = activeTextColor === option.value;
                    const tintOptions = option.value ? getTextColorTints(option.value) : [];
                    const tintActive = tintOptions.some((tint) => colorsMatch(activeTextColor, tint.value));
                    const tintMenuOpen = textColorTintBase === option.value;
                    return (
                      <div
                        key={`text-${option.label}`}
                        className="relative"
                        onMouseEnter={() => {
                          if (option.value) setTextColorTintBase(option.value);
                          else setTextColorTintBase("");
                        }}
                      >
                        <button
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                          style={{
                            color: isActive || tintActive ? "#fff" : "rgba(255,255,255,0.75)",
                            backgroundColor: isActive || tintActive || tintMenuOpen ? "rgba(255,255,255,0.09)" : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive && !tintActive && !tintMenuOpen) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive && !tintActive && !tintMenuOpen) e.currentTarget.style.backgroundColor = "transparent";
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyTextColor(option.value);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="w-3.5 h-3.5 rounded-sm"
                              style={{ background: swatchBackground(option.swatch) }}
                            />
                            {option.label}
                          </span>
                          <span className="flex items-center gap-1">
                            {(isActive || tintActive) && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>✓</span>}
                            {!!option.value && <ChevronRight size={12} style={{ color: "rgba(255,255,255,0.35)" }} />}
                          </span>
                        </button>

                        {!!option.value && tintMenuOpen && (
                          <div
                            className="absolute left-full top-0 ml-1 z-50 rounded-lg py-1 shadow-2xl"
                            style={{ backgroundColor: "#1a1a2e", minWidth: 132 }}
                          >
                            {tintOptions.map((tint) => {
                              const tintIsActive = colorsMatch(activeTextColor, tint.value);
                              return (
                                <button
                                  key={`${option.label}-${tint.label}`}
                                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                                  style={{
                                    color: tintIsActive ? "#fff" : "rgba(255,255,255,0.75)",
                                    backgroundColor: tintIsActive ? "rgba(255,255,255,0.1)" : "transparent",
                                  }}
                                  onMouseEnter={(e) => { if (!tintIsActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                                  onMouseLeave={(e) => { if (!tintIsActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyTextColor(tint.value);
                                  }}
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="w-3.5 h-3.5 rounded-sm" style={{ background: tint.value }} />
                                    {tint.label}
                                  </span>
                                  {tintIsActive && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>✓</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relative" ref={highlightColorMenuRef}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!canEdit) return;
                  setTextColorMenuOpen(false);
                  setHighlightColorMenuOpen((v) => !v);
                }}
                disabled={!canEdit}
                title="Highlight color"
                className="flex items-center gap-1 px-1 py-0.5 rounded-md transition-colors"
                style={{
                  backgroundColor: highlightColorMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                  color: canEdit ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.3)",
                }}
                onMouseEnter={(e) => {
                  if (!canEdit || highlightColorMenuOpen) return;
                  e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (highlightColorMenuOpen) {
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)";
                    return;
                  }
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Highlighter size={12} style={{ color: "rgba(255,255,255,0.45)" }} />
                <span
                  className="w-3.5 h-3.5 rounded-sm"
                  style={{
                    background: swatchBackground(activeHighlightColor),
                  }}
                />
                <ChevronDown size={11} style={{ opacity: 0.55, transform: highlightColorMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>

              {highlightColorMenuOpen && canEdit && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 shadow-2xl"
                  style={{ backgroundColor: "#1a1a2e", minWidth: 130 }}
                >
                  {HIGHLIGHT_COLOR_OPTIONS.map((option) => {
                    const isActive = activeHighlightColor === option.value;
                    return (
                      <button
                        key={`highlight-${option.label}`}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                        style={{
                          color: isActive ? "#fff" : "rgba(255,255,255,0.75)",
                          backgroundColor: isActive ? "rgba(255,255,255,0.09)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyHighlightColor(option.value);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ background: swatchBackground(option.swatch) }}
                          />
                          {option.label}
                        </span>
                        {isActive && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <ToolbarBtn title="Bold" disabled={!canEdit} active={editor?.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Italic" disabled={!canEdit} active={editor?.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Underline (Ctrl+U)" disabled={!canEdit} active={editor?.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Strikethrough" disabled={!canEdit} active={editor?.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Superscript" disabled={!canEdit} active={editor?.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
            <SuperscriptIcon size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Subscript" disabled={!canEdit} active={editor?.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}>
            <SubscriptIcon size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Clear formatting" disabled={!canEdit} onClick={clearFormatting}>
            <Eraser size={14} />
          </ToolbarBtn>
          <ToolbarDivider />
          <ToolbarBtn title="Bullet list" disabled={!canEdit} active={editor?.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Numbered list" disabled={!canEdit} active={editor?.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Outdent (Shift+Tab)" disabled={!canEdit} onClick={outdentSelection}>
            <span className="text-[12px] font-semibold leading-none">⇤</span>
          </ToolbarBtn>
          <ToolbarBtn title="Indent (Tab)" disabled={!canEdit} onClick={indentSelection}>
            <span className="text-[12px] font-semibold leading-none">⇥</span>
          </ToolbarBtn>
          <ToolbarBtn title="Blockquote" disabled={!canEdit} active={editor?.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={14} />
          </ToolbarBtn>
          <ToolbarBtn title="Inline code" disabled={!canEdit} active={editor?.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size={14} />
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
            {/* ── Flex row: editor content (left) + minimap (right) ── */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
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
            {/* File path + (i) metadata/connections popup */}
            <div className="mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {openFile.filename}
                </span>
                {propagateMsg && (
                  <span className="text-xs" style={{ color: "#4ade80" }}>{propagateMsg}</span>
                )}
                {openNode && (
                  <button
                    onClick={() => setNodeInfoOpen((v) => !v)}
                    title="Node metadata & connections"
                    style={{
                      color: nodeInfoOpen ? "#60a5fa" : "rgba(255,255,255,0.2)",
                      background: "none", border: "none", padding: 0,
                      cursor: "pointer", lineHeight: 1, display: "inline-flex", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#60a5fa")}
                    onMouseLeave={(e) => { if (!nodeInfoOpen) e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}
                  >
                    <Info size={12} />
                  </button>
                )}
              </div>
              {nodeInfoOpen && openNode && (() => {
                // Collect immediate neighbors — mirrors the minimap subgraph logic
                const connections = [];
                for (const link of graphData.links) {
                  const src = typeof link.source === "object" ? link.source.id : link.source;
                  const tgt = typeof link.target === "object" ? link.target.id : link.target;
                  if (src === openNodeId) {
                    const neighbor = graphData.nodes.find((n) => n.id === tgt);
                    if (neighbor) connections.push({ node: neighbor, label: link.label });
                  } else if (tgt === openNodeId) {
                    const neighbor = graphData.nodes.find((n) => n.id === src);
                    if (neighbor) connections.push({ node: neighbor, label: link.label });
                  }
                }
                // JSON lines — exactly the fields the user requested
                const createdAtFormatted = openNode.createdAt
                  ? new Date(openNode.createdAt).toLocaleString(undefined, {
                      year: "numeric", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })
                  : null;
                const jsonText = [
                  `{`,
                  `  "id": ${JSON.stringify(openNode.id)},`,
                  `  "type": ${JSON.stringify(openNode.type)},`,
                  `  "aliases": ${JSON.stringify(openNode.aliases || [])},`,
                  `  "tags": ${JSON.stringify(openNode.tags || [])},`,
                  `  "createdAt": ${openNode.createdAt ?? "null"}${createdAtFormatted ? `  // ${createdAtFormatted}` : ""}`,
                  `}`,
                ].join("\n");
                return (
                  <div
                    className="mt-2 rounded-lg text-xs overflow-hidden"
                    style={{ border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "#090913" }}
                  >
                    {/* Metadata JSON */}
                    <div
                      className="px-3 py-2.5"
                      style={{ borderBottom: connections.length ? "1px solid rgba(255,255,255,0.07)" : "none" }}
                    >
                      <p className="text-[10px] uppercase tracking-widest mb-1.5 font-semibold" style={{ color: "rgba(255,255,255,0.2)" }}>
                        metadata
                      </p>
                      <pre style={{ color: "rgba(255,255,255,0.6)", fontFamily: "ui-monospace, monospace", lineHeight: 1.8, margin: 0, whiteSpace: "pre" }}>
                        {jsonText}
                      </pre>
                    </div>
                    {/* Direct connections */}
                    {connections.length > 0 && (
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-widest mb-1.5 font-semibold" style={{ color: "rgba(255,255,255,0.2)" }}>
                          connections · {connections.length}
                        </p>
                        <div className="flex flex-col gap-1">
                          {connections.map((conn, i) => {
                            const cfg = NODE_TYPE_CONFIG[conn.node.type] || nodeTypeFallback;
                            return (
                              <div key={i} className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                                <span style={{ color: cfg.color, fontWeight: 500 }}>{conn.node.name}</span>
                                {conn.label && (
                                  <span className="truncate" style={{ color: "rgba(255,255,255,0.25)" }}>· {conn.label}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {/* Tags */}
            {openNode && (
              <div className="flex flex-wrap items-center gap-1.5 mb-1 min-h-[22px]">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                    style={{ backgroundColor: "rgba(96,165,250,0.12)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.2)" }}
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      style={{ color: "rgba(147,197,253,0.5)", lineHeight: 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#93c5fd")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(147,197,253,0.5)")}
                      title="Remove tag"
                    ><X size={9} /></button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); }
                    if (e.key === "Escape") setTagInput("");
                  }}
                  onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
                  placeholder={tags.length === 0 ? "Add tag…" : "+"}
                  className="bg-transparent outline-none text-xs"
                  style={{ color: "rgba(255,255,255,0.4)", caretColor: "#60a5fa", width: tags.length === 0 ? 70 : 28, minWidth: 20 }}
                  spellCheck={false}
                />
              </div>
            )}
            {/* Node type selector */}
            {openNode && (() => {
              const activeType = nodeTypeOverride ?? openNode.type;
              const activeCfg = NODE_TYPE_CONFIG[activeType] || nodeTypeFallback;
              return (
              <div className="relative mb-1" ref={typeDropdownRef}>
                <button
                  onClick={() => { setTypeDropdownOpen((v) => !v); setNewTypeInput(""); }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors"
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    backgroundColor: typeDropdownOpen ? "rgba(255,255,255,0.08)" : "transparent",
                    color: "rgba(255,255,255,0.5)",
                  }}
                  onMouseEnter={(e) => { if (!typeDropdownOpen) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={(e) => { if (!typeDropdownOpen) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: activeCfg.color }}
                  />
                  <span>{activeCfg.label}</span>
                  <ChevronDown size={10} style={{ opacity: 0.5, transform: typeDropdownOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
                </button>

                {typeDropdownOpen && (
                  <div
                    className="absolute z-50 rounded-lg overflow-hidden mt-1"
                    style={{
                      top: "100%", left: 0, minWidth: 160,
                      backgroundColor: "rgba(20,20,32,0.98)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    }}
                  >
                    {/* Existing types */}
                    {Object.entries(NODE_TYPE_CONFIG).map(([typeKey, cfg]) => {
                      const isActive = activeType === typeKey;
                      return (
                        <button
                          key={typeKey}
                          onMouseDown={(e) => { e.preventDefault(); saveNodeType(typeKey); setTypeDropdownOpen(false); }}
                          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs"
                          style={{
                            backgroundColor: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                            color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = isActive ? "rgba(255,255,255,0.08)" : "transparent"; }}
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                          <span className="flex-1">{cfg.label}</span>
                          {isActive && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>✓</span>}
                        </button>
                      );
                    })}
                    {/* Divider + add new type */}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "4px 0" }} />
                    <div className="px-3 py-1.5 flex items-center gap-1.5">
                      <input
                        ref={newTypeInputRef}
                        type="text"
                        value={newTypeInput}
                        onChange={(e) => setNewTypeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); if (newTypeInput.trim()) addWorkspaceType(newTypeInput); }
                          if (e.key === "Escape") { setTypeDropdownOpen(false); setNewTypeInput(""); }
                        }}
                        placeholder="Add new type…"
                        className="flex-1 bg-transparent outline-none text-xs"
                        style={{ color: "rgba(255,255,255,0.6)", caretColor: "#60a5fa" }}
                        spellCheck={false}
                        autoFocus
                      />
                      {newTypeInput.trim() && (
                        <button
                          onMouseDown={(e) => { e.preventDefault(); addWorkspaceType(newTypeInput); }}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                        >Add</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              );
            })()}
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
            <div
              className="relative"
              onContextMenu={(e) => {
                if (!editor) return;
                e.preventDefault();

                const posAtClick = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
                const selectionAtOpen = editor.state.selection;
                const hasAnySelection = !selectionAtOpen.empty;
                const clickPos = posAtClick?.pos;
                const clickInsideSelection =
                  clickPos != null &&
                  clickPos >= selectionAtOpen.from &&
                  clickPos <= selectionAtOpen.to;
                const doodleHit = posAtClick?.pos != null
                  ? findDoodleNodeAtPos(editor.state.doc, posAtClick.pos)
                  : null;
                const imageHit = posAtClick?.pos != null
                  ? findImageNodeAtPos(editor.state.doc, posAtClick.pos)
                  : null;

                // Place selection at right-click location so table commands
                // target the expected cell. For media, select the node.
                if (posAtClick?.pos != null && !clickInsideSelection) {
                  if (doodleHit) {
                    editor.chain().focus().setNodeSelection(doodleHit.pos).run();
                  } else if (imageHit) {
                    editor.chain().focus().setNodeSelection(imageHit.pos).run();
                  } else {
                    editor.chain().focus().setTextSelection(posAtClick.pos).run();
                  }
                }

                const selectedText = editor.state.doc.textBetween(
                  editor.state.selection.from,
                  editor.state.selection.to,
                  " "
                ).trim();
                const inTable =
                  editor.isActive("table") ||
                  editor.isActive("tableCell") ||
                  editor.isActive("tableHeader");
                setEditorContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  selectedText,
                  hasAnySelection,
                  inTable,
                  inDoodle: Boolean(doodleHit),
                  doodlePos: doodleHit?.pos ?? null,
                  doodleFrozen: Boolean(doodleHit?.node?.attrs?.frozen),
                  doodleDataUrl: doodleHit?.node?.attrs?.dataUrl || "",
                  inImage: Boolean(imageHit),
                  imagePos: imageHit?.pos ?? null,
                  imageSrc: imageHit?.node?.attrs?.src || "",
                });
              }}
            >
              <div className="flex items-start">
                {showLineNumbers && openFile && (
                  <div
                    className="mr-3 pr-2 select-none pointer-events-none"
                    style={{
                      position: "relative",
                      alignSelf: "stretch",
                      height: Math.max(lineNumberGutterHeight, 24),
                      minWidth: 36,
                      borderRight: "1px solid rgba(255,255,255,0.08)",
                      color: "rgba(147,197,253,0.72)",
                      textAlign: "right",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {visualLineTops.map((top, i) => (
                      <div
                        key={`${top}-${i}`}
                        style={{
                          position: "absolute",
                          top,
                          right: 2,
                          transform: "translateY(-1px)",
                          lineHeight: 1,
                        }}
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>
                )}
                <div ref={editorContentWrapRef} className="flex-1 min-w-0">
                  <EditorContent editor={editor} />
                </div>
              </div>
            </div>

            {/* ── Selection context menu ────────────────────────────── */}
            {editorContextMenu && (
              <>
                {/* Backdrop — dismiss on click outside */}
                <div
                  className="fixed inset-0 z-40"
                  onMouseDown={() => setEditorContextMenu(null)}
                />
                <div
                  className="fixed z-50 py-1 rounded-lg shadow-xl"
                  style={{
                    left: editorContextMenu.x,
                    top: editorContextMenu.y,
                    minWidth: 200,
                    backgroundColor: "rgba(22,22,35,0.98)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}
                >
                  {/* Standard edit actions: Cut / Copy / Paste */}
                  {(() => {
                    const text = editorContextMenu.selectedText;
                    const hasSelection = text.length > 0;
                    const hasAnySelection = Boolean(editorContextMenu.hasAnySelection);
                    const iconStyle = { flexShrink: 0, color: "rgba(255,255,255,0.4)" };
                    const btnClass = "w-full text-left px-3 py-2 text-sm flex items-center gap-2";
                    const btnStyle = { color: "rgba(255,255,255,0.85)" };
                    const dimStyle = { color: "rgba(255,255,255,0.35)", cursor: "default" };
                    const hoverOn  = (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)");
                    const hoverOff = (e) => (e.currentTarget.style.backgroundColor = "transparent");
                    return (
                      <>
                        {hasSelection && (
                          <button className={btnClass} style={btnStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setEditorContextMenu(null);
                              navigator.clipboard.writeText(text).then(() => {
                                editor?.commands.deleteSelection();
                              }).catch(() => {});
                            }}>
                            <Scissors size={13} style={iconStyle} />
                            Cut
                          </button>
                        )}
                        <button className={btnClass} style={hasAnySelection ? btnStyle : dimStyle}
                          onMouseEnter={hasAnySelection ? hoverOn : undefined}
                          onMouseLeave={hasAnySelection ? hoverOff : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (!hasAnySelection) return;
                            setEditorContextMenu(null);
                            let copied = false;
                            try {
                              editor?.commands.focus();
                              copied = document.execCommand("copy");
                            } catch {
                              copied = false;
                            }
                            if (!copied && hasSelection) {
                              navigator.clipboard.writeText(text).catch(() => {});
                            }
                          }}>
                          <Copy size={13} style={iconStyle} />
                          Copy
                        </button>
                        <button className={btnClass} style={btnStyle}
                          onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setEditorContextMenu(null);
                            navigator.clipboard.readText().then((t) => {
                              if (t) editor?.commands.insertContent(t);
                            }).catch(() => {});
                          }}>
                          <Clipboard size={13} style={iconStyle} />
                          Paste
                        </button>
                        <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                      </>
                    );
                  })()}

                  {/* Table-only actions */}
                  {editorContextMenu.inTable && (() => {
                    const iconStyle = { flexShrink: 0, color: "rgba(255,255,255,0.4)" };
                    const btnClass = "w-full text-left px-3 py-2 text-sm flex items-center gap-2";
                    const hoverOn = (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)");
                    const hoverOff = (e) => (e.currentTarget.style.backgroundColor = "transparent");
                    const baseStyle = { color: "rgba(255,255,255,0.85)" };
                    const disabledStyle = { color: "rgba(255,255,255,0.35)", cursor: "default" };

                    const actions = [
                      {
                        key: "row-above",
                        label: "Add row above",
                        canRun: editor?.can().chain().focus().addRowBefore().run(),
                        run: () => editor?.chain().focus().addRowBefore().run(),
                      },
                      {
                        key: "row-below",
                        label: "Add row below",
                        canRun: editor?.can().chain().focus().addRowAfter().run(),
                        run: () => editor?.chain().focus().addRowAfter().run(),
                      },
                      {
                        key: "col-left",
                        label: "Add column left",
                        canRun: editor?.can().chain().focus().addColumnBefore().run(),
                        run: () => editor?.chain().focus().addColumnBefore().run(),
                      },
                      {
                        key: "col-right",
                        label: "Add column right",
                        canRun: editor?.can().chain().focus().addColumnAfter().run(),
                        run: () => editor?.chain().focus().addColumnAfter().run(),
                      },
                      {
                        key: "del-row",
                        label: "Delete row",
                        canRun: editor?.can().chain().focus().deleteRow().run(),
                        run: () => editor?.chain().focus().deleteRow().run(),
                      },
                      {
                        key: "del-col",
                        label: "Delete column",
                        canRun: editor?.can().chain().focus().deleteColumn().run(),
                        run: () => editor?.chain().focus().deleteColumn().run(),
                      },
                      {
                        key: "del-table",
                        label: "Delete table",
                        canRun: editor?.can().chain().focus().deleteTable().run(),
                        run: () => editor?.chain().focus().deleteTable().run(),
                      },
                    ];

                    return (
                      <>
                        {actions.map((action) => (
                          <button
                            key={action.key}
                            className={btnClass}
                            style={action.canRun ? baseStyle : disabledStyle}
                            onMouseEnter={action.canRun ? hoverOn : undefined}
                            onMouseLeave={action.canRun ? hoverOff : undefined}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (!action.canRun) return;
                              setEditorContextMenu(null);
                              action.run();
                            }}
                          >
                            <span style={iconStyle}>▦</span>
                            {action.label}
                          </button>
                        ))}
                        {editorContextMenu.selectedText && (
                          <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                        )}
                      </>
                    );
                  })()}

                  {/* Doodle-only actions */}
                  {editorContextMenu.inDoodle && (() => {
                    const iconStyle = { flexShrink: 0, color: "rgba(255,255,255,0.4)" };
                    const btnClass = "w-full text-left px-3 py-2 text-sm flex items-center gap-2";
                    const hoverOn = (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)");
                    const hoverOff = (e) => (e.currentTarget.style.backgroundColor = "transparent");
                    const baseStyle = { color: "rgba(255,255,255,0.85)" };
                    const disabledStyle = { color: "rgba(255,255,255,0.35)", cursor: "default" };
                    const doodlePos = editorContextMenu.doodlePos;
                    const canTargetDoodle = Number.isInteger(doodlePos);
                    const canDownloadDoodle = Boolean(editorContextMenu.doodleDataUrl);
                    const nextFrozen = !editorContextMenu.doodleFrozen;
                    const canToggleFreeze = canTargetDoodle && editor?.can().chain().focus().setNodeSelection(doodlePos).updateAttributes("doodleBlock", { frozen: nextFrozen }).run();
                    const canDeleteDoodle = canTargetDoodle && editor?.can().chain().focus().setNodeSelection(doodlePos).deleteSelection().run();

                    return (
                      <>
                        <button
                          className={btnClass}
                          style={canDownloadDoodle ? baseStyle : disabledStyle}
                          onMouseEnter={canDownloadDoodle ? hoverOn : undefined}
                          onMouseLeave={canDownloadDoodle ? hoverOff : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (!canDownloadDoodle) return;
                            setEditorContextMenu(null);
                            quickDownloadPng(editorContextMenu.doodleDataUrl, "doodle");
                          }}
                        >
                          <Download size={13} style={iconStyle} />
                          Download doodle (.png)
                        </button>
                        <button
                          className={btnClass}
                          style={canToggleFreeze ? baseStyle : disabledStyle}
                          onMouseEnter={canToggleFreeze ? hoverOn : undefined}
                          onMouseLeave={canToggleFreeze ? hoverOff : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (!canToggleFreeze) return;
                            setEditorContextMenu(null);
                            editor?.chain().focus().setNodeSelection(doodlePos).updateAttributes("doodleBlock", { frozen: nextFrozen }).run();
                          }}
                        >
                          <Lock size={13} style={iconStyle} />
                          {editorContextMenu.doodleFrozen ? "Unfreeze doodle" : "Freeze doodle"}
                        </button>
                        <button
                          className={btnClass}
                          style={canDeleteDoodle ? { ...baseStyle, color: "#fca5a5" } : disabledStyle}
                          onMouseEnter={canDeleteDoodle ? hoverOn : undefined}
                          onMouseLeave={canDeleteDoodle ? hoverOff : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (!canDeleteDoodle) return;
                            setEditorContextMenu(null);
                            editor?.chain().focus().setNodeSelection(doodlePos).deleteSelection().run();
                          }}
                        >
                          <Trash2 size={13} style={iconStyle} />
                          Delete doodle
                        </button>
                        {editorContextMenu.selectedText && (
                          <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                        )}
                      </>
                    );
                  })()}

                  {/* Image-only actions */}
                  {editorContextMenu.inImage && (() => {
                    const iconStyle = { flexShrink: 0, color: "rgba(255,255,255,0.4)" };
                    const btnClass = "w-full text-left px-3 py-2 text-sm flex items-center gap-2";
                    const hoverOn = (e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)");
                    const hoverOff = (e) => (e.currentTarget.style.backgroundColor = "transparent");
                    const canDownloadImage = Boolean(editorContextMenu.imageSrc);
                    return (
                      <>
                        <button
                          className={btnClass}
                          style={canDownloadImage ? { color: "rgba(255,255,255,0.85)" } : { color: "rgba(255,255,255,0.35)", cursor: "default" }}
                          onMouseEnter={canDownloadImage ? hoverOn : undefined}
                          onMouseLeave={canDownloadImage ? hoverOff : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (!canDownloadImage) return;
                            setEditorContextMenu(null);
                            quickDownloadPng(editorContextMenu.imageSrc, "image");
                          }}
                        >
                          <Download size={13} style={iconStyle} />
                          Download image (.png)
                        </button>
                        {editorContextMenu.selectedText && (
                          <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                        )}
                      </>
                    );
                  })()}

                  {/* Selection-only actions: Add alias + Create note */}
                  {editorContextMenu.selectedText && (() => {
                    const text = editorContextMenu.selectedText;
                    const showAlias = openNode &&
                      !aliases.some((a) => a.toLowerCase() === text.toLowerCase()) &&
                      openNode.name.toLowerCase() !== text.toLowerCase();
                    return (
                      <>
                        {showAlias && (
                          <button
                            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                            style={{ color: "rgba(255,255,255,0.85)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setEditorContextMenu(null);
                              const next = [...aliases, text];
                              setAliases(next);
                              saveAliases(next);
                            }}
                          >
                            <Tag size={13} style={{ flexShrink: 0, color: "rgba(255,255,255,0.4)" }} />
                            <span>
                              Add alias{" "}
                              <span className="font-medium" style={{ color: "#fff" }}>
                                &ldquo;{text.length > 30 ? text.slice(0, 30) + "…" : text}&rdquo;
                              </span>
                            </span>
                          </button>
                        )}
                        {showAlias && (
                          <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                        )}
                        <button
                          className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                          style={{ color: "rgba(255,255,255,0.85)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setEditorContextMenu(null);
                            createNoteFromSelection(text);
                          }}
                        >
                          <FilePlus size={13} style={{ flexShrink: 0, color: "rgba(255,255,255,0.4)" }} />
                          <span>
                            Create note for{" "}
                            <span className="font-medium" style={{ color: "#fff" }}>
                              &ldquo;{text.length > 30 ? text.slice(0, 30) + "…" : text}&rdquo;
                            </span>
                          </span>
                        </button>

                        {/* ── AI writing assistant ── */}
                        <div className="my-1 mx-2" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                        {[
                          { action: "rephrase",    label: "Rephrase",        icon: <WandSparkles size={13} /> },
                          { action: "expand",      label: "Expand",          icon: <Sparkles size={13} /> },
                          { action: "shorten",     label: "Shorten",         icon: <Sparkles size={13} /> },
                          { action: "continuity",  label: "Check continuity", icon: <Sparkles size={13} /> },
                        ].map(({ action, label, icon }) => (
                          <button
                            key={action}
                            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                            style={{ color: "#c4b5fd" }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(196,181,253,0.07)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setEditorContextMenu(null);
                              runAiAssist(action, text);
                            }}
                          >
                            <span style={{ flexShrink: 0, color: "rgba(196,181,253,0.55)" }}>{icon}</span>
                            {label}
                          </button>
                        ))}
                        <button
                          className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                          style={{ color: "#c4b5fd" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(196,181,253,0.07)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setEditorContextMenu(null);
                            // open the custom input panel pre-seeded with selection
                            setAiAssist({ action: "custom", streaming: false, result: "", error: null, selectionFrom: editor.state.selection.from, selectionTo: editor.state.selection.to, selectedText: text, awaitingInstruction: true });
                            setAiCustomInput("");
                            setTimeout(() => aiCustomInputRef.current?.focus(), 50);
                          }}
                        >
                          <span style={{ flexShrink: 0, color: "rgba(196,181,253,0.55)" }}><Sparkles size={13} /></span>
                          Custom instruction…
                        </button>
                      </>
                    );
                  })()}
                </div>
              </>
            )}

            {/* ── AI writing assistant panel ────────────────────────── */}
            {aiAssist && (
              <div
                className="fixed z-50 rounded-xl shadow-2xl flex flex-col"
                style={{
                  bottom: 24,
                  right: 24,
                  width: 420,
                  maxHeight: "60vh",
                  backgroundColor: "rgba(18,18,30,0.98)",
                  border: "1px solid rgba(196,181,253,0.25)",
                  boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "rgba(196,181,253,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} style={{ color: "#c4b5fd" }} />
                    <span className="text-xs font-semibold" style={{ color: "#c4b5fd" }}>
                      {{
                        rephrase: "Rephrase",
                        expand: "Expand",
                        shorten: "Shorten",
                        continuity: "Continuity Check",
                        custom: "AI Assistant",
                      }[aiAssist.action]}
                    </span>
                    {aiAssist.streaming && (
                      <Loader size={11} className="animate-spin" style={{ color: "rgba(196,181,253,0.5)" }} />
                    )}
                  </div>
                  <button onClick={() => setAiAssist(null)} style={{ color: "rgba(255,255,255,0.3)" }}>
                    <X size={14} />
                  </button>
                </div>

                {/* Custom instruction input */}
                {aiAssist.awaitingInstruction ? (
                  <div className="px-4 py-3 flex flex-col gap-2">
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>What should I do with the selected text?</p>
                    <input
                      ref={aiCustomInputRef}
                      type="text"
                      value={aiCustomInput}
                      onChange={(e) => setAiCustomInput(e.target.value)}
                      placeholder="e.g. rewrite in a more formal tone…"
                      className="w-full bg-transparent outline-none text-sm rounded px-3 py-1.5"
                      style={{ color: "rgba(255,255,255,0.85)", caretColor: "#c4b5fd", border: "1px solid rgba(255,255,255,0.15)" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && aiCustomInput.trim()) {
                          const sel = aiAssist.selectedText;
                          setAiAssist((prev) => ({ ...prev, awaitingInstruction: false }));
                          runAiAssist("custom", sel, aiCustomInput.trim());
                        }
                        if (e.key === "Escape") setAiAssist(null);
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        className="text-xs px-3 py-1 rounded-md font-medium"
                        style={{ backgroundColor: "rgba(196,181,253,0.2)", color: "#c4b5fd" }}
                        onClick={() => {
                          if (!aiCustomInput.trim()) return;
                          const sel = aiAssist.selectedText;
                          setAiAssist((prev) => ({ ...prev, awaitingInstruction: false }));
                          runAiAssist("custom", sel, aiCustomInput.trim());
                        }}
                      >Run</button>
                      <button
                        className="text-xs px-3 py-1 rounded-md"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                        onClick={() => setAiAssist(null)}
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Result */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 text-sm" style={{ color: "rgba(255,255,255,0.82)", whiteSpace: "pre-wrap", minHeight: 60, lineHeight: 1.6 }}>
                      {aiAssist.error ? (
                        <span style={{ color: "#f87171" }}>{aiAssist.error}</span>
                      ) : aiAssist.result ? (
                        aiAssist.result
                      ) : (
                        <span style={{ color: "rgba(255,255,255,0.25)" }}>Generating…</span>
                      )}
                    </div>

                    {/* Actions */}
                    {!aiAssist.streaming && !aiAssist.error && aiAssist.result && aiAssist.action !== "continuity" && (
                      <div className="flex gap-2 px-4 py-2.5 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <button
                          className="text-xs px-3 py-1.5 rounded-md font-medium"
                          style={{ backgroundColor: "rgba(196,181,253,0.2)", color: "#c4b5fd" }}
                          onClick={() => {
                            if (!editor) return;
                            const { selectionFrom, selectionTo, result } = aiAssist;
                            editor.chain().focus()
                              .deleteRange({ from: selectionFrom, to: selectionTo })
                              .insertContentAt(selectionFrom, result)
                              .run();
                            setAiAssist(null);
                          }}
                        >Replace selection</button>
                        <button
                          className="text-xs px-3 py-1.5 rounded-md font-medium"
                          style={{ backgroundColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
                          onClick={() => {
                            if (!editor) return;
                            editor.chain().focus().insertContentAt(aiAssist.selectionTo, "\n\n" + aiAssist.result).run();
                            setAiAssist(null);
                          }}
                        >Insert after</button>
                        <button
                          className="text-xs px-3 py-1.5 rounded-md"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                          onClick={() => setAiAssist(null)}
                        >Dismiss</button>
                      </div>
                    )}
                    {(!aiAssist.streaming && (aiAssist.error || aiAssist.action === "continuity")) && (
                      <div className="flex gap-2 px-4 py-2.5 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <button
                          className="text-xs px-3 py-1.5 rounded-md"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                          onClick={() => setAiAssist(null)}
                        >Dismiss</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Autocomplete dropdown ─────────────────────────────── */}
            {acDropdown && (() => {
              const MARGIN = 8;
              const MAX_ITEMS = 8;
              const visibleItems = acDropdown.items.slice(0, MAX_ITEMS);
              // Position the dropdown below the cursor. Clamp to viewport horizontally.
              const W = 240;
              let left = acDropdown.x;
              if (left + W > window.innerWidth - MARGIN) left = window.innerWidth - W - MARGIN;
              if (left < MARGIN) left = MARGIN;
              const top = acDropdown.y + 4;
              return (
                <div
                  className="fixed z-50 rounded-lg overflow-hidden"
                  style={{
                    left,
                    top,
                    width: W,
                    backgroundColor: "rgba(20,20,32,0.97)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.65)",
                  }}
                  // Prevent the editor from losing focus when clicking an item
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {/* Header hint */}
                  <div className="px-3 pt-1.5 pb-1 flex items-center gap-3">
                    <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Auto-complete</span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.22)" }}>Tab · ↑↓ · Esc</span>
                  </div>
                  <div className="pb-1">
                    {visibleItems.map((item, idx) => {
                      const isSelected = idx === acDropdown.selectedIndex;
                      return (
                        <div
                          key={item.name}
                          onMouseDown={() => {
                            if (!editor) return;
                            editor.commands.insertContent(item.completion);
                            entityDataRef.current.acItems = null;
                            entityDataRef.current.acSelectedIndex = 0;
                            entityDataRef.current._acFirstName = undefined;
                            setAcDropdown(null);
                          }}
                          onMouseEnter={() =>
                            setAcDropdown((prev) =>
                              prev ? { ...prev, selectedIndex: idx } : null
                            )
                          }
                          className="px-3 py-0.5 flex items-center gap-2 cursor-pointer text-sm"
                          style={{
                            backgroundColor: isSelected
                              ? "rgba(255,255,255,0.09)"
                              : "transparent",
                          }}
                        >
                          {/* Color swatch */}
                          {item.color && (
                            <span
                              className="shrink-0 rounded-full"
                              style={{
                                width: 8,
                                height: 8,
                                backgroundColor: item.color,
                                opacity: 0.8,
                              }}
                            />
                          )}
                          {/* Already-typed portion (bright — user already typed this) */}
                          {/* Wrap both spans so gap-2 only separates swatch from text */}
                          <span>
                            <span className="font-medium" style={{ color: "#fff" }}>
                              {item.name.slice(0, item.prefixLen)}
                            </span>
                            {/* Remaining portion to insert (dim — suggestion) */}
                            <span style={{ color: "rgba(255,255,255,0.45)" }}>
                              {item.completion}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    {acDropdown.items.length > MAX_ITEMS && (
                      <div
                        className="px-3 py-1 text-xs"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        +{acDropdown.items.length - MAX_ITEMS} more — keep typing to narrow
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {entityTooltip && (() => {
              const cfg = NODE_TYPE_CONFIG[entityTooltip.node.type] || nodeTypeFallback;
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
            </div>{/* end left content column */}
            {openNodeId && graphData.nodes.some((n) => n.id === openNodeId) && (
              <div style={{ width: 320, flexShrink: 0, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0f0f1a" }}>
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
            </div>{/* end flex row */}

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
                const cfg = NODE_TYPE_CONFIG[node?.type] || nodeTypeFallback;
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
                    // Use entity.nodeId (set by mentionableEntities) for reliable node lookup,
                    // falling back to the old stem-from-filename derivation for legacy entries.
                    const node = entity.nodeId
                      ? graphData.nodes.find((n) => n.id === entity.nodeId)
                      : graphData.nodes.find((n) => {
                          const nid = entity.filename.split("/").pop().replace(/\.(md|txt)$/i, "").replace(/-/g, "_");
                          return n.id === nid;
                        });
                    const cfg = NODE_TYPE_CONFIG[node?.type] || nodeTypeFallback;
                    const isMutual = mutualFilenames.has(entity.filename);
                    const bibFolderParts = entity.filename.split("/");
                    const bibFolderLabel = bibFolderParts.length > 1 ? bibFolderParts.slice(0, -1).join("/") : null;
                    const showBibFolder = bibFolderLabel && multiFileNodeIds.has(entity.nodeId);
                    return (
                      <li key={entity.nodeId ?? entity.filename} className="flex items-start gap-2 min-w-0">
                        <span className="flex-shrink-0 text-xs font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)", minWidth: "1.5rem" }}>
                          {i + 1}.
                        </span>
                        <button
                          onClick={() => openFileByName(entity.filename)}
                          className="text-left min-w-0 group"
                        >
                          <span className="flex items-center flex-wrap gap-x-1">
                            {showBibFolder && (
                              <span className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                                {bibFolderLabel}/
                              </span>
                            )}
                            <span
                              className="text-sm font-medium group-hover:underline"
                              style={{ color: entity.color, textUnderlineOffset: "2px" }}
                            >
                              {entity.name}
                            </span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: cfg.color + "1a", color: cfg.color }}
                            >
                              {cfg.label}
                            </span>
                            {isMutual && (
                              <span title="Mutual — also links back to this file" style={{ display: "inline-flex", alignItems: "center", color: "rgba(255,255,255,0.3)" }}>
                                <ArrowLeftRight size={11} />
                              </span>
                            )}
                          </span>
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
                  {loadingBacklinks && <Loader size={10} className="animate-spin ml-2 inline" style={{ color: "rgba(255,255,255,0.3)" }} />}
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
                    const parts = blFilename.split("/");
                    const stemNodeId = normalizeToId(parts[parts.length - 1].replace(/\.(md|txt)$/i, ""));
                    // Resolve via filenameToNodeId first so merged/renamed nodes (e.g. shouyou.md → sh_y_hinata)
                    // display their authoritative name and colour rather than the raw filename stem.
                    const resolvedNodeId = filenameToNodeId.get(blFilename) ?? stemNodeId;
                    const node = graphData.nodes.find((n) => n.id === resolvedNodeId);
                    const cfg = NODE_TYPE_CONFIG[node?.type] || nodeTypeFallback;
                    const displayName = node?.name ?? parts[parts.length - 1].replace(/\.(md|txt)$/i, "");
                    const color = node ? cfg.color : "rgba(255,255,255,0.5)";
                    const isMutual = mutualFilenames.has(blFilename);
                    // Show folder path when the node has files in multiple locations
                    const folderLabel = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
                    const showFolder = folderLabel && multiFileNodeIds.has(resolvedNodeId);
                    return (
                      <li key={blFilename} className="min-w-0">
                        <button
                          onClick={() => openFileByName(blFilename)}
                          className="text-left min-w-0 group"
                        >
                          <span className="flex items-center flex-wrap gap-x-1">
                            <span className="flex-shrink-0 text-xs font-mono" style={{ color: "rgba(255,255,255,0.25)", minWidth: "1.5rem" }}>
                              {i + 1}.
                            </span>
                            {showFolder && (
                              <span className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                                {folderLabel}/
                              </span>
                            )}
                            <span
                              className="text-sm font-medium group-hover:underline"
                              style={{ color, textUnderlineOffset: "2px" }}
                            >
                              {displayName}
                            </span>
                            {node && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: cfg.color + "1a", color: cfg.color }}
                              >
                                {cfg.label}
                              </span>
                            )}
                            {isMutual && (
                              <span title="Mutual — this file also appears in References" style={{ display: "inline-flex", alignItems: "center", color: "rgba(255,255,255,0.3)" }}>
                                <ArrowLeftRight size={11} />
                              </span>
                            )}
                          </span>
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
                    const cfg = NODE_TYPE_CONFIG[n.type] || nodeTypeFallback;
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
                    const cfg = NODE_TYPE_CONFIG[n.type] || nodeTypeFallback;
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

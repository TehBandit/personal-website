import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import {
  FileText, Plus, Save, Trash2,
  Bold, Italic, List, ListOrdered,
  Heading1, Heading2, Heading3,
  Quote, Code, Minus, Undo, Redo,
  CheckCircle, AlertCircle, Loader,
} from "lucide-react";

const NODE_TYPE_CONFIG = {
  character: { color: "#60a5fa", label: "Character" },
  location:  { color: "#34d399", label: "Location"  },
  faction:   { color: "#fb923c", label: "Faction"   },
  artifact:  { color: "#c084fc", label: "Artifact"  },
};

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
            },
          },
        }),
      ];
    },
  });
}

// ── Toolbar button ─────────────────────────────────────────────────────────────
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

// ── Main component ─────────────────────────────────────────────────────────────
export default function FilesEditor({ graphData = { nodes: [], links: [] } }) {
  const [files, setFiles] = useState([]);
  const [openFile, setOpenFile] = useState(null);   // { filename, content }
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [newFileName, setNewFileName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef(null);
  const newInputRef = useRef(null);
  const entityDataRef = useRef({ entities: [], onOpen: null, currentFilename: null });
  const lastSavedContentRef = useRef(""); // tracks last-written markdown to skip no-op saves
  const openFileRef = useRef(null);        // always current openFile — safe to read inside onUpdate
  const saveFileRef = useRef(null);        // always current saveFile — safe to call inside onUpdate
  const suppressSaveRef = useRef(false);   // true while loading a file — blocks onUpdate from queueing saves

  // Keep refs in sync with their state/callback counterparts every render
  openFileRef.current = openFile;

  // ── Entity link decoration extension (stable ref, never recreated) ───────────
  const entityLinksExtension = useMemo(() => buildEntityLinksExtension(entityDataRef), []);

  // ── TipTap editor ────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { languageClassPrefix: "" } }),
      Markdown.configure({ html: false, tightLists: true }),
      Placeholder.configure({ placeholder: "Start writing your story notes…" }),
      CharacterCount,
      entityLinksExtension,
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
    fetch("/api/notes-raw-list")
      .then((r) => r.json())
      .then((d) => setFiles(d.files || []))
      .catch(console.error);
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // ── Open a file ──────────────────────────────────────────────────────────────
  const openFileByName = useCallback((filename) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLoadingFile(true);
    setIsDirty(false);
    setSaveState("idle");
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}`)
      .then((r) => r.json())
      .then((d) => {
        setOpenFile({ filename: d.filename, content: d.content });
        // Block onUpdate for the duration of this load + any appendTransaction
        // normalization passes that tiptap-markdown may fire immediately after.
        suppressSaveRef.current = true;
        editor?.commands.setContent(d.content, false);
        // Update filename in decoration ref immediately so self-links are
        // suppressed before the React render cycle catches up
        entityDataRef.current.currentFilename = d.filename;
        // After a microtask the editor has settled; capture the serialized
        // baseline so future comparisons use TipTap's canonical form.
        setTimeout(() => {
          lastSavedContentRef.current = editor?.storage.markdown.getMarkdown() ?? d.content;
          suppressSaveRef.current = false;
          setIsDirty(false);
        }, 50);
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
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(currentFile.filename)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Save failed");
        lastSavedContentRef.current = content;
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
  const createFile = useCallback(() => {
    let name = newFileName.trim();
    if (!name) return;
    if (!name.endsWith(".txt")) name += ".txt";
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Create failed");
        setNewFileName("");
        setShowNewInput(false);
        loadFiles();
        openFileByName(name);
      })
      .catch(console.error);
  }, [newFileName, loadFiles, openFileByName]);

  // ── Delete file ──────────────────────────────────────────────────────────────
  const deleteFile = useCallback((filename, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    fetch(`/api/notes-raw-file?filename=${encodeURIComponent(filename)}`, { method: "DELETE" })
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

  // Focus new file input when shown
  useEffect(() => {
    if (showNewInput) setTimeout(() => newInputRef.current?.focus(), 50);
  }, [showNewInput]);

  // ── Mentionable entities: nodes that have a matching notes-raw file ──────────
  const mentionableEntities = useMemo(() => {
    if (!graphData.nodes.length || !files.length) return [];
    const fileSet = new Set(files.map((f) => f.filename));
    const result = [];
    for (const node of graphData.nodes) {
      const candidate = node.id.replace(/_/g, "-") + ".txt";
      if (!fileSet.has(candidate)) continue;
      if (openFile?.filename === candidate) continue; // skip self
      const cfg = NODE_TYPE_CONFIG[node.type] || NODE_TYPE_CONFIG.character;
      result.push({ name: node.name, filename: candidate, color: cfg.color });
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
  }, [mentionableEntities, openFileByName, openFile]);

  // ── Bibliography: nodes mentioned in the open file's prose ──────────────────
  const bibliography = useMemo(() => {
    if (!openFile || !mentionableEntities.length) return [];
    const rawText = openFile.content.toLowerCase();
    const stemWords = new Set(
      openFile.filename.replace(/\.txt$/i, "").split(/[-_]/).map((w) => w.toLowerCase())
    );
    const result = [];
    for (const entity of mentionableEntities) {
      // Skip if entity name words all appear in the filename stem (self)
      const words = entity.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
      if (words.length > 0 && words.every((w) => stemWords.has(w))) continue;
      const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(rawText)) {
        result.push(entity);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [openFile, mentionableEntities]);

  const isEditorReady = !!editor && !loadingFile;
  const canEdit = isEditorReady && !!openFile;

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">

      {/* ── File sidebar ────────────────────────────────────────────────────── */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col border-r overflow-y-auto"
        style={{ backgroundColor: "#13131f", borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* Sidebar header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
            notes-raw
          </span>
          <button
            onClick={() => setShowNewInput((v) => !v)}
            className="p-1 rounded-md transition-colors"
            title="New file"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* New file input */}
        {showNewInput && (
          <div className="px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <input
              ref={newInputRef}
              type="text"
              placeholder="filename.txt"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFile();
                if (e.key === "Escape") { setShowNewInput(false); setNewFileName(""); }
              }}
              className="w-full px-2 py-1.5 rounded-md text-sm outline-none bg-transparent"
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                color: "rgba(255,255,255,0.85)",
                caretColor: "#60a5fa",
              }}
              spellCheck={false}
            />
            <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>Enter to create · Esc to cancel</p>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 p-2">
          {files.length === 0 && (
            <p className="text-xs px-2 py-3" style={{ color: "rgba(255,255,255,0.25)" }}>No files yet</p>
          )}
          {files.map(({ filename }) => {
            const isOpen = openFile?.filename === filename;
            return (
              <div
                key={filename}
                className="group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                style={{ backgroundColor: isOpen ? "rgba(96,165,250,0.12)" : "transparent" }}
                onClick={() => openFileByName(filename)}
                onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <FileText size={13} style={{ color: isOpen ? "#60a5fa" : "rgba(255,255,255,0.3)", flexShrink: 0 }} />
                <span
                  className="text-sm truncate flex-1 leading-tight"
                  style={{ color: isOpen ? "#e2e8f0" : "rgba(255,255,255,0.6)" }}
                >
                  {filename}
                </span>
                <button
                  onClick={(e) => deleteFile(filename, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                  style={{ color: "rgba(248,113,113,0.7)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(248,113,113,0.7)")}
                  title="Delete file"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Editor pane ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

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
            {loadingFile && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(15,15,26,0.6)", zIndex: 10 }}>
                <Loader size={20} className="animate-spin" style={{ color: "rgba(255,255,255,0.3)" }} />
              </div>
            )}
            {/* File title */}
            <p className="text-xs mb-4 font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
              notes-raw / {openFile.filename}
            </p>
            <EditorContent editor={editor} />
            {/* Word count */}
            {editor && (
              <p className="mt-6 text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>
                {editor.storage.characterCount.words()} words · {editor.storage.characterCount.characters()} characters
              </p>
            )}

            {/* ── Bibliography ─────────────────────────────────────── */}
            {bibliography.length > 0 && (
              <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  References
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
                    const node = graphData.nodes.find((n) => n.name === entity.name);
                    const cfg = NODE_TYPE_CONFIG[node?.type] || NODE_TYPE_CONFIG.character;
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
  );
}

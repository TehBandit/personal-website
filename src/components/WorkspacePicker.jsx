import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Plus } from "lucide-react";
import { TYPE_PRESETS } from "../constants/nodeTypes.js";

/**
 * WorkspacePicker — a self-contained dropdown for switching and creating workspaces.
 *
 * Props:
 *   workspaces       [{slug, name}]  full list
 *   workspace        string          active slug
 *   workspaceName    string          display name of active workspace
 *   onWorkspaceChange(slug)
 *   onCreateWorkspace(name, preset, closeCallback)
 */
export default function WorkspacePicker({ workspaces = [], workspace, workspaceName, onWorkspaceChange, onCreateWorkspace }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(null); // null | "preset" | "name"
  const [preset, setPreset] = useState(null);
  const [name, setName] = useState("");
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function close() {
    setOpen(false);
    setStep(null);
    setPreset(null);
    setName("");
  }

  function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreateWorkspace?.(name.trim(), preset, close);
  }

  const activeLabel = workspaceName || workspaces.find((w) => w.slug === workspace)?.name || workspace || "Workspace";

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{
          backgroundColor: open ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
          color: "rgba(255,255,255,0.75)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = open ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)")}
      >
        <span className="max-w-[160px] truncate">{activeLabel}</span>
        <ChevronDown
          size={13}
          style={{
            transition: "transform 0.15s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            color: "rgba(255,255,255,0.35)",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-50 rounded-xl shadow-2xl"
          style={{
            backgroundColor: "#1a1a2e",
            border: "1px solid rgba(255,255,255,0.12)",
            minWidth: "200px",
            width: "max-content",
            maxWidth: "280px",
          }}
        >
          {/* Existing workspaces */}
          <div className="py-1">
            {workspaces.map((ws) => {
              const isActive = ws.slug === workspace;
              return (
                <button
                  key={ws.slug}
                  onClick={() => { onWorkspaceChange?.(ws.slug); close(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm"
                  style={{
                    backgroundColor: isActive ? "rgba(96,165,250,0.1)" : "transparent",
                    color: isActive ? "#93c5fd" : "rgba(255,255,255,0.65)",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <span className="w-4 flex-shrink-0 flex items-center justify-center">
                    {isActive && <Check size={12} style={{ color: "#60a5fa" }} />}
                  </span>
                  <span className="truncate">{ws.name}</span>
                </button>
              );
            })}
          </div>

          {/* Divider + New workspace section */}
          <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            {step === "preset" ? (
              <div className="px-3 pt-3 pb-2">
                <p className="text-xs font-semibold uppercase tracking-widest mb-2.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Choose a type
                </p>
                <div className="flex flex-col gap-0.5">
                  {Object.entries(TYPE_PRESETS).map(([key, p]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setPreset(key); setStep("name"); }}
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
                  onClick={() => setStep(null)}
                  className="text-xs mt-2 px-1"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >← Cancel</button>
              </div>
            ) : step === "name" ? (
              <form onSubmit={handleCreate} className="px-3 pt-3 pb-2">
                <div className="flex items-center gap-2 mb-2.5">
                  <button
                    type="button"
                    onClick={() => setStep("preset")}
                    className="text-xs"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  >← Back</button>
                  {preset && (
                    <div className="flex items-center gap-1.5">
                      {Object.values(TYPE_PRESETS[preset]?.types ?? {}).map((t, i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                      ))}
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {TYPE_PRESETS[preset]?.label}
                      </span>
                    </div>
                  )}
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="Workspace name..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-transparent outline-none text-sm"
                  style={{ color: "rgba(255,255,255,0.85)", caretColor: "#60a5fa" }}
                  onKeyDown={(e) => { if (e.key === "Escape") close(); }}
                />
                <div className="flex gap-1.5 mt-2.5">
                  <button
                    type="submit"
                    className="text-xs px-2.5 py-1 rounded-md font-medium"
                    style={{ backgroundColor: "rgba(96,165,250,0.2)", color: "#93c5fd" }}
                  >Create</button>
                  <button
                    type="button"
                    onClick={close}
                    className="text-xs px-2.5 py-1 rounded-md"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  >Cancel</button>
                </div>
              </form>
            ) : (
              /* Default: "New workspace" button — clearly separated from the list above */
              <button
                onClick={() => setStep("preset")}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium"
                style={{ color: "rgba(96,165,250,0.7)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#93c5fd"; e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.07)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(96,165,250,0.7)"; e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <Plus size={14} className="flex-shrink-0" />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

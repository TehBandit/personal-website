import { useEffect, useRef, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { useStoryGraphTheme } from "../contexts/StoryGraphThemeContext.jsx";

export default function StoryGraphThemeMenu() {
  const { theme, themes, themeId, setThemeId } = useStoryGraphTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
        title="StoryGraph settings"
        style={{
          backgroundColor: theme.colors.surface,
          color: open ? theme.colors.accentStrong : theme.colors.muted,
          border: `1px solid ${open ? theme.colors.accent : theme.colors.border}`,
        }}
      >
        <Settings2 size={18} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
            zIndex: 30,
          }}
        >
          <div className="px-3 py-2 border-b" style={{ borderColor: theme.colors.borderSoft }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: theme.colors.softText }}>
              Theme
            </p>
          </div>
          <div className="p-1.5">
            {themes.map((item) => {
              const active = item.id === themeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setThemeId(item.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors"
                  style={{
                    backgroundColor: active ? theme.colors.accentSoft : "transparent",
                    color: active ? theme.colors.accentStrong : theme.colors.text,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.backgroundColor = theme.colors.accentSoft;
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span>{item.label}</span>
                  {active && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

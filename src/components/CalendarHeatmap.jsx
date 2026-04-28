import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStoryGraphTheme } from "../contexts/StoryGraphThemeContext.jsx";

const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const CELL_GAP = 4;

function heatColor(count, colors) {
  const heatLevels = [
    colors.borderSoft,
    `${colors.accent}4A`,
    `${colors.accent}88`,
    `${colors.accent}C4`,
    colors.accent,
  ];
  if (!count) return heatLevels[0];
  if (count === 1) return heatLevels[1];
  if (count <= 3) return heatLevels[2];
  if (count <= 6) return heatLevels[3];
  return heatLevels[4];
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toDateKey(year, month, day) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export default function CalendarHeatmap({ createdAtMap = {}, journalEntryMap = {}, onJournalDayClick = null }) {
  const { theme } = useStoryGraphTheme();
  const { colors } = theme;
  const today = new Date();
  const curYear = today.getFullYear();
  const [month, setMonth] = useState(today.getMonth());
  const [hover, setHover] = useState(null);

  const todayTs = startOfDay(today.getTime());
  const firstDow = new Date(curYear, month, 1).getDay();
  const totalDays = new Date(curYear, month + 1, 0).getDate();

  const cells = useMemo(() => {
    const next = [];
    for (let i = 0; i < firstDow; i += 1) next.push(null);
    for (let d = 1; d <= totalDays; d += 1) {
      const ts = startOfDay(new Date(curYear, month, d).getTime());
      const isFuture = ts > todayTs;
      const count = isFuture ? 0 : (createdAtMap?.[ts] || 0);
      const hasJournal = !isFuture && Boolean(journalEntryMap?.[ts]);
      next.push({ day: d, ts, count, isFuture, hasJournal });
    }
    return next;
  }, [firstDow, totalDays, curYear, month, todayTs, createdAtMap, journalEntryMap]);

  return (
    <div
      style={{
        padding: "8px 0",
        width: "100%",
        minHeight: 0,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <button
          onClick={() => setMonth((m) => (m === 0 ? 11 : m - 1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: colors.softText, padding: "0 2px", display: "flex", alignItems: "center" }}
        ><ChevronLeft size={13} /></button>
        <span style={{ fontSize: 11, fontWeight: 600, color: colors.muted, textAlign: "center", flex: 1, letterSpacing: "0.02em" }}>
          {MONTH_FULL[month]} {curYear}
        </span>
        <button
          onClick={() => setMonth((m) => (m === 11 ? 0 : m + 1))}
          style={{ background: "none", border: "none", cursor: "pointer", color: colors.softText, padding: "0 2px", display: "flex", alignItems: "center" }}
        ><ChevronRight size={13} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: CELL_GAP, width: "100%" }}>
        {DOW_SHORT.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 9, color: colors.softText, userSelect: "none", fontWeight: 600 }}>{d}</div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          columnGap: CELL_GAP,
          rowGap: CELL_GAP,
          width: "100%",
          flex: 1,
          alignContent: "start",
        }}
      >
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e-${i}`} style={{ aspectRatio: 1 }} />;
          const isToday = cell.ts === todayTs;
          const dateLabel = new Date(curYear, month, cell.day).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
          return (
            <div
              key={cell.ts}
              style={{
                width: "100%",
                aspectRatio: 1,
                borderRadius: 4,
                backgroundColor: cell.isFuture ? colors.borderSoft : heatColor(cell.count, colors),
                border: isToday ? `1px solid ${colors.accent}` : "1px solid transparent",
                position: "relative",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: isToday ? 700 : 400,
                color: cell.isFuture
                  ? colors.softText
                  : cell.count > 2
                  ? colors.textStrong
                  : colors.muted,
                userSelect: "none",
                cursor: cell.hasJournal ? "pointer" : "default",
              }}
              onClick={() => {
                if (!cell.hasJournal || !onJournalDayClick) return;
                onJournalDayClick(toDateKey(curYear, month, cell.day));
              }}
              onMouseEnter={(e) => {
                if (cell.isFuture) return;
                setHover({
                  label: `${cell.count} nodes added, ${cell.hasJournal ? "1" : "no"} journal entry recorded (${dateLabel})`,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onMouseLeave={() => setHover(null)}
            >
              {cell.hasJournal && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: 0,
                    height: 0,
                    borderTop: `8px solid ${colors.warning}`,
                    borderLeft: "8px solid transparent",
                    opacity: 0.95,
                  }}
                />
              )}
              {cell.day}
            </div>
          );
        })}
      </div>

      {hover && (
        <div style={{ position: "fixed", left: hover.x + 12, top: hover.y - 36, backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "5px 10px", fontSize: 12, color: colors.text, pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap" }}>
          {hover.label}
        </div>
      )}
    </div>
  );
}

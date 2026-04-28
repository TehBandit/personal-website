import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { NODE_TYPE_CONFIG as STATIC_NODE_TYPE_CONFIG } from "../constants/nodeTypes";

// ── Helpers ────────────────────────────────────────────────────────────────

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDateShort(ts);
}

// Build cumulative time-series from node list
function buildSeries(nodes, links) {
  if (!nodes.length) return [];

  // Group unique upload events by day: use createdAt if present, otherwise skip
  // (existing pre-timestamp nodes are omitted — they have no reliable create time)
  const datedNodes = nodes.filter((n) => n.createdAt);
  if (!datedNodes.length) return [];

  // Build a map: dayTs → { nodes added, connections added }
  // For connections: count links where BOTH nodes were created on or before that day,
  // tracked cumulatively. We approximate by using the creation day of the later-created
  // node in each connection pair as the day the connection appeared.
  const nodeCreatedAt = new Map(nodes.map((n) => [n.id, n.createdAt || null]));

  // Collect all unique days from node creation timestamps
  const daySet = new Set(datedNodes.map((n) => startOfDay(n.createdAt)));

  // Also add today so the chart always ends at today
  daySet.add(startOfDay(Date.now()));

  const days = [...daySet].sort((a, b) => a - b);

  // Build cumulative series
  const series = [];
  let cumulativeNodes = 0;
  let cumulativeLinks = 0;

  for (const day of days) {
    const dayEnd = day + 86400000; // midnight of next day

    // Count nodes created on or before this day
    cumulativeNodes = datedNodes.filter((n) => n.createdAt < dayEnd).length;

    // Count links where the later-created node was created on or before this day
    cumulativeLinks = links.filter((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      const srcTs = nodeCreatedAt.get(srcId);
      const tgtTs = nodeCreatedAt.get(tgtId);
      if (!srcTs && !tgtTs) return false; // no timestamp info
      const laterTs = Math.max(srcTs || 0, tgtTs || 0);
      return laterTs < dayEnd;
    }).length;

    series.push({ ts: day, nodes: cumulativeNodes, connections: cumulativeLinks });
  }

  return series;
}

// ── Contribution heatmap helpers ─────────────────────────────────────────

function buildContribMap(nodes) {
  const map = new Map(); // dayTs → count
  for (const n of nodes) {
    const days = new Set();
    if (n.createdAt) days.add(startOfDay(n.createdAt));
    if (n.updatedAt) days.add(startOfDay(n.updatedAt));
    for (const d of days) map.set(d, (map.get(d) || 0) + 1);
  }
  return map;
}

function buildHeatmapWeeks() {
  const today = startOfDay(Date.now());
  const todayDow = new Date(today).getDay(); // 0 = Sun
  // Start on the Sunday that is 52 full weeks before this week's Sunday
  const startTs = today - (52 * 7 + todayDow) * 86400000;
  const weeks = [];
  const monthCols = [];
  const seenMonths = new Set();
  let cur = startTs;
  let col = 0;
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push({ ts: cur, isFuture: cur > today });
      if (d === 0) {
        const key = `${new Date(cur).getFullYear()}-${new Date(cur).getMonth()}`;
        if (!seenMonths.has(key)) {
          seenMonths.add(key);
          monthCols.push({ label: new Date(cur).toLocaleString(undefined, { month: "short" }), col });
        }
      }
      cur += 86400000;
    }
    weeks.push(week);
    col++;
  }
  return { weeks, monthCols };
}

// Build a chronological activity timeline from node list
// Returns array of day-groups, newest first:
//   { dateLabel, events: [ { type: 'created'|'edited'|'generated', node?, count? } ] }
function buildActivityTimeline(nodes) {
  // Group events by calendar day
  const dayMap = new Map(); // dayTs → { created: [], edited: [], generated: [] }
  const ensure = (ts) => {
    if (!dayMap.has(ts)) dayMap.set(ts, { created: [], edited: [], generated: [] });
    return dayMap.get(ts);
  };

  for (const n of nodes) {
    const hasFile = n.filePreview !== undefined; // only nodes with own raw files have filePreview
    if (n.createdAt) {
      const d = startOfDay(n.createdAt);
      if (hasFile) ensure(d).created.push(n);
      else ensure(d).generated.push(n);
    }
    // Only count an edit if updatedAt is meaningfully later than createdAt (>1 min)
    if (n.updatedAt && hasFile && (!n.createdAt || n.updatedAt - n.createdAt > 60000)) {
      const d = startOfDay(n.updatedAt);
      // Don't double-count a node created+edited on the same day  
      const bucket = ensure(d);
      if (!bucket.created.some((c) => c.id === n.id)) {
        bucket.edited.push(n);
      }
    }
  }

  const result = [];
  for (const [ts, { created, edited, generated }] of [...dayMap.entries()].sort((a, b) => b[0] - a[0])) {
    const events = [];
    // Deduplicate nodes that appear in both created and edited on same day (keep created)
    const createdIds = new Set(created.map((n) => n.id));
    const filteredEdited = edited.filter((n) => !createdIds.has(n.id));

    for (const n of created) events.push({ type: "created", node: n });
    for (const n of filteredEdited) events.push({ type: "edited", node: n });
    if (generated.length) events.push({ type: "generated", count: generated.length, nodes: generated });
    if (events.length) result.push({ ts, dateLabel: formatDate(ts), events });
  }
  return result;
}

function getNodeTs(node) {
  const ts = Number(node?.createdAt || node?.updatedAt || 0);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function buildTimelapseNodes(nodes) {
  return nodes
    .map((n) => ({ ...n, _tlTs: getNodeTs(n) }))
    .filter((n) => n._tlTs)
    .sort((a, b) => a._tlTs - b._tlTs || String(a.name).localeCompare(String(b.name)));
}

function linkIds(link) {
  const source = typeof link.source === "object" ? link.source.id : link.source;
  const target = typeof link.target === "object" ? link.target.id : link.target;
  return [source, target];
}

function buildPropagationDepth(originId, visibleNodeIds, links) {
  if (!originId || !visibleNodeIds?.has(originId)) return { depths: new Map(), maxDepth: 0, reached: 0 };
  const adj = new Map();
  for (const id of visibleNodeIds) adj.set(id, new Set());
  for (const link of links) {
    const [s, t] = linkIds(link);
    if (!visibleNodeIds.has(s) || !visibleNodeIds.has(t)) continue;
    adj.get(s).add(t);
    adj.get(t).add(s);
  }

  const depths = new Map([[originId, 0]]);
  const q = [originId];
  while (q.length) {
    const cur = q.shift();
    const d = depths.get(cur) ?? 0;
    for (const nxt of (adj.get(cur) || [])) {
      if (depths.has(nxt)) continue;
      depths.set(nxt, d + 1);
      q.push(nxt);
    }
  }

  let maxDepth = 0;
  for (const d of depths.values()) if (d > maxDepth) maxDepth = d;
  return { depths, maxDepth, reached: depths.size };
}

const HEAT_LEVELS = [
  "rgba(255,255,255,0.06)",
  "rgba(96,165,250,0.28)",
  "rgba(96,165,250,0.55)",
  "rgba(96,165,250,0.78)",
  "#60a5fa",
];
function heatColor(count) {
  if (!count) return HEAT_LEVELS[0];
  if (count === 1) return HEAT_LEVELS[1];
  if (count <= 3) return HEAT_LEVELS[2];
  if (count <= 6) return HEAT_LEVELS[3];
  return HEAT_LEVELS[4];
}

// ── Tooltips ───────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = { backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)" };

function GrowthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-sm shadow-xl" style={TOOLTIP_STYLE}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
        {formatDate(label)}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{p.name}</span>
          <span className="font-semibold ml-auto pl-4" style={{ color: "#fff" }}>{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function DayTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-sm shadow-xl" style={TOOLTIP_STYLE}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
        {label}
      </p>
      <p className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#60a5fa" }} />
        <span style={{ color: "rgba(255,255,255,0.7)" }}>Nodes added</span>
        <span className="font-semibold ml-auto pl-4" style={{ color: "#fff" }}>{payload[0]?.value}</span>
      </p>
    </div>
  );
}

// ── Shared card style ──────────────────────────────────────────────────────
const CARD_STYLE = { backgroundColor: "#13131f", border: "1px solid rgba(255,255,255,0.07)" };
const MUTED = { color: "rgba(255,255,255,0.35)" };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Main component ─────────────────────────────────────────────────────────

export default function Dashboard({ graphData = { nodes: [], links: [] }, nodeTypeConfig = STATIC_NODE_TYPE_CONFIG, onOpenNode }) {
  const { nodes, links } = graphData;

  const [hoverCell, setHoverCell] = useState(null);
  const [growthFacet, setGrowthFacet] = useState("1Y");
  const [timelapseOpen, setTimelapseOpen] = useState(false);
  const [timelapsePlaying, setTimelapsePlaying] = useState(false);
  const [timelapseFrame, setTimelapseFrame] = useState(0);
  const [timelapseSpeedMs, setTimelapseSpeedMs] = useState(220);

  const contribMap = useMemo(() => buildContribMap(nodes), [nodes]);
  const heatmapGrid = useMemo(() => buildHeatmapWeeks(), []);
  const activityTimeline = useMemo(() => buildActivityTimeline(nodes), [nodes]);

  const series = useMemo(() => buildSeries(nodes, links), [nodes, links]);

  const hasTimestampedNodes = nodes.some((n) => n.createdAt);
  const totalNodes = nodes.length;
  const totalConnections = links.length;
  const timestampedCount = nodes.filter((n) => n.createdAt).length;

  // Most-connected node
  const degreeMap = useMemo(() => {
    const m = new Map();
    for (const l of links) {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      m.set(s, (m.get(s) || 0) + 1);
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }, [links]);

  const mostConnected = useMemo(() => {
    if (!nodes.length) return null;
    return nodes.reduce((best, n) =>
      (degreeMap.get(n.id) || 0) > (degreeMap.get(best.id) || 0) ? n : best,
      nodes[0]
    );
  }, [nodes, degreeMap]);

  // Type distribution
  const typeDistribution = useMemo(() => {
    const counts = {};
    for (const n of nodes) {
      const t = n.type || "unknown";
      counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        label: nodeTypeConfig[type]?.label ?? (type.charAt(0).toUpperCase() + type.slice(1)),
        color: nodeTypeConfig[type]?.color ?? "#6b7280",
      }));
  }, [nodes, nodeTypeConfig]);

  // Day-of-week cadence (Mon–Sun)
  const dayCadence = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const n of nodes) {
      const ts = Math.max(n.createdAt || 0, n.updatedAt || 0);
      if (ts) counts[new Date(ts).getDay()]++;
    }
    // Rotate so Monday is first (index 1 → 0)
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: DAY_NAMES[d], count: counts[d] }));
  }, [nodes]);

  // Recently edited: own-file nodes sorted by updatedAt desc, top 5
  const recentlyEdited = useMemo(
    () =>
      nodes
        .filter((n) => n.updatedAt && n.filePreview !== undefined)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [nodes]
  );

  // Filtered series for the selected growth facet
  const GROWTH_FACETS = ["1D", "1W", "1M", "YTD", "1Y"];
  const filteredSeries = useMemo(() => {
    if (!series.length) return series;
    const now = Date.now();
    let cutoff;
    if (growthFacet === "1D")  cutoff = startOfDay(now);
    else if (growthFacet === "1W")  cutoff = now - 7  * 86400000;
    else if (growthFacet === "1M")  cutoff = now - 30 * 86400000;
    else if (growthFacet === "YTD") cutoff = new Date(new Date().getFullYear(), 0, 1).getTime();
    else                            cutoff = now - 365 * 86400000;
    const filtered = series.filter((p) => p.ts >= cutoff);
    // Always include one point before the window so lines start from the left edge
    if (filtered.length && filtered[0].ts > cutoff) {
      const prev = [...series].reverse().find((p) => p.ts < cutoff);
      if (prev) filtered.unshift({ ...prev, ts: cutoff });
    }
    return filtered;
  }, [series, growthFacet]);

  const timelapseNodes = useMemo(() => buildTimelapseNodes(nodes), [nodes]);
  const timelapseMaxFrame = Math.max(0, timelapseNodes.length - 1);
  const timelapseCurrentNode = timelapseNodes[Math.min(timelapseFrame, timelapseMaxFrame)] || null;
  const timelapseStartNode = timelapseNodes[0] || null;

  const timelapseNodeIndexMap = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < timelapseNodes.length; i++) map.set(timelapseNodes[i].id, i);
    return map;
  }, [timelapseNodes]);

  // Build stable object pools once so d3 keeps x/y/velocity across frames.
  const timelapseNodePool = useMemo(
    () => timelapseNodes.map((n, idx) => ({ id: n.id, name: n.name, type: n.type, filePreview: n.filePreview, revealIndex: idx })),
    [timelapseNodes]
  );

  const timelapseLinkPool = useMemo(() => {
    const pool = [];
    for (const l of links) {
      const [s, t] = linkIds(l);
      const sIdx = timelapseNodeIndexMap.get(s);
      const tIdx = timelapseNodeIndexMap.get(t);
      if (sIdx === undefined || tIdx === undefined) continue;
      pool.push({ source: s, target: t, revealIndex: Math.max(sIdx, tIdx) });
    }
    return pool;
  }, [links, timelapseNodeIndexMap]);

  const timelapseGraphData = useMemo(() => {
    const end = Math.min(timelapseFrame, timelapseMaxFrame);
    return {
      nodes: timelapseNodePool.slice(0, end + 1),
      links: timelapseLinkPool.filter((l) => l.revealIndex <= end),
    };
  }, [timelapseFrame, timelapseMaxFrame, timelapseNodePool, timelapseLinkPool]);

  const visibleNodeIds = useMemo(() => new Set(timelapseGraphData.nodes.map((n) => n.id)), [timelapseGraphData.nodes]);
  const timelapseVisibleLinks = timelapseGraphData.links;

  const timelapsePropagation = useMemo(
    () => buildPropagationDepth(timelapseStartNode?.id, visibleNodeIds, timelapseVisibleLinks),
    [timelapseStartNode, visibleNodeIds, timelapseVisibleLinks]
  );

  const timelapseDegreeMap = useMemo(() => {
    const m = new Map();
    for (const l of timelapseVisibleLinks) {
      const [s, t] = linkIds(l);
      m.set(s, (m.get(s) || 0) + 1);
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }, [timelapseVisibleLinks]);

  const timelapseDepthBuckets = useMemo(() => {
    const buckets = new Map();
    for (const depth of timelapsePropagation.depths.values()) {
      buckets.set(depth, (buckets.get(depth) || 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  }, [timelapsePropagation]);
  const timelapseGraphRef = useRef(null);
  const timelapsePrevFrameRef = useRef(-1);

  useEffect(() => {
    if (timelapseFrame <= timelapseMaxFrame) return;
    setTimelapseFrame(timelapseMaxFrame);
  }, [timelapseFrame, timelapseMaxFrame]);

  useEffect(() => {
    if (!timelapseOpen || !timelapsePlaying) return;
    if (timelapseFrame >= timelapseMaxFrame) {
      setTimelapsePlaying(false);
      return;
    }
    const t = setTimeout(() => {
      setTimelapseFrame((prev) => Math.min(prev + 1, timelapseMaxFrame));
    }, timelapseSpeedMs);
    return () => clearTimeout(t);
  }, [timelapseOpen, timelapsePlaying, timelapseFrame, timelapseMaxFrame, timelapseSpeedMs]);

  useEffect(() => {
    if (!timelapseOpen) return;
    const fg = timelapseGraphRef.current;
    if (!fg) return;

    fg.d3Force("charge").strength(-135).distanceMax(420);
    fg.d3Force("link").distance(88).strength(0.75);
    fg.d3Force("center").strength(0.12);
    fg.d3Force("collision", null);
    timelapsePrevFrameRef.current = -1;
  }, [timelapseOpen]);

  useEffect(() => {
    if (!timelapseOpen) return;
    const prev = timelapsePrevFrameRef.current;
    timelapsePrevFrameRef.current = timelapseFrame;
    if (prev < 0 || timelapseFrame <= prev) return;

    // Seed newly revealed nodes near already-visible neighbors so the force
    // simulation extends smoothly instead of popping from random positions.
    for (let i = prev + 1; i <= timelapseFrame; i++) {
      const newNode = timelapseNodePool[i];
      if (!newNode) continue;
      if (Number.isFinite(newNode.x) && Number.isFinite(newNode.y)) continue;

      let anchor = null;
      for (const l of timelapseLinkPool) {
        if (l.revealIndex > timelapseFrame) continue;
        if (l.source === newNode.id) {
          const idx = timelapseNodeIndexMap.get(l.target);
          if (idx !== undefined && idx <= prev) { anchor = timelapseNodePool[idx]; break; }
        }
        if (l.target === newNode.id) {
          const idx = timelapseNodeIndexMap.get(l.source);
          if (idx !== undefined && idx <= prev) { anchor = timelapseNodePool[idx]; break; }
        }
      }

      const jitter = () => (Math.random() - 0.5) * 18;
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        newNode.x = anchor.x + jitter();
        newNode.y = anchor.y + jitter();
        newNode.vx = (anchor.vx || 0) * 0.35;
        newNode.vy = (anchor.vy || 0) * 0.35;
      } else {
        newNode.x = 430 + jitter();
        newNode.y = 160 + jitter();
        newNode.vx = 0;
        newNode.vy = 0;
      }
    }
  }, [timelapseOpen, timelapseFrame, timelapseNodePool, timelapseLinkPool, timelapseNodeIndexMap]);

  // Session streak — based on any day a node was created OR edited
  const streakData = useMemo(() => {    const daysSet = new Set(
      nodes
        .map((n) => Math.max(n.createdAt || 0, n.updatedAt || 0))
        .filter(Boolean)
        .map(startOfDay)
    );
    if (!daysSet.size) return { current: 0, longest: 0 };
    const sorted = [...daysSet].sort((a, b) => a - b);
    let longest = 1, run = 1;
    for (let i = 1; i < sorted.length; i++) {
      run = sorted[i] - sorted[i - 1] === 86400000 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    const today = startOfDay(Date.now());
    let cur = 0, check = daysSet.has(today) ? today : today - 86400000;
    while (daysSet.has(check)) { cur++; check -= 86400000; }
    return { current: cur, longest };
  }, [nodes]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-8 gap-8" style={{ backgroundColor: "#0f0f1a" }}>

      {/* ── Recently edited strip ────────────────────────────────────────── */}
      <div className="rounded-lg px-4 py-2.5 flex items-center gap-3 flex-wrap" style={{ ...CARD_STYLE, minHeight: 40 }}>
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Recently edited</span>
        <span className="flex-shrink-0" style={{ width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.1)" }} />
        {!recentlyEdited.length ? (
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>No edits recorded yet</span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {recentlyEdited.map((n, i) => {
              const cfg = nodeTypeConfig[n.type];
              return (
                <span key={n.id} className="flex items-center gap-1.5">
                  {i > 0 && <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>·</span>}
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg?.color ?? "#6b7280" }} />
                  <button
                    onClick={() => onOpenNode?.(n.id)}
                    className="text-xs hover:underline"
                    style={{ color: "#60a5fa", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >{n.name}</button>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>{relativeTime(n.updatedAt)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Nodes",    value: totalNodes,                          color: "#60a5fa" },
          { label: "Connections",    value: totalConnections,                    color: "#a78bfa" },
          { label: "Most Connected", value: mostConnected?.name ?? "—",          color: "#34d399",
            sub: mostConnected ? `${degreeMap.get(mostConnected.id) || 0} connections` : null },
          { label: "Current Streak", value: streakData.current ? `${streakData.current}d` : "—", color: "#fb923c",
            sub: streakData.longest > 0 ? `Best: ${streakData.longest}d` : null },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-xl p-5" style={CARD_STYLE}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            {sub && <p className="text-xs mt-0.5" style={MUTED}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Growth chart ────────────────────────────────────────────────── */}
      <div className="rounded-xl p-6" style={CARD_STYLE}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-white mb-0.5">Graph Growth Over Time</h2>
            <p className="text-xs" style={MUTED}>Cumulative nodes and connections by upload date</p>
          </div>
          <div className="flex items-center gap-2">
            {hasTimestampedNodes && timestampedCount < totalNodes && (
              <span className="text-xs px-2.5 py-1 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                {timestampedCount} of {totalNodes} nodes have timestamps
              </span>
            )}
            {!hasTimestampedNodes && (
              <span className="text-xs px-2.5 py-1 rounded-lg" style={{ backgroundColor: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>
                No timestamp data yet
              </span>
            )}
            <div className="flex" style={{ backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3, gap: 2 }}>
              {GROWTH_FACETS.map((f) => (
                <button key={f} onClick={() => setGrowthFacet(f)}
                  className="text-xs px-2.5 py-1 rounded-md"
                  style={{
                    background: growthFacet === f ? "rgba(96,165,250,0.18)" : "transparent",
                    color: growthFacet === f ? "#60a5fa" : "rgba(255,255,255,0.35)",
                    border: "none", cursor: "pointer", fontWeight: growthFacet === f ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >{f}</button>
              ))}
            </div>
            <button
              onClick={() => {
                setTimelapseFrame(0);
                setTimelapsePlaying(true);
                setTimelapseOpen(true);
              }}
              disabled={!timelapseNodes.length}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                backgroundColor: timelapseNodes.length ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.05)",
                color: timelapseNodes.length ? "#93c5fd" : "rgba(255,255,255,0.2)",
                border: "1px solid rgba(96,165,250,0.25)",
                cursor: timelapseNodes.length ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              Generate Timelapse
            </button>
          </div>
        </div>
        {!hasTimestampedNodes ? (
          <div className="flex items-center justify-center h-48" style={{ color: "rgba(255,255,255,0.2)" }}>
            <p className="text-sm">Chart will appear after the first upload</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={filteredSeries} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradNodes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradConns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]}
                tickFormatter={(ts) => {
                  if (growthFacet === "1D") return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  if (growthFacet === "1W") return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  if (growthFacet === "1M") return formatDateShort(ts);
                  return new Date(ts).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
                }}
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }} axisLine={false}
                tickLine={false} width={32} allowDecimals={false} />
              <Tooltip content={<GrowthTooltip />} />
              <Legend wrapperStyle={{ paddingTop: "16px", fontSize: "12px", color: "rgba(255,255,255,0.5)" }} />
              <Area type="monotone" dataKey="nodes" name="Nodes" stroke="#60a5fa" strokeWidth={2}
                fill="url(#gradNodes)" dot={false} activeDot={{ r: 4, fill: "#60a5fa", strokeWidth: 0 }} />
              <Area type="monotone" dataKey="connections" name="Connections" stroke="#a78bfa" strokeWidth={2}
                fill="url(#gradConns)" dot={false} activeDot={{ r: 4, fill: "#a78bfa", strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Heatmap + Activity timeline ──────────────────────────────────── */}
      <div className="rounded-xl p-6" style={CARD_STYLE}>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* Left: title + heatmap + legend */}
          <div style={{ flexShrink: 0 }}>
            <h2 className="text-sm font-semibold text-white mb-0.5">Contribution Activity</h2>
            <p className="text-xs mb-5" style={MUTED}>Daily note activity over the past year</p>
            <div style={{ display: "flex", gap: "4px" }}>
              {/* Day-of-week labels */}
              <div style={{ display: "flex", flexDirection: "column", gap: "3px", paddingTop: "22px" }}>
                {["", "Mon", "", "Wed", "", "Fri", ""].map((lbl, i) => (
                  <div key={i} style={{ height: 11, lineHeight: "11px", fontSize: 10, color: "rgba(255,255,255,0.3)", width: 24, userSelect: "none" }}>
                    {lbl}
                  </div>
                ))}
              </div>

              {/* Weeks + month labels */}
              <div style={{ position: "relative" }}>
                <div style={{ position: "relative", height: 20, marginBottom: 2 }}>
                  {heatmapGrid.monthCols.map(({ label, col }) => (
                    <span key={`${label}-${col}`} style={{ position: "absolute", left: col * 14, fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap", userSelect: "none" }}>
                      {label}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {heatmapGrid.weeks.map((week, wi) => (
                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {week.map(({ ts, isFuture }, di) => {
                        const count = isFuture ? 0 : (contribMap.get(ts) || 0);
                        const dateStr = new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                        return (
                          <div
                            key={di}
                            style={{ width: 11, height: 11, borderRadius: 2, flexShrink: 0, backgroundColor: isFuture ? "transparent" : heatColor(count) }}
                            onMouseEnter={(e) => setHoverCell({ label: `${count || "No"} contribution${count !== 1 ? "s" : ""} on ${dateStr}`, x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setHoverCell(null)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Less</span>
              {[0, 1, 2, 4, 7].map((v, i) => (
                <div key={i} style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: heatColor(v) }} />
              ))}
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>More</span>
            </div>
          </div>

          {/* Vertical divider */}
          <div style={{ width: 1, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.07)", flexShrink: 0 }} />

          {/* Right: activity timeline — flush to top of card */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", maxHeight: 220 }}>
            {!activityTimeline.length ? (
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>No activity yet</p>
            ) : (
              <div className="flex flex-col gap-5">
                {activityTimeline.map(({ ts, dateLabel, events }) => (
                  <div key={ts}>
                    <div className="flex items-center gap-3 mb-2.5">
                      <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>{dateLabel}</span>
                      <div className="flex-1" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                    </div>
                    <div className="flex flex-col gap-2">
                      {events.map((ev, ei) => {
                        if (ev.type === "generated") {
                          return (
                            <div key={ei} className="flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                              <span className="mt-0.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>⬡</span>
                              <span>Generated <span style={{ color: "rgba(255,255,255,0.65)" }}>{ev.count}</span> node{ev.count !== 1 ? "s" : ""}</span>
                            </div>
                          );
                        }
                        const cfg = nodeTypeConfig[ev.node.type];
                        const dot = <span className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: cfg?.color ?? "#6b7280", display: "inline-block" }} />;
                        const actionLabel = ev.type === "created" ? "Created" : "Edited";
                        const canOpen = onOpenNode && ev.node.filePreview !== undefined;
                        return (
                          <div key={ei} className="flex items-start gap-2 text-xs">
                            {dot}
                            <span style={{ color: "rgba(255,255,255,0.4)" }}>{actionLabel} </span>
                            {canOpen ? (
                              <button
                                onClick={() => onOpenNode(ev.node.id)}
                                className="font-medium text-left hover:underline"
                                style={{ color: "#60a5fa", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
                                {ev.node.name}
                              </button>
                            ) : (
                              <span className="font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>{ev.node.name}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Type donut + Weekly cadence ──────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Type distribution donut */}
        <div className="rounded-xl p-6" style={CARD_STYLE}>
          <h2 className="text-sm font-semibold text-white mb-0.5">Type Distribution</h2>
          <p className="text-xs mb-4" style={MUTED}>Breakdown of node types</p>
          {!typeDistribution.length ? (
            <div className="flex items-center justify-center h-40" style={{ color: "rgba(255,255,255,0.2)" }}>
              <p className="text-sm">No nodes</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={typeDistribution} cx="50%" cy="50%"
                    innerRadius={44} outerRadius={70} paddingAngle={3}
                    dataKey="count" nameKey="label" strokeWidth={0}>
                    {typeDistribution.map((entry) => (
                      <Cell key={entry.type} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [value, name]}
                    contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", fontSize: "12px", color: "#fff" }}
                    itemStyle={{ color: "rgba(255,255,255,0.8)" }}
                    cursor={false}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5 mt-2">
                {typeDistribution.map((entry) => (
                  <div key={entry.type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                      <span style={{ color: "rgba(255,255,255,0.6)" }}>{entry.label}</span>
                    </div>
                    <span className="font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{entry.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Day-of-week cadence */}
        <div className="col-span-2 rounded-xl p-6" style={CARD_STYLE}>
          <h2 className="text-sm font-semibold text-white mb-0.5">Upload Cadence by Day</h2>
          <p className="text-xs mb-4" style={MUTED}>Total nodes added per day of the week</p>
          {!nodes.some((n) => n.createdAt) ? (
            <div className="flex items-center justify-center h-full min-h-40" style={{ color: "rgba(255,255,255,0.2)" }}>
              <p className="text-sm">No timestamped nodes yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayCadence} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="day"
                  tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                  axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip content={<DayTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {dayCadence.map((entry, i) => {
                    const today = new Date().getDay();
                    const dayIndex = [1,2,3,4,5,6,0][i];
                    return <Cell key={i} fill={dayIndex === today ? "#93c5fd" : "#3b82f6"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Timelapse modal ─────────────────────────────────────────────── */}
      {timelapseOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(8,10,18,0.74)",
            backdropFilter: "blur(6px)",
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onMouseDown={() => {
            setTimelapseOpen(false);
            setTimelapsePlaying(false);
          }}
        >
          <div
            style={{
              width: "min(920px, 92vw)",
              backgroundColor: "#13131f",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 18,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Workspace Iteration Timelapse</h3>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Nodes reveal chronologically; propagation waves are measured from the first node.
                </p>
              </div>
              <button
                onClick={() => {
                  setTimelapseOpen(false);
                  setTimelapsePlaying(false);
                }}
                className="text-xs px-2.5 py-1 rounded"
                style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)", border: "none", cursor: "pointer" }}
              >Close</button>
            </div>

            {!timelapseNodes.length ? (
              <div className="h-40 flex items-center justify-center" style={{ color: "rgba(255,255,255,0.35)" }}>
                No timestamped nodes available for timelapse.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Visible Nodes</p>
                    <p className="text-lg font-semibold" style={{ color: "#60a5fa" }}>{visibleNodeIds.size}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Visible Links</p>
                    <p className="text-lg font-semibold" style={{ color: "#a78bfa" }}>{timelapseVisibleLinks.length}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Propagation Depth</p>
                    <p className="text-lg font-semibold" style={{ color: "#34d399" }}>{timelapsePropagation.maxDepth}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Frame</p>
                    <p className="text-lg font-semibold" style={{ color: "#fbbf24" }}>{timelapseFrame + 1} / {timelapseNodes.length}</p>
                  </div>
                </div>

                <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Current reveal</p>
                  <p className="text-sm font-semibold text-white">
                    {timelapseCurrentNode?.name || "-"}
                    <span className="ml-2 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {timelapseCurrentNode?._tlTs ? formatDate(timelapseCurrentNode._tlTs) : ""}
                    </span>
                  </p>
                </div>

                <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>Graph Build View</p>
                  <div style={{ width: "100%", height: 320, borderRadius: 10, overflow: "hidden", backgroundColor: "rgba(8,10,18,0.55)" }}>
                    <ForceGraph2D
                      ref={timelapseGraphRef}
                      graphData={timelapseGraphData}
                      width={860}
                      height={320}
                      backgroundColor="rgba(8,10,18,0)"
                      cooldownTicks={80}
                      nodeRelSize={4}
                      nodeCanvasObjectMode={() => "replace"}
                      nodeCanvasObject={(node, ctx, globalScale) => {
                        const isDerived = !Object.prototype.hasOwnProperty.call(node, "filePreview") || node.filePreview === undefined;
                        const cfg = nodeTypeConfig[node.type];
                        const baseColor = isDerived ? "#6b7280" : (cfg?.color ?? "#6b7280");
                        const deg = timelapseDegreeMap.get(node.id) || 0;
                        const r = isDerived ? Math.max((4 + Math.sqrt(deg) * 7) * 0.65, 3) : (4 + Math.sqrt(deg) * 7);

                        if (node.id === timelapseCurrentNode?.id) {
                          ctx.beginPath();
                          ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
                          ctx.fillStyle = baseColor + "35";
                          ctx.fill();
                        }

                        ctx.beginPath();
                        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                        ctx.fillStyle = baseColor;
                        ctx.fill();

                        const LABEL_HIDE = 0.45;
                        const LABEL_FADE = 0.70;
                        if (globalScale < LABEL_HIDE) return;
                        const zoomAlpha = globalScale < LABEL_FADE
                          ? (globalScale - LABEL_HIDE) / (LABEL_FADE - LABEL_HIDE)
                          : 1;

                        const fontSize = Math.max(12 / globalScale, 3.5);
                        const labelY = node.y + r + fontSize * 0.3 + 4 / globalScale;
                        ctx.globalAlpha = zoomAlpha;
                        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillStyle = "#cbd5e1";
                        ctx.fillText(node.name || "", node.x, labelY);
                        ctx.globalAlpha = 1;
                      }}
                      linkColor={() => "rgba(255,255,255,0.18)"}
                      linkWidth={() => 1.5}
                      enablePanInteraction
                      enableZoomInteraction
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <input
                    type="range"
                    min={0}
                    max={timelapseMaxFrame}
                    value={Math.min(timelapseFrame, timelapseMaxFrame)}
                    onChange={(e) => {
                      setTimelapsePlaying(false);
                      setTimelapseFrame(Number(e.target.value));
                    }}
                    style={{ width: "100%" }}
                  />
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setTimelapsePlaying((v) => !v)}
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ backgroundColor: "rgba(96,165,250,0.16)", color: "#93c5fd", border: "none", cursor: "pointer" }}
                  >{timelapsePlaying ? "Pause" : "Play"}</button>
                  <button
                    onClick={() => {
                      setTimelapsePlaying(false);
                      setTimelapseFrame(0);
                    }}
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)", border: "none", cursor: "pointer" }}
                  >Reset</button>
                  <label className="text-xs ml-2" style={{ color: "rgba(255,255,255,0.45)" }}>Speed</label>
                  <select
                    value={timelapseSpeedMs}
                    onChange={(e) => setTimelapseSpeedMs(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}
                  >
                    <option value={360}>Slow</option>
                    <option value={220}>Normal</option>
                    <option value={120}>Fast</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>Propagation Rings</p>
                    {timelapseDepthBuckets.length === 0 ? (
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No connected nodes revealed yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {timelapseDepthBuckets.map(([depth, count]) => (
                          <div key={depth} className="flex items-center justify-between text-xs">
                            <span style={{ color: "rgba(255,255,255,0.6)" }}>Depth {depth}</span>
                            <span style={{ color: "#fff", fontWeight: 600 }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>Span</p>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                      Start: {timelapseStartNode?._tlTs ? formatDate(timelapseStartNode._tlTs) : "-"}
                    </p>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                      Current: {timelapseCurrentNode?._tlTs ? formatDate(timelapseCurrentNode._tlTs) : "-"}
                    </p>
                    <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      Origin node: <span style={{ color: "#fff" }}>{timelapseStartNode?.name || "-"}</span>
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Heatmap hover tooltip */}
      {hoverCell && (
        <div style={{ position: "fixed", left: hoverCell.x + 12, top: hoverCell.y - 36, backgroundColor: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#fff", pointerEvents: "none", zIndex: 9999, whiteSpace: "nowrap" }}>
          {hoverCell.label}
        </div>
      )}

    </div>
  );
}

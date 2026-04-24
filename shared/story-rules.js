/**
 * Shared text rules used by both API and frontend code.
 * Contains pure string/regex logic only (no fs/path/browser dependencies).
 */

export function escapeRegexLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWordBoundaryPattern(term) {
  return `\\b${escapeRegexLiteral(term)}\\b`;
}

export function overlapsAnyRange(start, end, ranges) {
  return ranges.some((r) => start < r.end && end > r.start);
}

/**
 * Greedy non-overlapping matcher.
 *
 * Input candidates should generally be sorted longest-first by caller.
 * Returns matches with the original candidate under `item`.
 */
export function collectGreedyMatches(text, candidates) {
  if (!text || !candidates?.length) return [];

  const occupied = [];
  const matches = [];

  for (const item of candidates) {
    if (!item?.patternSource) continue;
    const re = new RegExp(item.patternSource, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsAnyRange(start, end, occupied)) continue;
      occupied.push({ start, end });
      matches.push({ start, end, text: m[0], item });
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  return matches;
}

function stripInlineMarkup(str) {
  return str
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/_([^_]*)_/g, "$1")
    .replace(/~~([^~]*)~~/g, "$1")
    .replace(/<\/?[ubi]>/gi, "")
    .trim();
}

/**
 * Extract a human-friendly title from raw file content.
 *
 * Detection order:
 * 1) Markdown heading in first non-empty line
 * 2) Styled first line followed by a blank line
 */
export function extractTitleFromContent(content) {
  if (!content || typeof content !== "string") return null;

  const lines = content.split(/\r?\n/);

  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) return null;

  const firstLine = lines[firstIdx].trim();

  const headingMatch = firstLine.match(/^#{1,3}\s+(.+)/);
  if (headingMatch) {
    const title = stripInlineMarkup(headingMatch[1]).substring(0, 120);
    return title || null;
  }

  const nextIdx = firstIdx + 1;
  if (nextIdx >= lines.length) return null;
  if (lines[nextIdx].trim() !== "") return null;

  if (/[.!?;:,]$/.test(firstLine.replace(/<\/?\w+>/g, "").replace(/\*+/g, "").trim())) return null;

  const stripped = stripInlineMarkup(firstLine);
  if (stripped.length > 100 || stripped.length === 0) return null;

  return stripped.substring(0, 120);
}

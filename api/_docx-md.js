/**
 * _docx-md.js  (internal utility — not an API endpoint)
 * Shared helper for converting mammoth HTML output to Markdown.
 * Used by docx-to-md.js (FilesEditor import) and story-extract.js (upload flow).
 */
import { createRequire } from "module";
const _cjsRequire = createRequire(import.meta.url);

// ── Color marker constants (Unicode Private Use Area) ─────────────────────
// These are injected into DOCX text runs before mammoth converts them, so
// color/highlight info survives the HTML conversion and can be turned into
// semantic <font>/<mark> tags afterwards. PUA chars are never typed by users,
// never HTML-encoded by mammoth, and are safe to use as sentinels.
const _CM_S = "\uE000"; // marker start
const _CM_C = "c";      // text-color type
const _CM_H = "h";      // highlight (background) type
const _CM_E = "\uE001"; // header end
const _CM_X = "\uE002"; // span close

// Word w:highlight name → 6-char uppercase hex (no #)
const _WORD_HIGHLIGHT_HEX = {
  yellow: "FFFF00",
  green: "00FF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  blue: "0000FF",
  red: "FF0000",
  darkblue: "000080",
  darkcyan: "008080",
  darkgreen: "008000",
  darkmagenta: "800080",
  darkred: "800000",
  darkyellow: "808000",
  darkgray: "808080",
  lightgray: "C0C0C0",
  black: "000000",
  white: "FFFFFF",
};

/**
 * Scan DOCX XML (word/document.xml) and, for every <w:r> run that carries
 * w:color or w:highlight, prepend PUA marker bytes to the run's <w:t> text.
 * mammoth passes <w:t> content through verbatim, so the markers reach the
 * HTML output where _colorMarkerToSpan() can wrap them in semantic tags.
 */
function _injectColorMarkersIntoXml(xml) {
  if (!/<w:color\b|<w:highlight\b/.test(xml)) return xml; // fast-exit

  return xml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (run) => {
    const markers = [];

    // Text color (w:color)
    const colorM = run.match(/<w:color\s+w:val="([^"]+)"/);
    if (colorM && colorM[1] !== "auto") {
      const hex = colorM[1].toUpperCase().padStart(6, "0");
      if (hex !== "000000") markers.push(`${_CM_S}${_CM_C}${hex}${_CM_E}`);
    }

    // Highlight / background color (w:highlight)
    const hlM = run.match(/<w:highlight\s+w:val="([^"]+)"/);
    if (hlM && hlM[1] !== "none") {
      const hex = _WORD_HIGHLIGHT_HEX[hlM[1].toLowerCase()];
      if (hex) markers.push(`${_CM_S}${_CM_H}${hex}${_CM_E}`);
    }

    if (markers.length === 0) return run;

    const prefix = markers.join("");
    const suffix = _CM_X;

    // Wrap each <w:t> text node with the markers
    return run.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_, open, text, close) => {
      if (!text) return `${open}${text}${close}`;
      return `${open}${prefix}${text}${suffix}${close}`;
    });
  });
}

/**
 * Convert PUA color markers (injected by _injectColorMarkersIntoXml) that
 * survived mammoth's HTML conversion into semantic tags that survive markdown
 * round-trips better than inline style attributes:
 *   text color    -> <font color="#RRGGBB">...</font>
 *   highlighting  -> <mark data-color="#RRGGBB">...</mark>
 */
function _colorMarkerToSpan(html) {
  if (!html.includes(_CM_S)) return html; // fast-exit when no markers present

  // Use string concatenation (not template literals) to build regex patterns —
  // template literals silently drop backslashes for unrecognised escape seqs,
  // which would corrupt character classes like [\s\S].
  // [^_CM_X]* matches everything up to the close marker without needing [\s\S].
  const mainRe = new RegExp(
    "(?:" + _CM_S + "[" + _CM_C + _CM_H + "][0-9A-Fa-f]{6}" + _CM_E + ")+" +
    "([^" + _CM_X + "]*)" +
    _CM_X,
    "g"
  );
  const hRe = new RegExp(
    _CM_S + "([" + _CM_C + _CM_H + "])([0-9A-Fa-f]{6})" + _CM_E,
    "g"
  );

  return html.replace(mainRe, (full, text) => {
    let colorHex = "";
    let highlightHex = "";
    hRe.lastIndex = 0;
    let m;
    while ((m = hRe.exec(full)) !== null) {
      if (m[1] === _CM_C) colorHex = m[2].toUpperCase();
      if (m[1] === _CM_H) highlightHex = m[2].toUpperCase();
    }
    if (!colorHex && !highlightHex) return text;

    let out = text;
    if (highlightHex) out = '<mark data-color="#' + highlightHex + '">' + out + "</mark>";
    if (colorHex) out = '<font color="#' + colorHex + '">' + out + "</font>";
    return out;
  });
}

/**
 * Pre-process a DOCX buffer to inject color/highlight markers into the XML
 * before mammoth converts it.  Returns the original buffer unchanged if the
 * document has no color/highlight data or if anything goes wrong.
 *
 * Call this before mammoth.convertToHtml() and pair with htmlToMarkdown() so
 * the markers are turned into <span style="..."> in the final markdown.
 */
export async function prepareDocxBuffer(buffer) {
  try {
    const JSZip = _cjsRequire("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const xmlFile = zip.file("word/document.xml");
    if (!xmlFile) return buffer;

    const xml = await xmlFile.async("string");
    const modified = _injectColorMarkersIntoXml(xml);
    if (modified === xml) return buffer; // nothing changed — skip re-pack

    zip.file("word/document.xml", modified);
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch {
    // Never break the upload if color injection fails — just omit colors
    return buffer;
  }
}

/**
 * Options to pass to mammoth.convertToHtml so that Word's underline
 * formatting is emitted as <u> tags (mammoth drops it by default).
 */
export const MAMMOTH_OPTIONS = {
  // mammoth's built-in underline identifier is "u" (not "r.underline").
  // Without this rule, mammoth silently drops underline formatting.
  //
  // mammoth's default style map only covers unordered/ordered list levels 1-5
  // (1-indexed). Word documents with deeper nesting fall through to <p> tags.
  // Extend to level 9 by following the same pattern: each extra level prepends
  // one more "ul|ol > li >" segment before the final "ul > li:fresh".
  styleMap: [
    "u => u",
    "p:unordered-list(6) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:unordered-list(7) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:unordered-list(8) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:unordered-list(9) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:ordered-list(6) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",
    "p:ordered-list(7) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",
    "p:ordered-list(8) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",
    "p:ordered-list(9) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",
  ],
};

function extractSupportedInlineStyles(attrText) {
  const styleMatch = String(attrText || "").match(/\bstyle\s*=\s*["']([^"']*)["']/i);
  if (!styleMatch) return "";

  let color = "";
  let backgroundColor = "";
  const declarations = styleMatch[1].split(";");
  for (const declaration of declarations) {
    const idx = declaration.indexOf(":");
    if (idx <= 0) continue;
    const key = declaration.slice(0, idx).trim().toLowerCase();
    const value = declaration.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "color") color = value;
    if (key === "background" || key === "background-color") backgroundColor = value;
  }

  const styles = [];
  if (color) styles.push(`color: ${color}`);
  if (backgroundColor) styles.push(`background-color: ${backgroundColor}`);
  return styles.join("; ");
}

function extractNamedAttr(attrText, attrName) {
  const escaped = String(attrName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("\\b" + escaped + "\\s*=\\s*[\"']([^\"']*)[\"']", "i");
  const match = String(attrText || "").match(re);
  return match ? match[1].trim() : "";
}

/**
 * Convert mammoth HTML → Markdown suitable for tiptap-markdown.
 * Handles: headings, bold, italic, strikethrough, inline code, hyperlinks,
 *          unordered/ordered lists (nested), blockquotes, horizontal rules.
 * Underline has no standard Markdown equivalent — the text is kept, tag dropped.
 */
export function htmlToMarkdown(html) {
  let md = html;

  // ── Convert any remaining <img> tags to markdown image syntax ────────────
  // When mammoth's convertImage callback is used, images are already replaced
  // with proper URL src values. This pass handles any residual <img> tags
  // (e.g. inline SVG fragments or fallback paths) so they are not silently lost.
  md = md.replace(/<img\s[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi, "\n\n![]($1)\n\n");

  // ── Convert PUA color/highlight markers → semantic tags ───────────────────
  // These markers were injected into word/document.xml by prepareDocxBuffer()
  // before mammoth ran, so they survive as literal characters in the HTML.
  // Must run before the generic span-style extraction below so the new spans
  // are treated as regular styled spans throughout the rest of the pipeline.
  md = _colorMarkerToSpan(md);

  // ── Keep only inline styles needed by the editor (text color + highlight) ─
  md = md.replace(/<sup\b[^>]*>/gi, "<sup>");
  md = md.replace(/<sub\b[^>]*>/gi, "<sub>");
  md = md.replace(/<span([^>]*)>([\s\S]*?)<\/span>/gi, (_, attrs, content) => {
    const style = extractSupportedInlineStyles(attrs);
    return style ? `<span style="${style}">${content}</span>` : `<span>${content}</span>`;
  });

  // ── Strip remaining element attributes (id, class, href, etc.) ───────────
  md = md.replace(/<([a-z][a-z0-9]*)(\s[^>]*)>/gi, (_, tag, attrs = "") => {
    const lower = String(tag || "").toLowerCase();
    if (lower === "span") {
      const style = extractSupportedInlineStyles(attrs);
      return style ? `<span style="${style}">` : "<span>";
    }
    if (lower === "font") {
      const color = extractNamedAttr(attrs, "color");
      return color ? `<font color="${color}">` : "<font>";
    }
    if (lower === "mark") {
      const dataColor = extractNamedAttr(attrs, "data-color");
      return dataColor ? `<mark data-color="${dataColor}">` : "<mark>";
    }
    return `<${lower}>`;
  });

  // ── Normalise whitespace inside inline tags ──────────────────────────────
  // Word often puts trailing (or leading) spaces inside formatting tags,
  // e.g. <strong>Expert Judgement </strong>.  Markdown requires markers to
  // be adjacent to non-space text, so we float that whitespace out of the
  // tag first.  A loop handles nested tags (inner → outer).
  const inlineTags = "strong|b|em|i|s|del|u";
  let wsPrev;
  do {
    wsPrev = md;
    md = md.replace(new RegExp(`<(${inlineTags})>(\\s+)`, "gi"), (_, t, ws) => ws + `<${t}>`);
    md = md.replace(new RegExp(`(\\s+)</(${inlineTags})>`, "gi"), (_, ws, t) => `</${t}>` + ws);
  } while (md !== wsPrev);

  // ── Inline formatting (process before block elements) ────────────────────
  // Helper: wrap content with markers, moving any leading/trailing whitespace
  // outside so markdown parsers recognise the emphasis (they require markers
  // to be adjacent to non-space text).
  const wrap = (content, marker) => {
    const m = content.match(/^(\s*)(.*?)(\s*)$/s);
    const inner = m[2];
    if (!inner) return content;            // all whitespace — skip markers
    return m[1] + marker + inner + marker + m[3];
  };

  // Bold — before italic so <strong><em>…</em></strong> → ***…***
  md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, (_, c) => wrap(c, "**"));
  md = md.replace(/<b>([\s\S]*?)<\/b>/gi, (_, c) => wrap(c, "**"));

  // Italic
  md = md.replace(/<em>([\s\S]*?)<\/em>/gi, (_, c) => wrap(c, "*"));
  md = md.replace(/<i>([\s\S]*?)<\/i>/gi, (_, c) => wrap(c, "*"));

  // Underline — serialized as <u> for tiptap-markdown (html: true) round-trip
  md = md.replace(/<u>([\s\S]*?)<\/u>/gi, "<u>$1</u>");

  // Strikethrough
  md = md.replace(/<s>([\s\S]*?)<\/s>/gi, (_, c) => wrap(c, "~~"));
  md = md.replace(/<del>([\s\S]*?)<\/del>/gi, (_, c) => wrap(c, "~~"));

  // Hyperlinks — keep display text only
  md = md.replace(/<a>([\s\S]*?)<\/a>/gi, "$1");

  // Inline code
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // ── Block elements ────────────────────────────────────────────────────────
  // Headings h1–h6
  for (let level = 1; level <= 6; level++) {
    const hashes = "#".repeat(level);
    md = md.replace(
      new RegExp(`<h${level}>([\\s\\S]*?)<\\/h${level}>`, "gi"),
      (_, c) => `${hashes} ${c.trim()}\n\n`
    );
  }

  // Lists — repeatedly unwrap the innermost list until none remain so that
  // nested lists get properly indented by the outer pass.
  //
  // mammoth emits nested <ul>/<ol> as SIBLINGS of <li>, not as children:
  //   <ul><li>A</li><ul><li>B</li></ul></ul>
  // rather than the standard:
  //   <ul><li>A<ul><li>B</li></ul></li></ul>
  //
  // So we capture each <li>…</li> AND any trailing text between it and the
  // next <li> (or end of the list). That trailing text is the already-expanded
  // sub-list, and we indent it as continuation of the current item.
  //
  // Tables inside lists: mammoth sometimes emits <table> as a sibling of <li>
  // inside a <ul>, or in the trailing content after </li>. We convert those
  // tables inline so their rows get indented as list-item continuation lines,
  // which markdown-it then renders as a table inside the list item.

  // Helper: convert raw <table>…</table> HTML content to GFM pipe-table rows.
  const tableHtmlToMdRows = (tableContent) => {
    const rows = [];
    const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableContent)) !== null) {
      const cells = [];
      const cellRe = /<t[dh]>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        const cellText = cellMatch[1]
          .replace(/<[^>]+>/g, " ").trim()
          .replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
        cells.push(cellText);
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return "";
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (row) => { while (row.length < cols) row.push(""); return row; };
    const header = pad(rows[0]);
    const sep = Array(cols).fill("---");
    const body = rows.slice(1).map(pad);
    const toRow = (cells) => "| " + cells.join(" | ") + " |";
    return [toRow(header), toRow(sep), ...body.map(toRow)].join("\n");
  };

  // Pre-convert tables that sit DIRECTLY inside a <ul>/<ol> as siblings of
  // <li> (not wrapped in their own <li>). This ensures the list converter sees
  // them as plain text trailing content and indents them accordingly.
  md = md.replace(
    /(<(?:ul|ol)>[\s\S]*?<\/(?:ul|ol)>)/gi,
    (list) => list.replace(/<table>([\s\S]*?)<\/table>/gi, (_, tc) => tableHtmlToMdRows(tc))
  );

  let prev;
  do {
    prev = md;

    // Innermost <ul>
    md = md.replace(
      /<ul>((?:(?!<(?:ul|ol)>)[\s\S])*?)<\/ul>/gi,
      (_, content) => {
        const lines = [];
        const itemRe = /<li>([\s\S]*?)<\/li>([\s\S]*?)(?=<li>|$)/gi;
        let m;
        while ((m = itemRe.exec(content)) !== null) {
          const liText   = m[1].trim();
          // Convert any <table> that appeared in trailing content (between </li> and next <li>)
          const rawTrailing = m[2].replace(/<table>([\s\S]*?)<\/table>/gi, (_, tc) => tableHtmlToMdRows(tc));
          const trailing = rawTrailing.trim();
          const combined = trailing ? `${liText}\n${trailing}` : liText;
          if (!combined) continue;
          const parts = combined.split("\n");
          const first = `- ${parts[0]}`;
          const rest  = parts.slice(1).filter((p) => p.trim()).map((p) => `  ${p}`);
          lines.push([first, ...rest].join("\n"));
        }
        // No <li> found but content has text = already-converted markdown from an
        // inner pass (happens when mammoth emits <ul><ul>...<li/></ul></ul> with
        // no direct <li> at outer levels after an image breaks the list context).
        // Pass it through so the enclosing list item can pick it up as trailing text.
        if (lines.length === 0) return content.trim() ? "\n" + content.trim() + "\n" : "";
        return "\n" + lines.join("\n") + "\n";
      }
    );

    // Innermost <ol>
    md = md.replace(
      /<ol>((?:(?!<(?:ul|ol)>)[\s\S])*?)<\/ol>/gi,
      (_, content) => {
        const lines = [];
        let counter = 1;
        const itemRe = /<li>([\s\S]*?)<\/li>([\s\S]*?)(?=<li>|$)/gi;
        let m;
        while ((m = itemRe.exec(content)) !== null) {
          const liText   = m[1].trim();
          const rawTrailing = m[2].replace(/<table>([\s\S]*?)<\/table>/gi, (_, tc) => tableHtmlToMdRows(tc));
          const trailing = rawTrailing.trim();
          const combined = trailing ? `${liText}\n${trailing}` : liText;
          if (!combined) continue;
          const n     = counter++;
          const parts = combined.split("\n");
          const first = `${n}. ${parts[0]}`;
          const rest  = parts.slice(1).filter((p) => p.trim()).map((p) => `   ${p}`);
          lines.push([first, ...rest].join("\n"));
        }
        if (lines.length === 0) return content.trim() ? "\n" + content.trim() + "\n" : "";
        return "\n" + lines.join("\n") + "\n";
      }
    );
  } while (md !== prev);

  // Blockquotes
  md = md.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_, c) =>
    c.trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n"
  );

  // Tables — convert any remaining standalone <table> tags (i.e. those NOT
  // inside a list, which were already handled by the list converter above).
  md = md.replace(/<table>([\s\S]*?)<\/table>/gi, (_, tc) =>
    "\n" + tableHtmlToMdRows(tc) + "\n\n"
  );

  // Paragraphs
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, (_, c) => {
    const trimmed = c.trim();
    return trimmed ? `${trimmed}\n\n` : "";
  });

  // Horizontal rule
  md = md.replace(/<hr\s*\/?>/gi, "---\n\n");

  // ── Strip remaining tags + decode entities ────────────────────────────────
  // Keep <u>, <sup>, <sub>, <font color>, <mark data-color>, and
  // <span style="..."> so formatting from uploads
  // can round-trip through markdown back into tiptap marks/textStyle attrs.
  md = md.replace(/<\/?([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi, (full, tag) => {
    const lower = String(tag || "").toLowerCase();
    const isClosing = /^<\//.test(full);
    if (lower === "u") return isClosing ? "</u>" : "<u>";
    if (lower === "sup") return isClosing ? "</sup>" : "<sup>";
    if (lower === "sub") return isClosing ? "</sub>" : "<sub>";
    if (lower === "font") {
      if (isClosing) return "</font>";
      const color = extractNamedAttr(full, "color");
      return color ? `<font color="${color}">` : "<font>";
    }
    if (lower === "mark") {
      if (isClosing) return "</mark>";
      const dataColor = extractNamedAttr(full, "data-color");
      return dataColor ? `<mark data-color="${dataColor}">` : "<mark>";
    }
    if (lower === "span") {
      if (isClosing) return "</span>";
      const style = extractSupportedInlineStyles(full);
      return style ? `<span style="${style}">` : "<span>";
    }
    return "";
  });
  md = md
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/(?:&#39;|&apos;)/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");

  // Normalise whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

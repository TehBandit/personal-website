/**
 * _docx-md.js  (internal utility — not an API endpoint)
 * Shared helper for converting mammoth HTML output to Markdown.
 * Used by docx-to-md.js (FilesEditor import) and story-extract.js (upload flow).
 */

/**
 * Options to pass to mammoth.convertToHtml so that Word's underline
 * formatting is emitted as <u> tags (mammoth drops it by default).
 */
export const MAMMOTH_OPTIONS = {
  // mammoth's built-in underline identifier is "u" (not "r.underline").
  // Without this rule, mammoth silently drops underline formatting.
  styleMap: ["u => u"],
};

/**
 * Convert mammoth HTML → Markdown suitable for tiptap-markdown.
 * Handles: headings, bold, italic, strikethrough, inline code, hyperlinks,
 *          unordered/ordered lists (nested), blockquotes, horizontal rules.
 * Underline has no standard Markdown equivalent — the text is kept, tag dropped.
 */
export function htmlToMarkdown(html) {
  let md = html;

  // ── Strip element attributes (id, style, href, etc.) ─────────────────────
  md = md.replace(/<([a-z][a-z0-9]*)(\s[^>]*)>/gi, "<$1>");

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
  md = md.replace(/<u>([\.\s\S]*?)<\/u>/gi, "<u>$1</u>");

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
  let prev;
  do {
    prev = md;

    // Innermost <ul>
    md = md.replace(
      /<ul>((?:(?!<(?:ul|ol)>)[\s\S])*?)<\/ul>/gi,
      (_, content) => {
        const lines = [];
        content.replace(/<li>([\s\S]*?)<\/li>/gi, (__, c) => {
          const parts = c.trim().split("\n");
          const first = `- ${parts[0]}`;
          const rest = parts.slice(1).filter((p) => p.trim()).map((p) => `  ${p}`);
          lines.push([first, ...rest].join("\n"));
        });
        return "\n" + lines.join("\n") + "\n";
      }
    );

    // Innermost <ol>
    let counter = 1;
    md = md.replace(
      /<ol>((?:(?!<(?:ul|ol)>)[\s\S])*?)<\/ol>/gi,
      (_, content) => {
        const lines = [];
        counter = 1;
        content.replace(/<li>([\s\S]*?)<\/li>/gi, (__, c) => {
          const n = counter++;
          const parts = c.trim().split("\n");
          const first = `${n}. ${parts[0]}`;
          const rest = parts.slice(1).filter((p) => p.trim()).map((p) => `   ${p}`);
          lines.push([first, ...rest].join("\n"));
        });
        return "\n" + lines.join("\n") + "\n";
      }
    );
  } while (md !== prev);

  // Blockquotes
  md = md.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_, c) =>
    c.trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n"
  );

  // Paragraphs
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, (_, c) => {
    const trimmed = c.trim();
    return trimmed ? `${trimmed}\n\n` : "";
  });

  // Horizontal rule
  md = md.replace(/<hr\s*\/?>/gi, "---\n\n");

  // ── Strip remaining tags + decode entities ────────────────────────────────
  // Exclude <u> and </u> from stripping — they are intentionally preserved above
  // and must survive to disk so tiptap-markdown can parse them as underline marks.
  md = md.replace(/<(?!\/?u>)[^>]+>/g, "");
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

export const JOURNAL_FILE_PATH = "journal/journal.md";
export const JOURNAL_LEGACY_FILE_PATH = JOURNAL_FILE_PATH;
export const JOURNAL_ENTRY_DIR = "journal";
export const JOURNAL_WORKSPACE_SLUG = "journal-hidden-workspace";
export const JOURNAL_WORKSPACE_NAME = "Journal Hidden Workspace";

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function formatJournalDateKey(dateInput = new Date()) {
  const date = new Date(dateInput);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatJournalHeadingDate(dateInput = new Date()) {
  return new Date(dateInput).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function buildJournalEntryHeadingLine(dateKey) {
  return `# ${buildJournalEntryTitle(dateKey)}`;
}

export function buildJournalEntryTitle(dateKey) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? String(dateKey) : formatJournalDateKey();
  const [year, month, day] = safeDate.split("-").map((part) => Number.parseInt(part, 10));
  const dt = new Date(year, month - 1, day);
  return `Journal Entry - ${formatJournalHeadingDate(dt)}`;
}

export function extractDateFromJournalFilename(filename) {
  const text = String(filename || "");
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function buildJournalEntryFilename(dateKey, existingFilenames = []) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? String(dateKey) : formatJournalDateKey();
  const taken = new Set(Array.from(existingFilenames || []).map((value) => String(value)));

  const base = `${JOURNAL_ENTRY_DIR}/journal-entry-${safeDate}.md`;
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${JOURNAL_ENTRY_DIR}/journal-entry-${safeDate}-${n}.md`)) n += 1;
  return `${JOURNAL_ENTRY_DIR}/journal-entry-${safeDate}-${n}.md`;
}

export function parseJournalEntryFileContent(content, fallbackDateKey = null, filename = "") {
  const text = String(content || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const headingDateMatch = text.match(/^#{1,6}\s+(?:Journal Entry\s*-\s*)?(\d{4}-\d{2}-\d{2})\s*$/im);
  const filenameDate = extractDateFromJournalFilename(filename);
  const safeDate = headingDateMatch?.[1] || filenameDate || fallbackDateKey || formatJournalDateKey();

  const title = buildJournalEntryTitle(safeDate);

  // Keep content intact except stripping legacy metadata formats.
  let bodyLines = [...lines];
  bodyLines = bodyLines.filter((line) => !/^\s*title\s*:/i.test(String(line || "").trim()));
  bodyLines = bodyLines.filter((line) => !/^#{1,6}\s+Journal Entry\s*-\s*/i.test(String(line || "").trim()));
  const body = bodyLines.join("\n").replace(/^\n+|\n+$/g, "");

  return { date: safeDate, title, content: body };
}

export function serializeJournalEntryFileContent(dateKey, body = "", title = "") {
  const normalizedBody = String(body || "").replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  void title;
  return `${normalizedBody}\n`;
}

export function parseJournalEntries(markdown) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const entries = [];

  let current = null;
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const headingMatch = line.match(/^##\s+(?:Journal Entry\s*-\s*)?(\d{4}-\d{2}-\d{2})\s*$/i);
    if (headingMatch) {
      if (current) {
        current.content = current.content.replace(/^\n+|\n+$/g, "");
        entries.push(current);
      }
      current = { date: headingMatch[1], content: "" };
      continue;
    }

    if (!current) continue;
    current.content += `${line}\n`;
  }

  if (current) {
    current.content = current.content.replace(/^\n+|\n+$/g, "");
    entries.push(current);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

export function serializeJournalEntries(entries) {
  const safeEntries = Array.isArray(entries)
    ? entries
        .filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")))
        .map((entry) => ({
          date: String(entry.date),
          content: String(entry.content || "").replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, ""),
        }))
    : [];

  safeEntries.sort((a, b) => b.date.localeCompare(a.date));

  if (safeEntries.length === 0) {
    return "# Journal\n\n";
  }

  const chunks = ["# Journal", ""];
  for (const entry of safeEntries) {
    chunks.push(`## Journal Entry - ${entry.date}`);
    chunks.push(entry.content || "");
    chunks.push("");
  }

  return `${chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function upsertJournalEntry(markdown, dateKey, content) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? String(dateKey) : formatJournalDateKey();
  const entries = parseJournalEntries(markdown);
  const nextContent = String(content || "").replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  const existingIndex = entries.findIndex((entry) => entry.date === safeDate);

  if (existingIndex >= 0) entries[existingIndex] = { date: safeDate, content: nextContent };
  else entries.push({ date: safeDate, content: nextContent });

  return serializeJournalEntries(entries);
}

export function getJournalEntryByDate(markdown, dateKey) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? String(dateKey) : formatJournalDateKey();
  const entries = parseJournalEntries(markdown);
  return entries.find((entry) => entry.date === safeDate) || null;
}

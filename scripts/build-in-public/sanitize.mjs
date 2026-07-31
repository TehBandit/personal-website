import path from "node:path";

const excludedExactNames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
]);

const excludedExtensions = new Set([
  ".7z", ".avi", ".bin", ".cer", ".crt", ".der", ".dll", ".doc",
  ".docx", ".dylib", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg",
  ".jpg", ".key", ".lock", ".map", ".mov", ".mp3", ".mp4", ".pdf",
  ".pem", ".pfx", ".png", ".so", ".svg", ".tar", ".webp", ".woff",
  ".woff2", ".xls", ".xlsx", ".zip",
]);

const excludedPathParts = new Set([
  ".git", ".next", ".vercel", "build", "coverage", "dist", "generated",
  "node_modules", "vendor",
]);

export function shouldExcludePath(filePath) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  const baseName = parts.at(-1) ?? "";
  const extension = path.extname(baseName);

  if (!normalized) return true;
  if (excludedExactNames.has(baseName) || excludedExtensions.has(extension)) return true;
  if (parts.some((part) => excludedPathParts.has(part))) return true;
  if (/^\.env(?:\.|$)/.test(baseName)) return true;
  if (/(?:credential|credentials|secret|secrets|private[-_]?key|service[-_]?account)/.test(normalized)) return true;
  return false;
}

function redactHighEntropyTokens(value) {
  return value.replace(/\b[A-Za-z0-9_+\/=.-]{28,}\b/g, (token) => {
    const hasMixedClasses = /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
    const counts = new Map();
    for (const character of token) counts.set(character, (counts.get(character) ?? 0) + 1);
    const entropy = [...counts.values()].reduce((total, count) => {
      const probability = count / token.length;
      return total - probability * Math.log2(probability);
    }, 0);
    return hasMixedClasses || entropy >= 3.8 ? "[redacted-token]" : token;
  });
}

export function sanitizeText(input, { maximumCharacters = 4000 } = {}) {
  let value = String(input ?? "");
  value = value
    .replace(/^@@.*@@.*$/gm, "")
    .replace(/^(?:diff --git|index |--- |\+\+\+ ).*$/gm, "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|app|dev|test|internal|local|lan|corp)\b/gi, "[hostname]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip-address]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[identifier]")
    .replace(/\b[0-9a-f]{16,64}\b/gi, "[identifier]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_]{20,})\b/g, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(?:from|join|table|update|into)\s+[\w.[\]`"-]+/gi, (match) => `${match.split(/\s+/)[0]} [database-object]`)
    .replace(/(?:[A-Za-z]:\\|\.{1,2}[\\/]|\/)(?:[\w.@ -]+[\\/])+[\w.@ -]+/g, "[path]")
    .replace(/(^|[\s('"`])(?:[\w.@-]+[\\/])+[\w.@-]+(?:\.[A-Za-z0-9]+)?/gm, "$1[path]")
    .replace(/\b[\w.-]+\.(?:js|jsx|ts|tsx|py|rb|go|rs|java|css|scss|json|ya?ml|toml|sql|env)\b/gi, "[file]")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  value = redactHighEntropyTokens(value);
  return value.slice(0, maximumCharacters);
}

export function categorizeFile(filePath) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/").toLowerCase();
  const extension = path.extname(normalized);
  if (/test|spec|__tests__/.test(normalized)) return "tests";
  if (/\.github\/workflows/.test(normalized)) return "automation";
  if (/readme|docs?\//.test(normalized) || [".md", ".mdx"].includes(extension)) return "documentation";
  if (/api|server|backend|functions/.test(normalized)) return "backend";
  if (/component|page|screen|view|frontend|src/.test(normalized)) return "interface";
  if (/config|\.json$|\.ya?ml$|\.toml$/.test(normalized)) return "configuration";
  if ([".css", ".scss", ".sass", ".less"].includes(extension)) return "styling";
  return "application";
}

export function containsSensitivePattern(value) {
  const text = String(value ?? "");
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bre_[A-Za-z0-9_]{20,}\b/,
    /\b(?:api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]{8,}/i,
  ].some((pattern) => pattern.test(text));
}

export function sourceTokenWindows(text, size = 8) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .match(/[a-z0-9']+/g) ?? [];
  const windows = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    windows.add(tokens.slice(index, index + size).join(" "));
  }
  return windows;
}

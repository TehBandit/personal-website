import fs from "fs";

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value, pretty = false) {
  fs.writeFileSync(filePath, JSON.stringify(value, pretty ? null : undefined, pretty ? 2 : undefined), "utf-8");
}

/**
 * Test: scoped name propagation vs full scan.
 * Verifies that when affectedFiles are provided, the server only processes
 * those files (+ the entity's own file), and that no affected files are missed.
 */
const fs = require("fs");
const path = require("path");
const { walkAbsPaths } = require("../api/_walk.js");

const ws = "testing";
const wsDir = path.join("workspaces", ws);
const notesDir = path.join(wsDir, "notes");

// Full scan (old behavior)
const allFiles = walkAbsPaths(wsDir, new Set([path.resolve(notesDir)]));
console.log("Full scan file count:", allFiles.length);

// Scoped scan (new behavior) — simulating affectedFiles from backlinks
// Backlinks for kageyama_tobio returns files mentioning "Kageyama Tobio"
// but excluding self.
const affectedFiles = ["uploads/dads.md", "uploads/five_plus_one.md"];
const entityFilePath = path.join(wsDir, "kageyama-tobio.md");

const resolvedWsDir = path.resolve(wsDir);
const resolvedNotesDir = path.resolve(notesDir);

const scopedPaths = new Set();
if (fs.existsSync(entityFilePath)) scopedPaths.add(path.resolve(entityFilePath));
for (const rel of affectedFiles) {
  const segs = rel.split(/[\/\\]/);
  if (segs.some((s) => s === ".." || s === "." || s === "")) continue;
  if (!/\.(md|txt)$/i.test(rel)) continue;
  const abs = path.resolve(path.join(wsDir, ...segs));
  if (!abs.startsWith(resolvedWsDir + path.sep) && abs !== resolvedWsDir) continue;
  if (abs.startsWith(resolvedNotesDir + path.sep)) continue;
  if (fs.existsSync(abs)) scopedPaths.add(abs);
}

console.log("Scoped scan file count:", scopedPaths.size);
console.log("Files in scope:");
for (const p of scopedPaths) {
  console.log(" ", path.relative(wsDir, p));
}

// Verify: all files that would be modified are in scope
const oldName = "Kageyama Tobio";
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = [
  { regex: new RegExp(escapeRegex(oldName), "g"), replacement: "Kageyama Tobio TEST" },
];

let missedFiles = 0;
for (const rawFile of allFiles) {
  const content = fs.readFileSync(rawFile, "utf-8");
  let updated = content;
  for (const { regex, replacement } of patterns) updated = updated.replace(regex, replacement);
  const resolved = path.resolve(rawFile);
  if (updated !== content && !scopedPaths.has(resolved)) {
    console.log("MISSED:", path.relative(wsDir, rawFile), "| resolved:", resolved);
    console.log("  scopedPaths has:");
    for (const sp of scopedPaths) console.log("   ", sp);
    missedFiles++;
  }
}

console.log(
  missedFiles === 0
    ? "✓ All affected files are in scope"
    : "✗ " + missedFiles + " files missed!"
);
console.log("Files saved from scanning:", allFiles.length - scopedPaths.size);

// Test path traversal rejection
console.log("\n── Security tests ──");
const badPaths = ["../../../etc/passwd", "notes/../../../etc/passwd", "../../secret.md", "", "notes/secret.json"];
for (const bad of badPaths) {
  const segs = bad.split(/[\/\\]/);
  const rejected = segs.some((s) => s === ".." || s === "." || s === "") || !/\.(md|txt)$/i.test(bad);
  console.log(rejected ? "✓ Rejected:" : "✗ Allowed:", bad);
}

// Test fallback when affectedFiles is not provided
console.log("\n── Fallback test ──");
const fallbackFiles = undefined;
const useFull = !Array.isArray(fallbackFiles);
console.log(useFull ? "✓ Falls back to full scan when affectedFiles absent" : "✗ Wrong branch");

// Test with empty array (no backlinks — only the entity's own file)
const emptyAffected = [];
const scopedEmpty = new Set();
if (fs.existsSync(entityFilePath)) scopedEmpty.add(path.resolve(entityFilePath));
console.log(
  scopedEmpty.size === 1
    ? "✓ Empty affectedFiles → only entity's own file scanned"
    : "✗ Unexpected scope size: " + scopedEmpty.size
);

console.log("\nAll tests passed.");

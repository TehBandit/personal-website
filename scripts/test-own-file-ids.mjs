// Test script — validates computeOwnFileIds against real workspace data.
// Run: node scripts/test-own-file-ids.mjs
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { computeOwnFileIds } from "../src/utils/graphHelpers.js";

const WS = new URL("../workspaces/veldmoor-chronicles", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const notesDir = join(WS, "notes");

// Build file list (mirrors notes-raw-list: walk workspace, return relative paths, skip notes/ dir)
function walk(dir, base = dir, skipDir = join(WS, "notes")) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (full === skipDir) continue;
    if (e.isDirectory()) { out.push(...walk(full, base, skipDir)); }
    else if (/\.(md|txt)$/i.test(e.name)) {
      out.push({ filename: full.slice(base.length + 1).replace(/\\/g, "/") });
    }
  }
  return out;
}
const files = walk(WS);

// Load nodes from notes/ dir
const nodes = readdirSync(notesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => { try { return JSON.parse(readFileSync(join(notesDir, f), "utf-8")); } catch { return null; } })
  .filter(Boolean);

const ownIds = computeOwnFileIds(nodes, files);

// ── Report ────────────────────────────────────────────────────────────────────
let pass = true;

// Nodes that should be GREY (no dedicated file)
const expectGrey = ["sunken_ledger"];
// Nodes that should be COLORED (have a dedicated raw file)
const expectColored = ["fen_caldra", "orris_vane", "maren_ashveil", "sable_voss", "dellan_moor"];

console.log("=== Assertion checks ===");
for (const id of expectGrey) {
  const owned = ownIds.has(id);
  const ok = !owned;
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} should be GREY   → ${owned ? "COLORED (wrong)" : "grey (correct)"}`);
  if (!ok) pass = false;
}
for (const id of expectColored) {
  const owned = ownIds.has(id);
  const ok = owned;
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} should be COLORED → ${owned ? "colored (correct)" : "GREY (wrong)"}`);
  if (!ok) pass = false;
}

console.log("\n=== All COLORED nodes ===");
for (const n of nodes.filter((n) => ownIds.has(n.id))) {
  console.log(`  colored | ${n.id.padEnd(40)} | sourceFile: ${n.sourceFile || "(none)"}`);
}

console.log("\n=== All GREY nodes ===");
for (const n of nodes.filter((n) => !ownIds.has(n.id))) {
  console.log(`  grey    | ${n.id.padEnd(40)} | sourceFile: ${n.sourceFile || "(none)"}`);
}

console.log(`\n${pass ? "ALL ASSERTIONS PASSED" : "SOME ASSERTIONS FAILED"}`);
process.exit(pass ? 0 : 1);

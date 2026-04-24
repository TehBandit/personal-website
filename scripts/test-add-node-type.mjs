/**
 * Regression test: adding a new node type to a legacy workspace (one that has
 * no nodeTypes field in workspace.json) must preserve the default narrative
 * types — it must NOT replace nodeTypes with only the new type.
 *
 * Run: node scripts/test-add-node-type.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACES_DIR = path.join(__dirname, "../workspaces");
const TEST_WS = "test-add-type-regression";
const wsDir = path.join(WORKSPACES_DIR, TEST_WS);

// ── Helpers ────────────────────────────────────────────────────────────────
function assert(condition, msg) {
  if (!condition) { console.error("FAIL:", msg); process.exit(1); }
  console.log("PASS:", msg);
}

function cleanup() {
  if (fs.existsSync(wsDir)) fs.rmSync(wsDir, { recursive: true, force: true });
}

// ── Import the handler under test ──────────────────────────────────────────
// Simulate a minimal req/res so we can call the handler directly.
function makeFakeRes() {
  const res = {
    _status: null, _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; return this; },
    setHeader()  { return this; },
  };
  return res;
}

// ── Test setup ─────────────────────────────────────────────────────────────
cleanup();
fs.mkdirSync(wsDir, { recursive: true });

// Write a LEGACY workspace.json — no nodeTypes field, just like veldmoor-chronicles was.
const legacyMeta = { name: "Test Legacy Workspace", slug: TEST_WS };
fs.writeFileSync(path.join(wsDir, "workspace.json"), JSON.stringify(legacyMeta, null, 2));

// ── Import handler ─────────────────────────────────────────────────────────
const { default: handler } = await import("../api/workspaces.js?" + Date.now());

// ── Test 1: Adding a type to a legacy workspace seeds the defaults first ──
{
  const req = {
    method: "PATCH",
    query: { slug: TEST_WS },
    body: { addType: { key: "the_creepler", color: "#f472b6", label: "The Creepler" } },
  };
  const res = makeFakeRes();
  handler(req, res);

  assert(res._status === 200, "PATCH returns 200");
  const nodeTypes = res._body?.nodeTypes;
  assert(nodeTypes, "Response includes nodeTypes");

  // The narrative defaults must be present
  assert(nodeTypes.character, "character type is preserved");
  assert(nodeTypes.location,  "location type is preserved");
  assert(nodeTypes.faction,   "faction type is preserved");
  assert(nodeTypes.artifact,  "artifact type is preserved");

  // The new type must also be present
  assert(nodeTypes.the_creepler, "new type the_creepler is added");
  assert(nodeTypes.the_creepler.color === "#f472b6", "new type has correct color");

  // Must have exactly 5 types (4 narrative + 1 new)
  assert(Object.keys(nodeTypes).length === 5, `nodeTypes has exactly 5 entries (got ${Object.keys(nodeTypes).length})`);

  // workspace.json must also be updated correctly
  const saved = JSON.parse(fs.readFileSync(path.join(wsDir, "workspace.json"), "utf-8"));
  assert(saved.nodeTypes.character, "workspace.json character preserved on disk");
  assert(saved.nodeTypes.the_creepler, "workspace.json the_creepler written to disk");
}

// ── Test 2: Adding another type to an already-populated workspace preserves all existing ──
{
  const req = {
    method: "PATCH",
    query: { slug: TEST_WS },
    body: { addType: { key: "creature", color: "#facc15", label: "Creature" } },
  };
  const res = makeFakeRes();
  handler(req, res);

  assert(res._status === 200, "Second PATCH returns 200");
  const nodeTypes = res._body?.nodeTypes;
  assert(Object.keys(nodeTypes).length === 6, `After second add: 6 types (got ${Object.keys(nodeTypes).length})`);
  assert(nodeTypes.the_creepler, "the_creepler still present after second add");
  assert(nodeTypes.creature, "creature added successfully");
  assert(nodeTypes.character, "character still present after second add");
}

// ── Test 3: Duplicate key returns 409 ──────────────────────────────────────
{
  const req = {
    method: "PATCH",
    query: { slug: TEST_WS },
    body: { addType: { key: "creature", color: "#fff", label: "Creature" } },
  };
  const res = makeFakeRes();
  handler(req, res);
  assert(res._status === 409, "Duplicate type key returns 409");
}

// ── Cleanup ────────────────────────────────────────────────────────────────
cleanup();
console.log("\nAll tests passed.");

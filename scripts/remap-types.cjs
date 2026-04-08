const fs = require("fs");
const path = require("path");

const workspace = process.argv[2];
if (!workspace) {
  console.error("Usage: node scripts/remap-types.js <workspace-slug>");
  process.exit(1);
}

const wsDir = path.join(__dirname, "..", "workspaces", workspace);
const readJSON = (fp) => {
  let raw = fs.readFileSync(fp, "utf-8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
  return JSON.parse(raw);
};
const wsMeta = readJSON(path.join(wsDir, "workspace.json"));
const validTypes = new Set(Object.keys(wsMeta.nodeTypes || {}));
const defaultType = Object.keys(wsMeta.nodeTypes || {})[0] || "entity";

// Map old narrative types → reasonable universal equivalents
const NARRATIVE_TO_UNIVERSAL = {
  character: "entity",
  location: "entity",
  faction: "entity",
  artifact: "document",
  event: "event",
  // notes preset
  topic: "entity",
  source: "document",
  person: "entity",
  concept: "idea",
  // journaling preset
  entry: "document",
  place: "entity",
  reflection: "idea",
};

const notesDir = path.join(wsDir, "notes");
if (!fs.existsSync(notesDir)) {
  console.log("No notes directory found.");
  process.exit(0);
}

const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".json"));
let remapped = 0;
let skipped = 0;

for (const file of files) {
  const fp = path.join(notesDir, file);
  const data = readJSON(fp);
  const oldType = data.type;

  // Remap if the current type isn't valid for this workspace
  if (!validTypes.has(oldType)) {
    const newType = NARRATIVE_TO_UNIVERSAL[oldType] && validTypes.has(NARRATIVE_TO_UNIVERSAL[oldType])
      ? NARRATIVE_TO_UNIVERSAL[oldType]
      : defaultType;
    data.type = newType;
    remapped++;
    console.log(`Remapped ${file}: ${oldType} → ${newType}`);
  } else {
    skipped++;
    console.log(`OK       ${file}: ${oldType}`);
  }

  // Always rewrite without BOM (PowerShell Out-File adds UTF-8 BOM)
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

// Clear the graph cache so it rebuilds fresh
const cacheFile = path.join(wsDir, "graph-cache.json");
if (fs.existsSync(cacheFile)) {
  fs.unlinkSync(cacheFile);
  console.log("\nCleared graph-cache.json");
}

console.log(`\nDone: ${remapped} remapped, ${skipped} already valid`);

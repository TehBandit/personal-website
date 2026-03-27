// Patches bare sourceFile paths (e.g. "the_inkhand.md") on existing nodes
// to their correct workspace-relative path ("uploads/the_inkhand.md").
// Only patches nodes where the bare filename matches an actual file in uploads/.
import fs from 'fs';
import path from 'path';
import { rebuildGraphCache, bumpWorkspaceVersion } from '../api/bump-version.js';

const WORKSPACES_DIR = path.join(process.cwd(), 'workspaces');

for (const ws of fs.readdirSync(WORKSPACES_DIR)) {
  const wsDir = path.join(WORKSPACES_DIR, ws);
  const notesDir = path.join(wsDir, 'notes');
  const uploadsDir = path.join(wsDir, 'uploads');
  if (!fs.existsSync(notesDir)) continue;

  const uploadedFiles = fs.existsSync(uploadsDir)
    ? new Set(fs.readdirSync(uploadsDir))
    : new Set();

  let patched = 0;
  for (const file of fs.readdirSync(notesDir).filter(f => f.endsWith('.json'))) {
    const filePath = path.join(notesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const sf = data.sourceFile || '';
    // Only fix bare basenames (no slash) that correspond to an uploads file
    if (!sf || sf.includes('/') || !uploadedFiles.has(sf)) continue;
    data.sourceFile = `uploads/${sf}`;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  patched ${file}: "${sf}" → "uploads/${sf}"`);
    patched++;
  }

  if (patched > 0) {
    rebuildGraphCache(ws, notesDir);
    bumpWorkspaceVersion(ws);
    console.log(`${ws}: patched ${patched} node(s), cache rebuilt.`);
  } else {
    console.log(`${ws}: nothing to patch.`);
  }
}

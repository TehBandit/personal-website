import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

const { resolveNodeSourceText } = await import("../api/workspace-embed.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "embed-sourcefile-test-"));
const wsDir = path.join(tempRoot, "workspace");
const rawDir = path.join(wsDir, "notes-raw");
const subDir = path.join(wsDir, "folder");

fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(subDir, { recursive: true });

try {
  // Case 1: Workspace-root relative sourceFile should resolve first.
  const wsFile = path.join(subDir, "root-path.md");
  fs.writeFileSync(wsFile, "# Title\n\nFrom workspace root", "utf-8");
  {
    const node = { id: "n1", name: "Node One", sourceFile: "folder/root-path.md" };
    const result = resolveNodeSourceText(node, wsDir, rawDir);
    assert.equal(result.text.includes("From workspace root"), true, "Should load sourceFile from workspace root");
    assert.equal(result.diagnostic, null, "Should not emit diagnostic when file exists");
  }

  // Case 2: Legacy notes-raw fallback should still work.
  const legacyFile = path.join(rawDir, "legacy.md");
  fs.writeFileSync(legacyFile, "Legacy location", "utf-8");
  {
    const node = { id: "n2", name: "Node Two", sourceFile: "legacy.md" };
    const result = resolveNodeSourceText(node, wsDir, rawDir);
    assert.equal(result.text.includes("Legacy location"), true, "Should fallback to notes-raw for legacy path");
    assert.equal(result.diagnostic, null, "Should not emit diagnostic when legacy file exists");
  }

  // Case 3: Missing source file should return diagnostics with candidates.
  {
    const node = { id: "n3", name: "Node Three", sourceFile: "missing/file.md" };
    const result = resolveNodeSourceText(node, wsDir, rawDir);
    assert.equal(result.text, "", "Missing file should return empty text");
    assert.ok(result.diagnostic, "Missing file should return diagnostic payload");
    assert.equal(result.diagnostic.nodeId, "n3", "Diagnostic should include node id");
    assert.equal(result.diagnostic.sourceFile, "missing/file.md", "Diagnostic should include sourceFile");
    assert.ok(Array.isArray(result.diagnostic.candidates), "Diagnostic should include candidate list");
    assert.ok(result.diagnostic.candidates.length >= 2, "Diagnostic should include workspace and fallback candidates");
  }

  console.log("PASS: workspace-embed sourceFile resolution tests");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

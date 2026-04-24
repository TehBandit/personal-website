import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  rebuildBacklinksIndex,
  updateBacklinksIndexForFiles,
  getBacklinksForNode,
} from "../api/_backlinks-index.js";

const workspace = "test-backlinks-index";
const wsDir = path.join(process.cwd(), "workspaces", workspace);
const notesDir = path.join(wsDir, "notes");

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function cleanup() {
  fs.rmSync(wsDir, { recursive: true, force: true });
}

cleanup();
fs.mkdirSync(notesDir, { recursive: true });

try {
  // Seed node metadata for greedy matcher candidates.
  writeJson(path.join(notesDir, "alice.json"), {
    id: "alice",
    name: "Alice",
    aliases: ["A. Liddell"],
  });
  writeJson(path.join(notesDir, "bob.json"), {
    id: "bob",
    name: "Bob",
    aliases: [],
  });

  // Seed raw files.
  fs.writeFileSync(path.join(wsDir, "one.md"), "Alice met Bob in the hall.", "utf-8");
  fs.mkdirSync(path.join(wsDir, "folder"), { recursive: true });
  fs.writeFileSync(path.join(wsDir, "folder", "two.md"), "Bob spoke quietly.", "utf-8");

  // Initial full build.
  rebuildBacklinksIndex(workspace);
  {
    const aliceBacklinks = getBacklinksForNode(workspace, "alice");
    assert.deepEqual(aliceBacklinks, ["one.md"], "Initial build should include one.md for alice");
  }

  // Incremental upsert after save.
  fs.writeFileSync(path.join(wsDir, "folder", "two.md"), "Bob spoke quietly about Alice.", "utf-8");
  updateBacklinksIndexForFiles(workspace, { upsertFiles: ["folder/two.md"] });
  {
    const aliceBacklinks = getBacklinksForNode(workspace, "alice");
    assert.deepEqual(aliceBacklinks, ["folder/two.md", "one.md"], "Upsert should add folder/two.md to alice backlinks");
  }

  // Incremental move/rename behavior (remove old + upsert new).
  fs.renameSync(path.join(wsDir, "one.md"), path.join(wsDir, "folder", "one-renamed.md"));
  updateBacklinksIndexForFiles(workspace, {
    removedFiles: ["one.md"],
    upsertFiles: ["folder/one-renamed.md"],
  });
  {
    const aliceBacklinks = getBacklinksForNode(workspace, "alice");
    assert.deepEqual(
      aliceBacklinks,
      ["folder/one-renamed.md", "folder/two.md"],
      "Move update should swap one.md for folder/one-renamed.md"
    );
  }

  // Incremental delete behavior.
  fs.unlinkSync(path.join(wsDir, "folder", "two.md"));
  updateBacklinksIndexForFiles(workspace, { removedFiles: ["folder/two.md"] });
  {
    const aliceBacklinks = getBacklinksForNode(workspace, "alice");
    assert.deepEqual(aliceBacklinks, ["folder/one-renamed.md"], "Delete update should remove folder/two.md backlink");
  }

  // Lazy validation fallback: mutate file without index update; query should rebuild.
  fs.writeFileSync(path.join(wsDir, "fresh.md"), "A. Liddell appears again.", "utf-8");
  {
    const aliceBacklinks = getBacklinksForNode(workspace, "alice");
    assert.deepEqual(
      aliceBacklinks,
      ["folder/one-renamed.md", "fresh.md"],
      "Lazy validation should rebuild stale index and include fresh.md"
    );
  }

  console.log("PASS: backlinks index incremental update + lazy fallback tests");
} finally {
  cleanup();
}

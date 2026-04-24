import assert from "node:assert/strict";
import {
  buildWordBoundaryPattern,
  collectGreedyMatches,
  extractTitleFromContent,
} from "../shared/story-rules.js";
import { extractTitleFromContent as extractTitleFromWalk } from "../api/_walk.js";
import { extractTitleFromContent as extractTitleFromGraphHelpers } from "../src/utils/graphHelpers.js";

// Case 1: longest phrase should claim the overlap first.
{
  const candidates = [
    {
      nodeId: "management_history",
      term: "management history",
      patternSource: buildWordBoundaryPattern("management history"),
    },
    {
      nodeId: "management",
      term: "management",
      patternSource: buildWordBoundaryPattern("management"),
    },
  ];

  const matches = collectGreedyMatches("management history", candidates);
  assert.equal(matches.length, 1, "Only one non-overlapping match is expected");
  assert.equal(matches[0].item.nodeId, "management_history", "Longer phrase should win");
}

// Case 2: shorter term can still match elsewhere outside the claimed span.
{
  const candidates = [
    {
      nodeId: "management_history",
      term: "management history",
      patternSource: buildWordBoundaryPattern("management history"),
    },
    {
      nodeId: "management",
      term: "management",
      patternSource: buildWordBoundaryPattern("management"),
    },
  ];

  const text = "management history appears first, then management appears later";
  const matches = collectGreedyMatches(text, candidates);
  const mentionedIds = matches.map((m) => m.item.nodeId);

  assert.equal(mentionedIds.includes("management_history"), true, "Longer phrase should match");
  assert.equal(mentionedIds.includes("management"), true, "Standalone shorter phrase should still match");
}

// Case 3: title extraction parity across shared/server/client exports.
{
  const samples = [
    "# Chapter One\n\nBody text.",
    "**Maren Ashveil**\n\nEntered the room.",
    "This is a sentence.\n\nNot a title pattern.",
    "",
    null,
  ];

  for (const sample of samples) {
    const shared = extractTitleFromContent(sample);
    const server = extractTitleFromWalk(sample);
    const client = extractTitleFromGraphHelpers(sample);
    assert.equal(server, shared, "Server export should match shared logic");
    assert.equal(client, shared, "Client export should match shared logic");
  }
}

console.log("PASS: shared story-rules tests");

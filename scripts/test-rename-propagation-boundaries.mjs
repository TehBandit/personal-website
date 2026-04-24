import assert from "node:assert/strict";
import { buildNamePropagationPatterns } from "../api/notes-raw-file.js";

function applyPatterns(input, patterns) {
  let out = input;
  for (const { regex, replacement } of patterns) out = out.replace(regex, replacement);
  return out;
}

// Case 1: finding #7 regression — Ann -> Ana must NOT mutate Annex.
{
  const patterns = buildNamePropagationPatterns("Ann", "Ana", [{ old: "Ann", new: "Ana" }]);
  const input = "Ann met Bob. Annex remained unchanged. Ann's note. (Ann) [Ann]";
  const output = applyPatterns(input, patterns);

  assert.equal(output.includes("Ana met Bob"), true, "Standalone full name should be replaced");
  assert.equal(output.includes("Annex remained unchanged"), true, "Larger word should not be modified");
  assert.equal(output.includes("Ana's note"), true, "Possessive form should still update");
  assert.equal(output.includes("(Ana) [Ana]"), true, "Punctuation-wrapped tokens should update");
}

// Case 2: multi-word full name should not replace inside longer composite token.
{
  const patterns = buildNamePropagationPatterns(
    "Maren Ash",
    "Maren Vale",
    [{ old: "Ash", new: "Vale" }],
  );
  const input = "Maren Ash spoke softly. Maren Ashveil listened.";
  const output = applyPatterns(input, patterns);

  assert.equal(output.includes("Maren Vale spoke softly."), true, "Full phrase should update");
  assert.equal(output.includes("Maren Ashveil listened."), true, "Larger token containing old segment should not update");
}

console.log("PASS: rename propagation boundary tests");

import fs from "fs";
import path from "path";
import { rebuildGraphCache, bumpWorkspaceVersion } from "../api/bump-version.js";

const wsDir = "d:/personal-website/workspaces/veldmoor-chronicles";
const notesDir = wsDir + "/notes";
const folderSlug = "team_aoba_josai_interview";
const rawFolder = wsDir + "/" + folderSlug;

// ── Create the second upload folder ──
if (!fs.existsSync(rawFolder)) fs.mkdirSync(rawFolder, { recursive: true });

// ── Write supplemental .md for Oikawa in the new folder ──
const oikawaMd = [
  "OIKAWA TOORU — character notes",
  "",
  "In the Aoba Josai post-match interview, Oikawa Tooru speaks candidly about his rivalry with Kageyama,",
  "referring to him as 'a monster I made' — revealing a complicated mix of pride and resentment. He deflects",
  "questions about his knee injury with practiced ease, smiling for the cameras while teammates exchange worried glances.",
  "",
  "When asked about career aspirations, he pauses longer than expected before answering — he mentions the possibility",
  "of playing overseas, a detail his coach later declines to comment on. His relationship with Iwaizumi is visible",
  "throughout: they sit close, and Iwaizumi twice interrupts with blunt corrections to Oikawa's more colorful memories",
  "of games. Oikawa takes it without complaint, which the interviewer notes is out of character.",
].join("\n");

fs.writeFileSync(rawFolder + "/oikawa_tooru.md", oikawaMd, "utf-8");
console.log("Wrote supplemental .md: " + folderSlug + "/oikawa_tooru.md");

// ── Patch existing oikawa_tooru.json ──
const jsonPath = notesDir + "/oikawa_tooru.json";
const existingData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

const appendNotes = [
  "In a post-match interview, Oikawa speaks candidly about his rivalry with Kageyama, calling him 'a monster I made.'",
  "He deflects questions about a knee injury with practiced ease and mentions aspirations to play overseas.",
  "Iwaizumi twice corrects his memories of games — Oikawa accepts this without complaint, which the interviewer finds notable.",
].join(" ");

if (!existingData.notes.includes(appendNotes)) {
  existingData.notes = existingData.notes
    ? existingData.notes + "\n\n" + appendNotes
    : appendNotes;
}

// Patch new connections only if target node exists
const existingTargets = new Set((existingData.connections || []).map((c) => c.target));
const newConns = [
  { target: "iwaizumi", label: "close teammate, tolerates corrections from" },
  { target: "kageyama", label: "views as rival he trained, complicated pride" },
];
for (const conn of newConns) {
  if (!existingTargets.has(conn.target)) {
    if (fs.existsSync(notesDir + "/" + conn.target + ".json")) {
      existingData.connections.push(conn);
      existingTargets.add(conn.target);
      console.log("Added connection → " + conn.target);
    } else {
      console.log("Skipped connection → " + conn.target + " (node not found)");
    }
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(existingData, null, 2), "utf-8");
console.log("Patched oikawa_tooru.json");

// ── Write _meta.json for the new folder ──
fs.writeFileSync(rawFolder + "/_meta.json", JSON.stringify({
  sourceHash: "simulated",
  folderName: "Team Aoba Josai Interview",
  derivedAt: new Date().toISOString(),
  nodes: [],
  updated: ["oikawa_tooru"],
  mentions: [],
}, null, 2), "utf-8");
console.log("Wrote _meta.json");

// ── Rebuild graph cache ──
rebuildGraphCache("veldmoor-chronicles", notesDir);
bumpWorkspaceVersion("veldmoor-chronicles");
console.log("Done — graph rebuilt\n");

// ── Print final node state ──
const final = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
console.log("Final oikawa_tooru.json:");
console.log(JSON.stringify(final, null, 2));

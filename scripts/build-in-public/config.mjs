import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "../..");

export async function loadConfig() {
  const raw = await fs.readFile(
    path.join(repositoryRoot, "build-in-public.config.json"),
    "utf8"
  );
  const config = JSON.parse(raw);
  const requiredStrings = ["owner", "timezone", "model", "reasoningEffort"];
  for (const key of requiredStrings) {
    if (typeof config[key] !== "string" || !config[key]) {
      throw new Error(`Build-in-public config ${key} must be a non-empty string.`);
    }
  }
  if (!["low", "medium"].includes(config.reasoningEffort)) {
    throw new Error("Build-in-public reasoningEffort must be low or medium.");
  }
  for (const key of ["authorLogins", "authorEmails"]) {
    if (!Array.isArray(config[key])) throw new Error(`Build-in-public config ${key} must be an array.`);
  }
  for (const key of ["productionBranchOverrides", "publicRepositoryLabels"]) {
    if (!config[key] || typeof config[key] !== "object" || Array.isArray(config[key])) {
      throw new Error(`Build-in-public config ${key} must be an object.`);
    }
  }
  const numericKeys = [
    "minimumWords",
    "maximumWords",
    "maximumRepositories",
    "maximumBranchesPerRepository",
    "maximumQualifyingCommits",
    "maximumFilesPerCommit",
    "maximumPatchCharactersPerFile",
    "maximumEvidenceCharactersPerRepository",
    "maximumPromptCharacters",
    "maximumOutputTokens",
  ];
  for (const key of numericKeys) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) {
      throw new Error(`Build-in-public config ${key} must be a positive integer.`);
    }
  }
  if (config.minimumWords > config.maximumWords) {
    throw new Error("Build-in-public minimumWords may not exceed maximumWords.");
  }
  return config;
}

export function normalizeIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

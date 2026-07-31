import Ajv2020 from "ajv/dist/2020.js";
import { generatedPostSchema } from "./schema.mjs";
import { containsSensitivePattern, sourceTokenWindows } from "./sanitize.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(generatedPostSchema);

const obviousTypos = [
  "aethetic", "aethetics", "alot", "asthetic", "definately", "didnt",
  "doesnt", "dont", "happend", "im", "occured", "recieve", "seperate",
  "shouldnt", "teh", "thier", "wasnt", "wierd", "wont", "wouldnt",
];

function visibleStrings(post) {
  return [
    post.meta?.title,
    post.meta?.description,
    ...(post.blocks ?? []).flatMap((block) => [block.text, ...(block.items ?? [])]),
  ].filter((value) => typeof value === "string");
}

function wordCount(post) {
  return (post.blocks ?? [])
    .flatMap((block) => [block.text, ...(block.items ?? [])])
    .filter((value) => typeof value === "string")
    .join(" ")
    .match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/gi)?.length ?? 0;
}

function hasCodeOrImplementationDetail(text) {
  return [
    /```|`[^`]+`/,
    /https?:\/\//i,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /\b[0-9a-f]{7,40}\b/i,
    /\b(?:line|lines)\s+\d+\b/i,
    /(?:^|\s)(?:[\w.-]+\/)+[\w.-]+/,
    /\b[\w-]+\.(?:js|jsx|ts|tsx|py|rb|go|rs|java|css|scss|json|ya?ml|toml|sql|env)\b/i,
    /\b(?:api endpoint|database table|environment variable|function named|class named)\b/i,
  ].some((pattern) => pattern.test(text));
}

function matchesSourceNgram(text, sourceWindows, size = 8) {
  if (sourceWindows.size === 0) return false;
  const outputWindows = sourceTokenWindows(text, size);
  return [...outputWindows].some((window) => sourceWindows.has(window));
}

export function validateGeneratedPost(post, {
  config,
  window,
  evidence = [],
  sourceTexts = [],
  requireGrounding = true,
} = {}) {
  const errors = [];
  if (!validateSchema(post)) {
    errors.push(
      ...validateSchema.errors.map((error) =>
        `schema ${error.instancePath || "/"} ${error.message}`
      )
    );
  }
  if (errors.length > 0) return errors;

  if (window) {
    if (post.meta.slug !== window.slug) errors.push(`slug must be ${window.slug}`);
    if (post.meta.date !== window.date) errors.push(`date must be ${window.date}`);
    if (post.meta.periodStart !== window.periodStart) errors.push("periodStart does not match the requested window");
    if (post.meta.periodEnd !== window.periodEnd) errors.push("periodEnd does not match the requested window");
  }
  if (post.meta.slug !== `building-in-public-${post.meta.date}`) {
    errors.push("slug must be deterministically derived from the post date");
  }

  const strings = visibleStrings(post);
  for (const value of strings) {
    if (/[A-Z]/.test(value)) errors.push("public prose must be lowercase");
    if (containsSensitivePattern(value)) errors.push("public prose contains a secret-like value");
    if (hasCodeOrImplementationDetail(value)) errors.push("public prose is too implementation-specific");
    const normalized = value.toLowerCase();
    for (const typo of obviousTypos) {
      if (new RegExp(`\\b${typo}\\b`).test(normalized)) {
        errors.push(`public prose contains an obvious typo: ${typo}`);
      }
    }
  }

  for (const block of post.blocks) {
    if (block.type === "bullet-list" && block.items.length === 0) {
      errors.push("bullet-list blocks must contain at least one item");
    }
    if (block.type !== "bullet-list" && block.items.length > 0) {
      errors.push(`${block.type} blocks may not contain list items`);
    }
    if (block.type === "divider" && (block.text || block.evidenceIds.length > 0)) {
      errors.push("divider blocks must not contain text or evidence ids");
    }
  }

  const count = wordCount(post);
  if (config && (count < config.minimumWords || count > config.maximumWords)) {
    errors.push(`post has ${count} words; expected ${config.minimumWords}-${config.maximumWords}`);
  }

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (requireGrounding) {
    for (const block of post.blocks) {
      const factualBlock = !["heading", "divider"].includes(block.type);
      if (factualBlock && block.evidenceIds.length === 0) {
        errors.push(`${block.type} block must cite at least one evidence id`);
      }
      for (const evidenceId of block.evidenceIds) {
        if (!evidenceById.has(evidenceId)) errors.push(`unknown evidence id: ${evidenceId}`);
      }

      const cited = block.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
      if (block.type === "shipped" && cited.some((item) => item.status !== "production")) {
        errors.push("shipped blocks may cite production evidence only");
      }
      if (block.type === "in-progress" && cited.some((item) => item.status !== "development")) {
        errors.push("in-progress blocks may cite development evidence only");
      }
      if (/\b(?:shipped|released|live|in production)\b/i.test(block.text) &&
          cited.some((item) => item.status !== "production")) {
        errors.push("development evidence cannot be described as shipped");
      }
    }
  }

  const sourceWindows = new Set();
  for (const sourceText of sourceTexts) {
    for (const windowValue of sourceTokenWindows(sourceText)) sourceWindows.add(windowValue);
  }
  if (sourceWindows.size > 0) {
    for (const value of strings) {
      if (matchesSourceNgram(value, sourceWindows)) {
        errors.push("public prose copies an exact eight-word sequence from source code");
        break;
      }
    }
  }

  return [...new Set(errors)];
}

export function assertValidGeneratedPost(post, options) {
  const errors = validateGeneratedPost(post, options);
  if (errors.length > 0) {
    throw new Error(`Generated post failed validation:\n- ${errors.join("\n- ")}`);
  }
}

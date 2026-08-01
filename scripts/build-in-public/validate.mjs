import Ajv2020 from "ajv/dist/2020.js";
import { generatedPostSchema } from "./schema.mjs";
import { containsSensitivePattern, sourceTokenWindows } from "./sanitize.mjs";
import { formatDevlogTitle } from "./window.mjs";
import { normalizeProjectUrl } from "./project-metadata.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(generatedPostSchema);

function visibleStrings(post) {
  return [
    post.meta?.title,
    post.meta?.description,
    ...(post.projects ?? []).flatMap((project) => [
      project.name,
      ...project.bullets.map((bullet) => bullet.text),
      project.summary.text,
    ]),
  ].filter((value) => typeof value === "string");
}

function proseStrings(post) {
  return [
    post.meta?.description,
    ...(post.projects ?? []).flatMap((project) => [
      ...project.bullets.map((bullet) => bullet.text),
      project.summary.text,
    ]),
  ].filter((value) => typeof value === "string");
}

function wordCount(post) {
  return (post.projects ?? [])
    .flatMap((project) => [
      ...project.bullets.map((bullet) => bullet.text),
      project.summary.text,
    ])
    .filter((value) => typeof value === "string")
    .join(" ")
    .match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/gi)?.length ?? 0;
}

function sentenceCount(text) {
  return text.match(/[.!?]+(?=\s|$)/g)?.length ?? 0;
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
  collectedProjects = [],
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
    if (post.meta.title !== window.title) errors.push(`title must be ${window.title}`);
    if (post.meta.slug !== window.slug) errors.push(`slug must be ${window.slug}`);
    if (post.meta.date !== window.date) errors.push(`date must be ${window.date}`);
    if (post.meta.periodStart !== window.periodStart) errors.push("periodStart does not match the requested window");
    if (post.meta.periodEnd !== window.periodEnd) errors.push("periodEnd does not match the requested window");
  }
  if (post.meta.slug !== `building-in-public-${post.meta.date}`) {
    errors.push("slug must be deterministically derived from the post date");
  }
  const expectedTitle = formatDevlogTitle(post.meta.periodStart, post.meta.periodEnd);
  if (post.meta.title !== expectedTitle) {
    errors.push(`title must be deterministically derived from the coverage period: ${expectedTitle}`);
  }

  const strings = visibleStrings(post);
  for (const value of strings) {
    if (containsSensitivePattern(value)) errors.push("public prose contains a secret-like value");
    if (hasCodeOrImplementationDetail(value)) errors.push("public prose is too implementation-specific");
  }
  for (const value of proseStrings(post)) {
    if (/[A-Z]/.test(value)) errors.push("descriptions, bullets, and summaries must be lowercase");
  }

  const projectNames = new Set();
  for (const project of post.projects) {
    if (projectNames.has(project.name)) {
      errors.push(`project appears more than once: ${project.name}`);
    }
    projectNames.add(project.name);
    if (project.url !== null && normalizeProjectUrl(project.url) !== project.url) {
      errors.push(`${project.name} URL must be a normalized HTTP(S) GitHub About link`);
    }
    if (
      project.image !== null &&
      !/^\/build-in-public\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\.(?:png|jpg|gif|webp|avif)$/.test(project.image)
    ) {
      errors.push(`${project.name} image must be a safe generated raster path`);
    }
    for (const bullet of project.bullets) {
      if (sentenceCount(bullet.text) !== 1) {
        errors.push(`${project.name} bullets must each be exactly one sentence`);
      }
    }
    const summarySentences = sentenceCount(project.summary.text);
    if (summarySentences < 1 || summarySentences > 3) {
      errors.push(`${project.name} summary must contain 1-3 sentences`);
    }
  }

  const count = wordCount(post);
  if (config && (count < config.minimumWords || count > config.maximumWords)) {
    errors.push(`post has ${count} words; expected ${config.minimumWords}-${config.maximumWords}`);
  }

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (requireGrounding) {
    for (const project of post.projects) {
      const segments = [...project.bullets, project.summary];
      for (const segment of segments) {
        const cited = [];
        for (const evidenceId of segment.evidenceIds) {
          const evidenceItem = evidenceById.get(evidenceId);
          if (!evidenceItem) {
            errors.push(`unknown evidence id: ${evidenceId}`);
            continue;
          }
          cited.push(evidenceItem);
          if (evidenceItem.project !== project.name) {
            errors.push(`${project.name} content may cite only evidence for that project`);
          }
        }
        if (/\b(?:shipped|released|live|in production)\b/i.test(segment.text) &&
            cited.some((item) => item.status !== "production")) {
          errors.push("development evidence cannot be described as shipped");
        }
      }
    }

    const evidenceProjects = new Set(evidence.map((item) => item.project));
    for (const projectName of evidenceProjects) {
      if (!projectNames.has(projectName)) errors.push(`missing project section: ${projectName}`);
    }
    for (const projectName of projectNames) {
      if (!evidenceProjects.has(projectName)) errors.push(`project section has no evidence: ${projectName}`);
    }

  }

  const expectedProjects = new Map(collectedProjects.map((project) => [project.name, project]));
  if (expectedProjects.size > 0) {
    for (const project of post.projects) {
      const expected = expectedProjects.get(project.name);
      if (!expected) {
        errors.push(`project line changes have no collected source: ${project.name}`);
        continue;
      }
      if (
        project.changes.additions !== expected.additions ||
        project.changes.deletions !== expected.deletions
      ) {
        errors.push(
          `${project.name} line changes must be +${expected.additions} / -${expected.deletions}`
        );
      }
      if (project.url !== expected.url) {
        errors.push(`${project.name} URL must exactly match its GitHub About URL`);
      }
      if (project.image !== expected.image) {
        errors.push(`${project.name} image must exactly match the collector's random selection`);
      }
    }
    for (const projectName of expectedProjects.keys()) {
      if (!projectNames.has(projectName)) {
        errors.push(`missing line changes for project: ${projectName}`);
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

import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { collectWeeklyEvidence } from "./collect.mjs";
import { loadConfig, repositoryRoot } from "./config.mjs";
import { prepareProjectMedia } from "./media.mjs";
import { openAIGeneratedPostSchema } from "./schema.mjs";
import { assertValidGeneratedPost } from "./validate.mjs";
import { calculateWeeklyWindow } from "./window.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  return fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

function promptEvidence(evidence, maximumCharacters) {
  const payload = JSON.stringify(evidence);
  if (payload.length > maximumCharacters) {
    throw new Error(
      `Sanitized evidence is ${payload.length} characters, above the configured maximum of ${maximumCharacters}.`
    );
  }
  return payload;
}

async function createResponseWithRetry(client, request, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.responses.create(request);
    } catch (error) {
      lastError = error;
      const status = error?.status;
      const retryable = status === 408 || status === 409 || status === 429 || status >= 500 || !status;
      if (!retryable || attempt === attempts) break;
      const delay = 1000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

const config = await loadConfig();
const dryRun = hasArgument("--dry-run");
const requestedReasoningEffort = argumentValue("--reasoning-effort");
const reasoningEffort = requestedReasoningEffort || config.reasoningEffort;
if (!["low", "medium"].includes(reasoningEffort)) {
  throw new Error("Reasoning effort must be low or medium.");
}
const window = calculateWeeklyWindow({
  timezone: config.timezone,
  explicitWindowEnd: argumentValue("--window-end"),
});
const collectorToken = process.env.COLLECTOR_GITHUB_TOKEN;
const openAIKey = process.env.OPENAI_API_KEY;

if (!collectorToken) throw new Error("COLLECTOR_GITHUB_TOKEN is required.");
if (!openAIKey) throw new Error("OPENAI_API_KEY is required.");

const targetDirectory = dryRun
  ? path.join(repositoryRoot, ".build-in-public-preview")
  : path.join(repositoryRoot, "src/blogposts/generated");
const targetPath = path.join(targetDirectory, `${window.date}.json`);
const mediaTargetDirectory = dryRun
  ? path.join(repositoryRoot, ".build-in-public-preview", "build-in-public", window.date)
  : path.join(repositoryRoot, "public", "build-in-public", window.date);

if (!dryRun) {
  const alreadyExists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (alreadyExists) {
    console.log(`A generated post already exists for ${window.date}; nothing to do.`);
    await setOutput("has_post", "false");
    await setOutput("result", "already_published");
    process.exit(0);
  }
}

const collection = await collectWeeklyEvidence({ token: collectorToken, config, window });
if (collection.evidence.length === 0) {
  console.log(`No qualifying commits found for ${window.periodStart} through ${window.periodEnd}.`);
  await setOutput("has_post", "false");
  await setOutput("result", "no_activity");
  process.exit(0);
}

const preparedMedia = await prepareProjectMedia({
  token: collectorToken,
  projects: collection.projects,
  candidates: collection.imageCandidates,
  date: window.date,
  targetDirectory: mediaTargetDirectory,
  maximumImageBytes: config.maximumImageBytes,
});
collection.projects = preparedMedia.projects;

const systemPrompt = await fs.readFile(
  path.join(repositoryRoot, "scripts/build-in-public/system-prompt.md"),
  "utf8"
);
const evidencePayload = promptEvidence(collection.evidence, config.maximumPromptCharacters);
const expectedMetadata = {
  title: window.title,
  slug: window.slug,
  tag: "Development",
  date: window.date,
  periodStart: window.periodStart,
  periodEnd: window.periodEnd,
  headerPhotos: [],
};
const expectedProjects = collection.projects;

const instructions = `${systemPrompt}

## Runtime requirements

- Use exactly these projects and GitHub line-change totals, once each, and no others: ${JSON.stringify(expectedProjects)}.
- Copy each project's additions and deletions into its changes object exactly; never estimate, recalculate, or mention the totals in prose.
- Copy each project's image path exactly, including null; never invent, edit, or describe the selected image in prose.
- Use exactly this metadata: ${JSON.stringify(expectedMetadata)}.
- Aim for ${config.minimumWords}-${config.maximumWords} total words.`;

const client = new OpenAI({ apiKey: openAIKey, maxRetries: 0, timeout: 120000 });
let post;
let validationFeedback = "";
let lastGenerationError;

for (let generationAttempt = 1; generationAttempt <= 3; generationAttempt += 1) {
  const response = await createResponseWithRetry(client, {
    model: config.model,
    instructions,
    input: [
      `Evidence for the weekly window:\n${evidencePayload}`,
      validationFeedback,
    ].filter(Boolean).join("\n\n"),
    reasoning: { effort: reasoningEffort },
    text: {
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: "build_in_public_post",
        description: "A safe, grounded, structured weekly build-in-public blog post.",
        strict: true,
        schema: openAIGeneratedPostSchema,
      },
    },
    max_output_tokens: config.maximumOutputTokens,
    store: false,
    safety_identifier: "build-in-public-tehbandit",
  });

  try {
    if (!response.output_text) throw new Error("OpenAI returned no post content.");
    const candidate = JSON.parse(response.output_text);
    assertValidGeneratedPost(candidate, {
      config,
      window,
      evidence: collection.evidence,
      collectedProjects: collection.projects,
      sourceTexts: collection.sourceTexts,
    });
    post = candidate;
    break;
  } catch (error) {
    lastGenerationError = error;
    if (generationAttempt === 3) break;
    validationFeedback = [
      "The previous response was rejected. Return a fresh response that corrects these issues:",
      String(error.message).slice(0, 2000),
    ].join("\n");
    await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (generationAttempt - 1))));
  }
}

if (!post) throw lastGenerationError ?? new Error("OpenAI did not produce a valid post.");

await fs.mkdir(targetDirectory, { recursive: true });
await fs.writeFile(targetPath, `${JSON.stringify(post, null, 2)}\n`, "utf8");
await setOutput("has_post", "true");
await setOutput("result", dryRun ? "preview" : "generated");
await setOutput("post_path", path.relative(repositoryRoot, targetPath).replaceAll("\\", "/"));
await setOutput("post_date", window.date);
await setOutput("post_slug", window.slug);
await setOutput("has_media", preparedMedia.writtenPaths.length > 0 ? "true" : "false");
await setOutput(
  "media_directory",
  path.relative(repositoryRoot, mediaTargetDirectory).replaceAll("\\", "/")
);
await setOutput("reasoning_effort", reasoningEffort);
console.log(`Generated and validated ${path.relative(repositoryRoot, targetPath)}.`);

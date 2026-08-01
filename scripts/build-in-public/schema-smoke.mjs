import OpenAI from "openai";
import { loadConfig } from "./config.mjs";
import { openAIGeneratedPostSchema } from "./schema.mjs";
import { assertValidGeneratedPost } from "./validate.mjs";

const config = await loadConfig();
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
  timeout: 120000,
});
const window = {
  title: "Devlog: July 19, 2026 - July 26, 2026",
  slug: "building-in-public-2026-07-26",
  date: "2026-07-26",
  periodStart: "2026-07-19T12:00:00-04:00",
  periodEnd: "2026-07-26T12:00:00-04:00",
};

const response = await client.responses.create({
  model: config.model,
  instructions: [
    "Return a synthetic build-in-public post for schema compatibility testing.",
    "Use lowercase, readable prose totaling 30-80 words, with no code or links.",
    `Use this metadata exactly: ${JSON.stringify({
      title: window.title,
      slug: window.slug,
      tag: "Development",
      date: window.date,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      headerPhotos: [],
    })}.`,
    "Create one project named Example Project with url set to https://example.com/, image set to null, changes of exactly 12 additions and 3 deletions, 1-3 one-sentence bullets, and a 1-3 sentence casual summary.",
    "Use e1 for production facts and e2 for development facts, and cite evidence on every bullet and summary.",
  ].join("\n"),
  input: "Synthetic evidence: e1 says a clearer navigation experience shipped. e2 says a simpler drafting flow is being explored.",
  reasoning: { effort: "low" },
  text: {
    verbosity: "low",
    format: {
      type: "json_schema",
      name: "build_in_public_schema_smoke",
      strict: true,
      schema: openAIGeneratedPostSchema,
    },
  },
  max_output_tokens: 4000,
  store: false,
  safety_identifier: "build-in-public-schema-smoke",
});

if (!response.output_text) throw new Error("OpenAI returned no smoke-test output.");
const post = JSON.parse(response.output_text);
assertValidGeneratedPost(post, {
  config: { ...config, minimumWords: 30, maximumWords: 80 },
  window,
  evidence: [
    { id: "e1", project: "Example Project", status: "production" },
    { id: "e2", project: "Example Project", status: "development" },
  ],
  collectedProjects: [
    {
      name: "Example Project",
      url: "https://example.com/",
      image: null,
      additions: 12,
      deletions: 3,
    },
  ],
  requireGrounding: false,
});
console.log(`OpenAI schema smoke test passed with ${config.model}.`);

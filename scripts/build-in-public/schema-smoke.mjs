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
  slug: "building-in-public-2026-07-26",
  date: "2026-07-26",
  periodStart: "2026-07-19T12:00:00-04:00",
  periodEnd: "2026-07-26T12:00:00-04:00",
};

const response = await client.responses.create({
  model: config.model,
  instructions: [
    "Return a synthetic build-in-public post for schema compatibility testing.",
    "Use lowercase prose, correct spelling, 30-80 words, and no code or links.",
    `Use this metadata exactly: ${JSON.stringify({
      slug: window.slug,
      tag: "Development",
      date: window.date,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      headerPhotos: [],
    })}.`,
    "Use e1 for production facts and e2 for development facts.",
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
    { id: "e1", status: "production" },
    { id: "e2", status: "development" },
  ],
  requireGrounding: false,
});
console.log(`OpenAI schema smoke test passed with ${config.model}.`);

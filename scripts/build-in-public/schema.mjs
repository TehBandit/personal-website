const evidenceIdsSchema = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  maxItems: 20,
  items: { type: "string", pattern: "^e[0-9]+$" },
};

export const generatedPostSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "meta", "projects"],
  properties: {
    schemaVersion: { type: "integer", const: 4 },
    meta: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "description",
        "slug",
        "tag",
        "date",
        "periodStart",
        "periodEnd",
        "headerPhotos",
      ],
      properties: {
        title: {
          type: "string",
          minLength: 30,
          maxLength: 100,
          pattern: "^Devlog: [^\\r\\n]+ - [^\\r\\n]+$",
        },
        description: {
          type: "string",
          minLength: 20,
          maxLength: 180,
          pattern: "^[^\\r\\n]+$",
        },
        slug: {
          type: "string",
          pattern: "^building-in-public-[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        tag: { type: "string", const: "Development" },
        date: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
        periodStart: { type: "string", minLength: 20, maxLength: 40 },
        periodEnd: { type: "string", minLength: 20, maxLength: 40 },
        headerPhotos: { type: "array", maxItems: 0, items: { type: "string" } },
      },
    },
    projects: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "url", "image", "changes", "bullets", "summary"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          url: { type: ["string", "null"], maxLength: 2048 },
          image: { type: ["string", "null"], maxLength: 200 },
          changes: {
            type: "object",
            additionalProperties: false,
            required: ["additions", "deletions"],
            properties: {
              additions: { type: "integer", minimum: 0 },
              deletions: { type: "integer", minimum: 0 },
            },
          },
          bullets: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "evidenceIds"],
              properties: {
                text: { type: "string", minLength: 10, maxLength: 300 },
                evidenceIds: evidenceIdsSchema,
              },
            },
          },
          summary: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidenceIds"],
            properties: {
              text: { type: "string", minLength: 10, maxLength: 800 },
              evidenceIds: evidenceIdsSchema,
            },
          },
        },
      },
    },
  },
};

// Structured Outputs supports maxItems but not the JSON Schema uniqueItems
// keyword. Keep uniqueness in local validation and omit only that keyword from
// the schema sent to OpenAI.
export const openAIGeneratedPostSchema = structuredClone(generatedPostSchema);
const openAIProjectSchema = openAIGeneratedPostSchema.properties.projects.items.properties;
delete openAIProjectSchema.bullets.items.properties.evidenceIds.uniqueItems;
delete openAIProjectSchema.summary.properties.evidenceIds.uniqueItems;

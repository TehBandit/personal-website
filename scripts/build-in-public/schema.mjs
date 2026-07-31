export const BLOCK_TYPES = [
  "intro",
  "paragraph",
  "heading",
  "callout",
  "bullet-list",
  "divider",
  "shipped",
  "in-progress",
];

export const BLOCK_VARIANTS = [
  "plain",
  "blue",
  "violet",
  "emerald",
  "amber",
];

export const generatedPostSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "meta", "blocks"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
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
        title: { type: "string", minLength: 8, maxLength: 100 },
        description: { type: "string", minLength: 20, maxLength: 180 },
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
    blocks: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "variant", "text", "items", "evidenceIds"],
        properties: {
          type: { type: "string", enum: BLOCK_TYPES },
          variant: { type: "string", enum: BLOCK_VARIANTS },
          text: { type: "string", maxLength: 1000 },
          items: {
            type: "array",
            maxItems: 6,
            items: { type: "string", minLength: 1, maxLength: 400 },
          },
          evidenceIds: {
            type: "array",
            uniqueItems: true,
            maxItems: 20,
            items: { type: "string", pattern: "^e[0-9]+$" },
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
delete openAIGeneratedPostSchema.properties.blocks.items.properties.evidenceIds.uniqueItems;

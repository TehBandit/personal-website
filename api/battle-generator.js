import OpenAI from "openai";
import { validateTextField, validateStringArray } from "./guardrails.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const { spiceTolerance, dietaryRestrictions, mustInclude, maxCalories, macros, primaryFlavors, secondaryFlavors, creativity, extraNotes, excluded } = req.body;

    // --- Input validation / guardrails ---
    const mustIncludeCheck = validateTextField(mustInclude, "mustInclude");
    if (!mustIncludeCheck.ok) return res.status(400).json({ error: mustIncludeCheck.error });

    const extraNotesCheck = validateTextField(extraNotes, "extraNotes");
    if (!extraNotesCheck.ok) return res.status(400).json({ error: extraNotesCheck.error });

    const excludedCheck = validateTextField(excluded, "excluded");
    if (!excludedCheck.ok) return res.status(400).json({ error: excludedCheck.error });

    const dietaryCheck = validateStringArray(dietaryRestrictions, "dietaryRestrictions");
    if (!dietaryCheck.ok) return res.status(400).json({ error: dietaryCheck.error });

    const primaryFlavorsCheck = validateStringArray(primaryFlavors, "primaryFlavors");
    if (!primaryFlavorsCheck.ok) return res.status(400).json({ error: primaryFlavorsCheck.error });

    const secondaryFlavorsCheck = validateStringArray(secondaryFlavors, "secondaryFlavors");
    if (!secondaryFlavorsCheck.ok) return res.status(400).json({ error: secondaryFlavorsCheck.error });

    // Use sanitized values from here on
    const safeMusInclude = mustIncludeCheck.value;
    const safeExtraNotes = extraNotesCheck.value;
    const safeExcluded = excludedCheck.value;
    const safeDietary = dietaryCheck.value;
    const safePrimaryFlavors = primaryFlavorsCheck.value;
    const safeSecondaryFlavors = secondaryFlavorsCheck.value;
    // -------------------------------------

    const preferences = [
      spiceTolerance && spiceTolerance !== "no preference" && `spice level: ${spiceTolerance}`,
      safeDietary.length > 0 && `dietary restrictions: ${safeDietary.join(", ")}`,
      safeMusInclude && `must use these ingredients: ${safeMusInclude}`,
      maxCalories && `maximum calories per serving: ${maxCalories} kcal`,
      macros && macros.fat !== "none" && `${macros.fat} fat`,
      macros && macros.carbs !== "none" && `${macros.carbs} carb`,
      macros && macros.protein !== "none" && `${macros.protein} protein`,
      safePrimaryFlavors.length > 0 && `primary flavor profiles: ${safePrimaryFlavors.join(", ")}`,
      safeSecondaryFlavors.length > 0 && `vibe: ${safeSecondaryFlavors.join(", ")}`,
      safeExtraNotes && `additional notes: ${safeExtraNotes}`,
    ]
      .filter(Boolean)
      .join(", ");

    const exclusionClause =
      safeExcluded
        ? `\n\nIMPORTANT: None of the 16 recipes must contain any of the following ingredients under any circumstances: ${safeExcluded}.`
        : "";

    const creativityInstruction = (() => {
      if (creativity === "strict") return "CREATIVITY: Stick very closely to the user's listed ingredients. Only add ingredients that are strictly necessary to make the dish work (e.g. salt, water). Do not invent new flavour directions.";
      if (creativity === "creative") return "CREATIVITY: Be highly adventurous. Use the user's listed ingredients as a loose starting point and feel free to introduce unexpected, bold, or fusion elements. Surprise the user with unusual dishes.";
      return "CREATIVITY: Use the user's listed ingredients as a foundation but feel free to add complementary ingredients where they meaningfully improve the dish.";
    })();

    const userPrompt = `You are running a "Recipe Battle" bracket tournament. Generate exactly 16 distinct, creative recipes that all meet the following preferences.

User preferences: ${preferences || "no specific preferences — surprise me with variety"}.${exclusionClause}

${creativityInstruction}

Rules:
- All 16 recipes must satisfy the user's dietary restrictions and preferences.
- The 16 recipes must be as diverse as possible in cuisine style, cooking method, and flavor profile — not similar dishes with minor variations.
- Each recipe needs only a title and a single evocative sentence that describes its flavor, texture, and vibe.
- Do NOT include ingredients lists, steps, or any other fields.
- Respond ONLY with valid JSON in exactly this format, no markdown, no extra text:
{
  "recipes": [
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." },
    ...16 total
  ]
}`;

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a creative chef and culinary expert running a recipe bracket tournament. Generate 16 highly diverse and appealing recipes that match the user's preferences. Always respond with valid JSON only — no markdown, no prose outside the JSON. Strictly honor dietary restrictions and ingredient exclusions.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    let result;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "");
      result = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Failed to parse recipe list from AI response." });
    }

    if (!Array.isArray(result.recipes) || result.recipes.length !== 16) {
      return res.status(500).json({ error: "AI did not return exactly 16 recipes." });
    }

    return res.status(200).json({ recipes: result.recipes });
  } catch (err) {
    console.error("❌ Battle generation error:", err);
    return res.status(500).json({ error: "Failed to generate battle recipes" });
  }
}

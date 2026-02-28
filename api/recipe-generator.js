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

    const { spiceTolerance, dietaryRestrictions, mustInclude, maxCalories, servings, extraNotes, excluded } = req.body;

    // --- Input validation / guardrails ---
    const mustIncludeCheck = validateTextField(mustInclude, "mustInclude");
    if (!mustIncludeCheck.ok) return res.status(400).json({ error: mustIncludeCheck.error });

    const extraNotesCheck = validateTextField(extraNotes, "extraNotes");
    if (!extraNotesCheck.ok) return res.status(400).json({ error: extraNotesCheck.error });

    const excludedCheck = validateTextField(excluded, "excluded");
    if (!excludedCheck.ok) return res.status(400).json({ error: excludedCheck.error });

    const dietaryCheck = validateStringArray(dietaryRestrictions, "dietaryRestrictions");
    if (!dietaryCheck.ok) return res.status(400).json({ error: dietaryCheck.error });

    const safeMustInclude = mustIncludeCheck.value;
    const safeExtraNotes = extraNotesCheck.value;
    const safeExcluded = excludedCheck.value;
    const safeDietary = dietaryCheck.value;
    // -------------------------------------

    const preferences = [
      spiceTolerance && spiceTolerance !== "no preference" && `spice level: ${spiceTolerance}`,
      safeDietary.length > 0 && `dietary restrictions: ${safeDietary.join(", ")}`,
      safeMustInclude && `must use these ingredients: ${safeMustInclude}`,
      maxCalories && `maximum calories per serving: ${maxCalories} kcal`,
      servings && `number of servings: ${servings}`,
      safeExtraNotes && `additional notes: ${safeExtraNotes}`,
    ]
      .filter(Boolean)
      .join(", ");

    const exclusionClause = safeExcluded
      ? `\n\nIMPORTANT: The recipe must NOT contain any of the following ingredients under any circumstances: ${safeExcluded}.`
      : "";

    const userPrompt = `You are planning a smart grocery trip. Generate exactly 2 meals that are flavorfully distinct from each other but share as many raw ingredients as possible to minimize waste and simplify shopping.

User preferences: ${preferences || "no specific preferences, surprise me"}.${exclusionClause}

Rules:
- The 2 meals should feel different (different vibe, texture, or style) but lean heavily on the same core ingredients.
- Not every ingredient needs to be shared — each dish may have a few unique items — but the majority of the grocery list should serve both meals.
- descriptions: 2-3 sentences that give a sense of the dish's flavor, texture, and occasion.
- steps: an array of 4-6 short strings, each covering one key step in the preparation method.
- Grocery list format: write each item as "ingredient name (quantity)" — e.g. "chicken thighs (1.5 lbs)", "garlic (6 cloves)", "olive oil (3 tbsp)". Do NOT put the quantity first.
- The grocery list must be COMPLETE and EXHAUSTIVE — every single ingredient mentioned in either meal's description or steps must appear in the grocery list. Do not omit anything, including spices, condiments, garnishes, or pantry staples used in preparation.
- Respond ONLY with valid JSON in exactly this format, no markdown, no extra text:
{
  "meal1": { "title": "...", "description": "...", "steps": ["step 1", "step 2", "..."] },
  "meal2": { "title": "...", "description": "...", "steps": ["step 1", "step 2", "..."] },
  "groceryList": ["ingredient (quantity)", "..."]
}`;

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a creative and practical chef who specializes in efficient meal planning. Your goal is to suggest 2 flavorfully distinct meals that share most of their raw ingredients, reducing grocery waste. Always respond with valid JSON only — no markdown, no prose outside the JSON. If the user specifies ingredients to exclude, strictly avoid them in both meals. If the user specifies fridge ingredients, incorporate them meaningfully into both meals where possible.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    let mealPlan;
    try {
      // strip possible markdown code fences
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      mealPlan = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Failed to parse meal plan from AI response." });
    }
    return res.status(200).json({ mealPlan });
  } catch (err) {
    console.error("❌ Recipe generation error:", err);
    return res.status(500).json({ error: "Failed to generate recipe" });
  }
}

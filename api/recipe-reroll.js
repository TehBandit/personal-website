import OpenAI from "openai";
import { validateMeal, validatePreferencesString, validateTextField } from "./guardrails.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const { rerollTarget, keepMeal, preferences, excluded } = req.body;
    // rerollTarget: "meal1" | "meal2"
    // keepMeal: the meal object to keep
    // preferences: plain string of user prefs (already assembled)
    // excluded: excluded ingredients string

    // --- Input validation / guardrails ---
    const mealCheck = validateMeal(keepMeal, "keepMeal");
    if (!mealCheck.ok) return res.status(400).json({ error: mealCheck.error });

    const prefsCheck = validatePreferencesString(preferences);
    if (!prefsCheck.ok) return res.status(400).json({ error: prefsCheck.error });
    const safePreferences = prefsCheck.value;

    const excludedCheck = validateTextField(excluded, "excluded");
    if (!excludedCheck.ok) return res.status(400).json({ error: excludedCheck.error });
    const safeExcluded = excludedCheck.value;
    // -------------------------------------

    const exclusionClause = safeExcluded
      ? `\n\nIMPORTANT: The recipe must NOT contain any of the following ingredients under any circumstances: ${safeExcluded}.`
      : "";

    const userPrompt = `You are planning a smart grocery trip. You already have one meal decided:

Meal to keep: "${keepMeal.title}" — ${keepMeal.description}

Generate a NEW single meal that is:
- Flavorfully distinct from "${keepMeal.title}"
- Shares as many raw ingredients as possible with it
- Meets these preferences: ${safePreferences || "no specific preferences, surprise me"}${exclusionClause}

- description: 2-3 sentences that give a sense of the dish's flavor, texture, and occasion.
- steps: an array of 4-6 short strings, each covering one key step in the preparation method.
- Grocery list format: write each item as "ingredient name (quantity)" — e.g. "chicken thighs (1.5 lbs)", "garlic (6 cloves)", "olive oil (3 tbsp)". Do NOT put the quantity first.
- The grocery list must be COMPLETE and EXHAUSTIVE — every single ingredient mentioned in either meal's description or steps must appear in the grocery list. Do not omit anything, including spices, condiments, garnishes, or pantry staples used in preparation.

Also produce an updated shared grocery list that covers both "${keepMeal.title}" and the new meal.

Respond ONLY with valid JSON in exactly this format, no markdown, no extra text:
{
  "newMeal": { "title": "...", "description": "...", "steps": ["step 1", "step 2", "..."] },
  "groceryList": ["ingredient (quantity)", "..."]
}`;

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a creative and practical chef who specializes in efficient meal planning. Your goal is to suggest meals that share most of their raw ingredients, reducing grocery waste. Always respond with valid JSON only — no markdown, no prose outside the JSON. If ingredients to exclude are specified, strictly avoid them.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    let result;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      result = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Failed to parse reroll response from AI." });
    }

    return res.status(200).json({ newMeal: result.newMeal, groceryList: result.groceryList });
  } catch (err) {
    console.error("❌ Reroll error:", err);
    return res.status(500).json({ error: "Failed to reroll meal" });
  }
}

import OpenAI from "openai";
import { validateMeal, validatePreferencesString } from "./guardrails.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const { meal1, meal2, preferences } = req.body;
    // meal1, meal2: { title, description }
    // preferences: string of assembled user preferences

    // --- Input validation / guardrails ---
    const meal1Check = validateMeal(meal1, "meal1");
    if (!meal1Check.ok) return res.status(400).json({ error: meal1Check.error });

    const meal2Check = validateMeal(meal2, "meal2");
    if (!meal2Check.ok) return res.status(400).json({ error: meal2Check.error });

    const prefsCheck = validatePreferencesString(preferences);
    if (!prefsCheck.ok) return res.status(400).json({ error: prefsCheck.error });
    const safePreferences = prefsCheck.value;
    // -------------------------------------

    const userPrompt = `You are planning a smart grocery trip for 2 championship meals chosen by a user in a bracket tournament.

Meal 1: "${meal1.title}" — ${meal1.description}
Meal 2: "${meal2.title}" — ${meal2.description}

User preferences: ${safePreferences || "no specific preferences"}.

Your task:
- Generate a COMPLETE and EXHAUSTIVE shared grocery list that covers every ingredient needed to prepare both meals fully.
- Infer all necessary ingredients from the meal titles and descriptions — include proteins, produce, pantry staples, spices, condiments, garnishes, and any cooking fats or liquids required.
- Also generate step-by-step cooking instructions for each meal (4-6 steps each).
- Grocery list format: write each item as "ingredient name (quantity)" — e.g. "chicken thighs (1.5 lbs)", "garlic (6 cloves)", "olive oil (3 tbsp)". Do NOT put the quantity first.
- Where ingredients overlap between the two meals, combine them into a single grocery list entry with the total quantity needed.

Respond ONLY with valid JSON in exactly this format, no markdown, no extra text:
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
            "You are a creative and practical chef who specializes in efficient meal planning. Given two winning championship meal concepts, generate their full recipes and a complete shared grocery list. Always respond with valid JSON only — no markdown, no prose outside the JSON.",
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
      return res.status(500).json({ error: "Failed to parse grocery list from AI response." });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Battle grocery error:", err);
    return res.status(500).json({ error: "Failed to generate grocery list" });
  }
}

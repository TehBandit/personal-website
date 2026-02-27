import OpenAI from "openai";

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

    const preferences = [
      spiceTolerance && spiceTolerance !== "no preference" && `spice level: ${spiceTolerance}`,
      dietaryRestrictions && dietaryRestrictions.length > 0 && `dietary restrictions: ${dietaryRestrictions.join(", ")}`,
      mustInclude && mustInclude.trim() && `must use these ingredients: ${mustInclude.trim()}`,
      maxCalories && `maximum calories per serving: ${maxCalories} kcal`,
      macros && macros.fat !== "none" && `${macros.fat} fat`,
      macros && macros.carbs !== "none" && `${macros.carbs} carb`,
      macros && macros.protein !== "none" && `${macros.protein} protein`,
      primaryFlavors && primaryFlavors.length > 0 && `primary flavor profiles: ${primaryFlavors.join(", ")}`,
      secondaryFlavors && secondaryFlavors.length > 0 && `vibe: ${secondaryFlavors.join(", ")}`,
      extraNotes && `additional notes: ${extraNotes}`,
    ]
      .filter(Boolean)
      .join(", ");

    const exclusionClause =
      excluded && excluded.trim()
        ? `\n\nIMPORTANT: None of the 16 recipes must contain any of the following ingredients under any circumstances: ${excluded.trim()}.`
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

// api/openai-test.js
import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("❌ Missing OPENAI_API_KEY environment variable");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const client = new OpenAI({ apiKey });

    // Example prompt — you can later replace this with user input
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful cooking assistant." },
        { role: "user", content: "Give me a fun fact about food." },
      ],
    });

    const message = completion.choices[0].message.content;
    return res.status(200).json({ response: message });
  } catch (err) {
    console.error("❌ OpenAI API error:", err);
    return res.status(500).json({ error: "OpenAI API request failed" });
  }
}
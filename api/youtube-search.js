// api/youtube-search.js
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const channelId = req.query.channelId;
    const maxResults = req.query.maxResults || "1";
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      console.error("❌ Missing YOUTUBE_API_KEY environment variable");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    if (!channelId) {
      return res.status(400).json({ error: "Missing required parameter: channelId" });
    }

    const params = new URLSearchParams({
      part: "snippet",
      channelId,
      order: "date",
      maxResults,
      type: "video",
      key: apiKey,
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "YouTube API request failed",
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("❌ YouTube API error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
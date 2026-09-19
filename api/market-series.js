const SERIES = {
  sp500: {
    fredId: "SP500",
    filename: "sp500.csv",
  },
};

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const requestUrl = new URL(req.url, "http://localhost");
  const seriesKey = requestUrl.searchParams.get("series") || "sp500";
  const series = SERIES[seriesKey];

  if (!series) {
    return sendJson(res, 400, { error: "Unsupported market series" });
  }

  try {
    const fredUrl = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
    fredUrl.searchParams.set("id", series.fredId);

    const response = await fetch(fredUrl, {
      headers: { Accept: "text/csv" },
    });

    if (!response.ok) {
      throw new Error(`FRED returned ${response.status}`);
    }

    const csv = await response.text();

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${series.filename}"`);
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.end(csv);
  } catch (error) {
    console.error("Market series fetch failed:", error);
    return sendJson(res, 502, { error: "Unable to load market data" });
  }
}

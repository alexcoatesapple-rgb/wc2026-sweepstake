// Netlify serverless function — proxies API-Football so the key never hits the browser.
// Deployed automatically by Netlify when you push. Set API_FOOTBALL_KEY in Netlify env vars.

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "API_FOOTBALL_KEY env var not set." }),
    };
  }

  // Build the API-Football URL
  // FIFA World Cup 2026 = league 1, season 2026
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("league", "1");
  url.searchParams.set("season", "2026");

  const params = event.queryStringParameters || {};

  // Default from/to to yesterday and today if not provided
  const formatDate = (d) => d.toISOString().split("T")[0];
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Support filtering by status (FT, LIVE, NS etc.) or date range
  if (params.status) url.searchParams.set("status", params.status);
  if (params.date)   url.searchParams.set("date",   params.date);
  url.searchParams.set("from", params.from || formatDate(yesterday));
  url.searchParams.set("to",   params.to   || formatDate(today));
  if (params.round)  url.searchParams.set("round",  params.round);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "x-apisports-key": key,
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: CORS,
        body: JSON.stringify({ error: `API returned ${res.status}` }),
      };
    }

    const data = await res.json();

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

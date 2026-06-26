// Netlify serverless function — proxies the ESPN WC 2026 group standings.
// Used to auto-derive group winners and group-stage eliminations. No API key.

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const url =
    "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";

  try {
    const res = await fetch(url);
    const data = await res.json();

    const stat = (e, name) =>
      (e.stats || []).find((s) => s.name === name)?.value;

    // One entry per group (A–L). `complete` is true only once every team in the
    // group has played its 3 games — the client uses that to avoid deciding a
    // winner / exit mid-group. `advanced` is ESPN's own determination (it already
    // resolves the best third-placed teams), so the client never recomputes it.
    const groups = (data.children || []).map((g) => {
      const teams = (g.standings?.entries || []).map((e) => ({
        name: e.team.displayName,
        rank: Number(stat(e, "rank")) || null,
        gamesPlayed: Number(stat(e, "gamesPlayed")) || 0,
        advanced: String(stat(e, "advanced")) === "1",
      }));
      const complete = teams.length > 0 && teams.every((t) => t.gamesPlayed >= 3);
      return { name: g.name, complete, teams };
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ groups }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

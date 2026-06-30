// Netlify serverless function — proxies ESPN scoreboard API for WC 2026 results.
// No API key required.

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

  // Fetch yesterday and today from ESPN (covers late night / early morning games)
  const formatESPN = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const base = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

  try {
    const [resYesterday, resToday] = await Promise.all([
      fetch(`${base}?dates=${formatESPN(yesterday)}`),
      fetch(`${base}?dates=${formatESPN(today)}`),
    ]);

    const [dataYesterday, dataToday] = await Promise.all([
      resYesterday.json(),
      resToday.json(),
    ]);

    // Merge events from both days, deduplicate by id
    const allEvents = [
      ...(dataYesterday.events || []),
      ...(dataToday.events || []),
    ];
    const seen = new Set();
    const events = allEvents.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const matches = events.map((e) => {
      const comp = e.competitions[0];
      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");

      // Count red cards from competition details (not available in competitor statistics)
      const details = comp.details || [];
      const redCardsHome = details.filter(d => d.redCard && d.team?.id === home.team.id).length;
      const redCardsAway = details.filter(d => d.redCard && d.team?.id === away.team.id).length;

      // Real round/stage. ESPN splits this across two fields and which one
      // carries it depends on the stage:
      //   • Group stage: the note headline holds it (e.g. "Group A").
      //   • Knockouts: the round lives in season.slug (e.g. "round-of-32"),
      //     while notes hold EVENT annotations like "X advance 4-3 on
      //     penalties" — NOT the round. Reading that note as the round mis-stages
      //     a knockout tie as a group game (it has no R32/R16/QF/… keyword).
      // So combine BOTH sources, drop the penalty-result annotation, and let
      // apiRoundToStage pick the round keyword out of whichever field has it.
      const roundNotes = (comp.notes || [])
        .map(n => n.headline || n.text)
        .filter(Boolean)
        .filter(t => !/penalt/i.test(t));
      const noteHeadline = [e.season?.slug, ...roundNotes].filter(Boolean).join(" ");

      return {
        id: e.id,
        date: e.date,
        status: e.status.type.description,    // "Full Time", "First Half", "Scheduled", …
        statusState: e.status.type.state,     // "post", "in", "pre"
        displayClock: e.status.displayClock,  // "45'+2'", "90'", "0'"
        period: e.status.period,              // 1 = first half, 2 = second half / ET
        homeTeam: home.team.displayName,
        homeScore: home.score ?? null,
        awayTeam: away.team.displayName,
        awayScore: away.score ?? null,
        // Penalty-shootout tally — present only when a knockout tie went to pens.
        // ESPN keeps it separate from `score` (which stays the regulation/ET
        // score, e.g. 1-1), so the app can derive the pens winner automatically.
        homeShootout: home.shootoutScore ?? null,
        awayShootout: away.shootoutScore ?? null,
        redCardsHome,
        redCardsAway,
        round: noteHeadline || null,
      };
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ matches }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

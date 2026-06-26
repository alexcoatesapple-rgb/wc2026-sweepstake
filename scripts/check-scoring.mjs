// Scoring regression check — exercises the REAL scoring functions from
// src/App.jsx (DEFAULT_SCORING, koWinner, teamMatchPts, buildStats) without
// changing the app. The leaderboard is the product, so a silent scoring bug is
// the worst failure; this fails loudly if any rule drifts.
//
//   node scripts/check-scoring.mjs     (also: npm test)
//
// It extracts the functions by name and evals them. If you rename or move one of
// them in App.jsx, update the `grab` patterns below.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

function grab(label, re) {
  const m = src.match(re);
  if (!m) throw new Error(`Could not find ${label} in src/App.jsx — did it get renamed/moved?`);
  return m[0];
}
const code =
  grab("DEFAULT_SCORING", /const DEFAULT_SCORING = \{[\s\S]*?\};/) + "\n" +
  grab("koWinner",        /function koWinner[\s\S]*?\n\}/) + "\n" +
  grab("teamMatchPts",    /function teamMatchPts[\s\S]*?\n\}/) + "\n" +
  grab("buildStats",      /function buildStats[\s\S]*?\n\}/) + "\n" +
  "return { DEFAULT_SCORING, koWinner, teamMatchPts, buildStats };";
const { DEFAULT_SCORING: SC, koWinner, teamMatchPts, buildStats } = new Function(code)();

let passed = 0, failed = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; }
  else { failed++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};
const pts = (teamId, m) => teamMatchPts(teamId, m, SC);

// ---- teamMatchPts ----------------------------------------------------------
// Group win + clean sheet: 2*goal + cleanSheet + win = 2+2+5
eq("group win+CS (winner)", pts("a", { stage:"GROUP", teamA:"a", teamB:"b", scoreA:2, scoreB:0 }), 9);
// Group loss: 0 GF, 2 conceded, no clean sheet
eq("group loss (loser)",    pts("b", { stage:"GROUP", teamA:"a", teamB:"b", scoreA:2, scoreB:0 }), -2);
// Group draw 1-1: goal + conceded + draw = 1-1+2
eq("group draw",            pts("a", { stage:"GROUP", teamA:"a", teamB:"b", scoreA:1, scoreB:1 }), 2);
// Red card: 1-0 win+CS but one red = 1+2+5 - 3
eq("group win, 1 red",      pts("a", { stage:"GROUP", teamA:"a", teamB:"b", scoreA:1, scoreB:0, redsA:1 }), 5);
// KO win 1-0: goal + CS + win + roundWin = 1+2+5+5
eq("KO winner",             pts("a", { stage:"R16", teamA:"a", teamB:"b", scoreA:1, scoreB:0 }), 13);
eq("KO loser",              pts("b", { stage:"R16", teamA:"a", teamB:"b", scoreA:1, scoreB:0 }), -1);
// KO on pens (1-1, a wins pens): goal-conceded + win + roundWin = 0+10
eq("KO pens winner",        pts("a", { stage:"QF", teamA:"a", teamB:"b", scoreA:1, scoreB:1, pensWinner:"a" }), 10);
eq("KO pens loser",         pts("b", { stage:"QF", teamA:"a", teamB:"b", scoreA:1, scoreB:1, pensWinner:"a" }), 0);
// Team not in the match scores nothing
eq("team not in match",     pts("z", { stage:"GROUP", teamA:"a", teamB:"b", scoreA:1, scoreB:0 }), 0);

// ---- koWinner --------------------------------------------------------------
eq("koWinner A",     koWinner({ teamA:"a", teamB:"b", scoreA:2, scoreB:1 }), "a");
eq("koWinner B",     koWinner({ teamA:"a", teamB:"b", scoreA:0, scoreB:1 }), "b");
eq("koWinner pens",  koWinner({ teamA:"a", teamB:"b", scoreA:1, scoreB:1, pensWinner:"b" }), "b");
eq("koWinner draw→null", koWinner({ teamA:"a", teamB:"b", scoreA:1, scoreB:1 }), null);

// ---- buildStats ------------------------------------------------------------
const state = {
  parts: [{ id:"p1", name:"Alex" }, { id:"p2", name:"Sam" }],
  assignments: { p1:["esp","bra"], p2:["fra"] },
  groupWinners: { esp:true },
  eliminated: {},
  results: [
    { stage:"GROUP", teamA:"esp", teamB:"fra", scoreA:2, scoreB:0 }, // esp 9, fra -2
    { stage:"R16",   teamA:"bra", teamB:"arg", scoreA:1, scoreB:0 }, // bra 13, arg eliminated
  ],
};
const s = buildStats(state);
eq("esp pts (win+CS+groupWin)", s.teamPts.esp, 12); // 9 + groupWin 3
eq("fra pts (group loss)",      s.teamPts.fra, -2);
eq("bra pts (KO win)",          s.teamPts.bra, 13);
eq("KO loser eliminated",       s.eliminated.has("arg"), true);
eq("group loss NOT eliminated", s.eliminated.has("fra"), false);
eq("leader is Alex",            s.players[0].name, "Alex");
eq("leader total esp+bra",      s.players[0].total, 25);
eq("leader rank 1",             s.players[0].rank, 1);
eq("leader alive count",        s.players[0].alive, 2);
eq("runner-up rank 2",          s.players[1].rank, 2);

// Live match must NOT eliminate (provisional scoring only)
const live = buildStats({
  parts: [{ id:"p1", name:"Alex" }],
  assignments: { p1:["esp"] },
  results: [{ stage:"R16", teamA:"esp", teamB:"ned", scoreA:0, scoreB:1, live:true }],
});
eq("live KO loss not eliminated", live.eliminated.has("esp"), false);
eq("live match still scores",     live.teamPts.esp, -1);

// Tie → shared rank, next rank skips
const tie = buildStats({
  parts: [{ id:"p1", name:"Aaa" }, { id:"p2", name:"Bbb" }, { id:"p3", name:"Ccc" }],
  assignments: { p1:["esp"], p2:["bra"], p3:["fra"] },
  groupWinners: {}, eliminated: {},
  results: [
    { stage:"GROUP", teamA:"esp", teamB:"x", scoreA:1, scoreB:1 }, // esp draw = 2
    { stage:"GROUP", teamA:"bra", teamB:"y", scoreA:1, scoreB:1 }, // bra draw = 2
    // fra plays nothing → 0
  ],
});
eq("tie: both leaders rank 1", [tie.players[0].rank, tie.players[1].rank], [1, 1]);
eq("tie: third is rank 3",     tie.players[2].rank, 3);

// ---------------------------------------------------------------------------
console.log(`\nscoring check: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

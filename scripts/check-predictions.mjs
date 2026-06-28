// Prediction-scoring regression check — exercises the REAL prediction functions
// from src/App.jsx (resolvePredictionTree, PREDICTION_WEIGHTS, scorePrediction)
// without changing the app. A silent bug here means the predictions leaderboard
// lies, so this fails loudly if the propagation or weighting drifts.
//
//   node scripts/check-predictions.mjs     (also runs under: npm test)
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
  grab("KO_FLOW",               /const KO_FLOW = \[[\s\S]*?\];/) + "\n" +
  grab("KO_BY_NUM",             /const KO_BY_NUM = new Map\(KO_FLOW\.map[\s\S]*?\);/) + "\n" +
  grab("resolvePredictionTree", /function resolvePredictionTree[\s\S]*?\n\}/) + "\n" +
  grab("PREDICTION_WEIGHTS",    /const PREDICTION_WEIGHTS = \{[\s\S]*?\};/) + "\n" +
  grab("scorePrediction",       /function scorePrediction[\s\S]*?\n\}/) + "\n" +
  "return { resolvePredictionTree, PREDICTION_WEIGHTS, scorePrediction };";
const { resolvePredictionTree, scorePrediction } = new Function(code)();

let passed = 0, failed = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; }
  else { failed++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};

// Seed the R32 with 32 distinct teams (m73..88, each a:T(odd) b:T(even)).
const seedTree = new Map();
for (let i = 0; i < 16; i++) {
  const m = 73 + i;
  seedTree.set(m, { a: { teamId: "T" + (2 * i + 1), label: "a" }, b: { teamId: "T" + (2 * i + 2), label: "b" } });
}
// Build a fully-decided "reality" by always advancing the 'a' side. Iterate so
// later rounds resolve once their feeders are filled (uses the real propagator).
let realityPicks = {};
for (let iter = 0; iter < 8; iter++) {
  const tr = resolvePredictionTree(seedTree, realityPicks);
  for (let m = 73; m <= 104; m++) {
    const t = tr.get(m);
    if (t.a.teamId && t.b.teamId && !realityPicks[m]) realityPicks[m] = t.a.teamId;
  }
}
// actualTree = reality, every tie decided.
const actualTree = resolvePredictionTree(seedTree, realityPicks);

const strip = ({ points, correct, decided, possible, pct }) => ({ points, correct, decided, possible, pct });

// 32 ties, weights sum to 63 (R32 16·1 + R16 8·2 + QF 4·3 + SF 2·5 + 3rd 1·1 + Final 1·8).
eq("perfect bracket = 100%",
  strip(scorePrediction(actualTree, realityPicks)),
  { points: 63, correct: 32, decided: 32, possible: 63, pct: 100 });

eq("no picks = 0% (all ties still decided)",
  strip(scorePrediction(actualTree, {})),
  { points: 0, correct: 0, decided: 32, possible: 63, pct: 0 });

// Flip the FINAL winner only — no downstream, so lose exactly its weight (8).
const flipFinal = { ...realityPicks, 104: actualTree.get(104).b.teamId === actualTree.get(104).winner ? actualTree.get(104).a.teamId : actualTree.get(104).b.teamId };
eq("wrong final loses 8 pts, no cascade",
  strip(scorePrediction(actualTree, flipFinal)),
  { points: 55, correct: 31, decided: 32, possible: 63, pct: 87 });

// Flip an R32 winner (m73 → its loser). That sends the wrong team up the m73→m90
// path, so the m90 pick (still naming the real winner) is now invalid too:
// lose m73 (1) + m90 (2) = 3 pts, 2 ties wrong. Validates pick invalidation.
const flipR32 = { ...realityPicks, 73: seedTree.get(73).b.teamId === realityPicks[73] ? seedTree.get(73).a.teamId : seedTree.get(73).b.teamId };
eq("wrong R32 cascades to its R16 feed",
  strip(scorePrediction(actualTree, flipR32)),
  { points: 60, correct: 30, decided: 32, possible: 63, pct: 95 });

// A pick that names a team not in the tie (stale after an upstream change) never scores.
eq("garbage pick is ignored, not credited",
  scorePrediction(actualTree, { ...realityPicks, 104: "NOT_A_TEAM" }).correct, 31);

console.log(`\nprediction check: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

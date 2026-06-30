import { useState, useEffect, useLayoutEffect, useMemo, useRef, Component } from "react";
import { supabase } from "./supabase.js";

/* ============================================================
   WORLD CUP 2026 SWEEPSTAKE
   Supabase-backed. Everyone who opens the URL shares one live
   dataset. Organiser PIN gates result entry.
   ============================================================ */

const TIERS = ["Favourites", "Dark Horses", "Outsiders", "Passengers", "Cannon Fodder", "Tourists"];

const TEAMS = [
  ["esp","Spain","🇪🇸"],["fra","France","🇫🇷"],["eng","England","🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  ["arg","Argentina","🇦🇷"],["bra","Brazil","🇧🇷"],["por","Portugal","🇵🇹"],
  ["ger","Germany","🇩🇪"],["ned","Netherlands","🇳🇱"],["bel","Belgium","🇧🇪"],
  ["nor","Norway","🇳🇴"],["mar","Morocco","🇲🇦"],["col","Colombia","🇨🇴"],
  ["usa","USA","🇺🇸"],["uru","Uruguay","🇺🇾"],["jpn","Japan","🇯🇵"],
  ["mex","Mexico","🇲🇽"],["cro","Croatia","🇭🇷"],["sui","Switzerland","🇨🇭"],
  ["ecu","Ecuador","🇪🇨"],["sen","Senegal","🇸🇳"],["kor","South Korea","🇰🇷"],
  ["tur","Türkiye","🇹🇷"],["can","Canada","🇨🇦"],["aut","Austria","🇦🇹"],
  ["swe","Sweden","🇸🇪"],["civ","Ivory Coast","🇨🇮"],["cze","Czechia","🇨🇿"],
  ["sco","Scotland","🏴󠁧󠁢󠁳󠁣󠁴󠁿"],["aus","Australia","🇦🇺"],["par","Paraguay","🇵🇾"],
  ["irn","Iran","🇮🇷"],["bih","Bosnia","🇧🇦"],["ksa","Saudi Arabia","🇸🇦"],
  ["tun","Tunisia","🇹🇳"],["gha","Ghana","🇬🇭"],["egy","Egypt","🇪🇬"],
  ["alg","Algeria","🇩🇿"],["uzb","Uzbekistan","🇺🇿"],["cod","DR Congo","🇨🇩"],
  ["nzl","New Zealand","🇳🇿"],["cpv","Cape Verde","🇨🇻"],["jor","Jordan","🇯🇴"],
  ["rsa","South Africa","🇿🇦"],["pan","Panama","🇵🇦"],["irq","Iraq","🇮🇶"],
  ["qat","Qatar","🇶🇦"],["cuw","Curaçao","🇨🇼"],["hai","Haiti","🇭🇹"],
].map(([id, name, flag], i) => ({ id, name, flag, rank: i + 1, tier: Math.min(5, Math.floor(i / 8)) }));

const TEAM = Object.fromEntries(TEAMS.map(t => [t.id, t]));

/* ---- draw import helpers ---- */

function findTeamId(cell) {
  if (!cell) return null;
  // Strip non-ASCII (emoji / flag sequences) to get the plain Latin name
  const stripped = cell.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const t of TEAMS) {
    const tStripped = t.name.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (stripped === tStripped) return t.id;
  }
  // Fallback: substring match (handles "France 🇫🇷" containing "France")
  const cellLower = cell.toLowerCase();
  for (const t of TEAMS) {
    if (cellLower.includes(t.name.toLowerCase())) return t.id;
  }
  return null;
}

function parseDrawTable(text) {
  if (!text.trim()) return { error: "Paste your draw table first." };
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: "Need at least a header row and one participant." };
  // Auto-detect and skip header row
  const firstCols = lines[0].split("\t").map(s => s.trim());
  const firstCell = firstCols[0].toLowerCase();
  const hasHeader =
    firstCell === "participant" || firstCell === "name" || firstCell === "player" ||
    (firstCols[1] && !findTeamId(firstCols[1]));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  if (dataLines.length < 2) return { error: "Need at least two participants." };
  const stamp = Date.now().toString(36);
  const parts = [];
  const assignments = {};
  const errors = [];
  dataLines.forEach((line, i) => {
    const cols = line.split("\t").map(s => s.trim());
    if (cols.length < 2) return;
    const name = cols[0];
    if (!name) return;
    const id = `p${i}_${stamp}`;
    parts.push({ id, name });
    const teamIds = [];
    for (let ci = 1; ci < cols.length; ci++) {
      const cell = cols[ci];
      if (!cell) continue;
      const tid = findTeamId(cell);
      if (tid) teamIds.push(tid);
      else errors.push(`"${cell}" not recognised (${name})`);
    }
    assignments[id] = teamIds;
  });
  if (parts.length < 2) return { error: "Could not parse participants — check the format." };
  const teamsPer = Math.max(...Object.values(assignments).map(a => a.length));
  return { parts, assignments, teamsPer, errors };
}

function parseResultsText(text, existingResults = []) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = [];
  const errors = [];
  const dupes  = [];

  for (const line of lines) {
    if (/^[#/]/.test(line)) continue;
    const m = line.match(
      /^(GROUP|R32|R16|QF|SF|THIRD|FINAL):\s*(.+?)\s+(\d+)\s*[-\u2013\u2014]\s*(\d+)\s+(.+?)(?:\s*\(pens:\s*(.+?)\))?(?:\s+reds:(\d+)-(\d+))?\s*$/i
    );
    if (!m) { errors.push(`Couldn't parse: "${line}"`); continue; }

    const [, stage, rawA, scoreA, scoreB, rawB, rawPens, rawRedsA, rawRedsB] = m;
    const teamA = findTeamId(rawA.trim());
    const teamB = findTeamId(rawB.trim());

    if (!teamA) { errors.push(`Team not recognised: "${rawA.trim()}"`); continue; }
    if (!teamB) { errors.push(`Team not recognised: "${rawB.trim()}"`); continue; }

    const stageUp = stage.toUpperCase();
    const isKo    = STAGE[stageUp]?.ko;
    const sA      = parseInt(scoreA, 10);
    const sB      = parseInt(scoreB, 10);

    let pensWinner = null;
    if (rawPens) {
      const pid = findTeamId(rawPens.trim());
      if (pid) pensWinner = pid;
      else errors.push(`Pens winner not recognised: "${rawPens.trim()}"`);
    }

    if (isKo && sA === sB && !pensWinner) {
      errors.push(`Knockout draw needs a pens winner: "${line}"`);
      continue;
    }

    const isDupe = existingResults.some(e =>
      e.stage === stageUp &&
      ((e.teamA === teamA && e.teamB === teamB) ||
       (e.teamA === teamB && e.teamB === teamA))
    );
    if (isDupe) {
      dupes.push(`${TEAM[teamA]?.name} v ${TEAM[teamB]?.name} (${STAGE[stageUp]?.short})`);
      continue;
    }

    parsed.push({
      id: 'imp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      stage: stageUp, teamA, teamB,
      scoreA: sA, scoreB: sB,
      redsA: rawRedsA ? parseInt(rawRedsA, 10) : 0,
      redsB: rawRedsB ? parseInt(rawRedsB, 10) : 0,
      pensWinner: isKo && sA === sB ? pensWinner : null,
      at: new Date().toISOString(),
    });
  }

  return { parsed, errors, dupes };
}

const STAGES = [
  { id: "GROUP", label: "Group stage",    short: "GRP", ko: false },
  { id: "R32",   label: "Round of 32",    short: "R32", ko: true  },
  { id: "R16",   label: "Round of 16",    short: "R16", ko: true  },
  { id: "QF",    label: "Quarter-final",  short: "QF",  ko: true  },
  { id: "SF",    label: "Semi-final",     short: "SF",  ko: true  },
  { id: "THIRD", label: "Third place",    short: "3RD", ko: true  },
  { id: "FINAL", label: "Final",          short: "FIN", ko: true  },
];
const STAGE = Object.fromEntries(STAGES.map(s => [s.id, s]));

/* ---- API-Football name → internal team id ---- */
const API_TEAM_MAP = {
  "Spain":"esp","France":"fra","England":"eng","Argentina":"arg","Brazil":"bra",
  "Portugal":"por","Germany":"ger","Netherlands":"ned","Belgium":"bel","Norway":"nor",
  "Morocco":"mar","Colombia":"col","USA":"usa","United States":"usa","Uruguay":"uru",
  "Japan":"jpn","Mexico":"mex","Croatia":"cro","Switzerland":"sui","Ecuador":"ecu",
  "Senegal":"sen","Korea Republic":"kor","South Korea":"kor","Turkiye":"tur",
  "Türkiye":"tur","Turkey":"tur","Canada":"can","Austria":"aut","Sweden":"swe",
  "Ivory Coast":"civ","Cote d'Ivoire":"civ","Côte d'Ivoire":"civ","Czechia":"cze",
  "Czech Republic":"cze","Scotland":"sco","Australia":"aus","Paraguay":"par",
  "Iran":"irn","Bosnia":"bih","Bosnia and Herzegovina":"bih","Bosnia-Herzegovina":"bih","Saudi Arabia":"ksa",
  "Tunisia":"tun","Ghana":"gha","Egypt":"egy","Algeria":"alg","Uzbekistan":"uzb",
  "DR Congo":"cod","Congo DR":"cod","New Zealand":"nzl","Cape Verde":"cpv",
  "Jordan":"jor","South Africa":"rsa","Panama":"pan","Iraq":"irq","Qatar":"qat",
  "Curacao":"cuw","Curaçao":"cuw","Haiti":"hai",
};
function apiTeamId(name) { return API_TEAM_MAP[name] || null; }

function apiRoundToStage(round) {
  if (!round) return "GROUP";
  const r = round.toLowerCase();
  if (r.includes("group"))           return "GROUP";
  if (r.includes("32") || r.includes("round of 32")) return "R32";
  if (r.includes("16") || r.includes("round of 16")) return "R16";
  if (r.includes("quarter"))         return "QF";
  if (r.includes("semi"))            return "SF";
  if (r.includes("third") || r.includes("3rd") || r.includes("place")) return "THIRD";
  if (r.includes("final"))           return "FINAL";
  return "GROUP";
}

// Penalty-shootout winner for an ESPN match, or null. ESPN reports the
// regulation/ET score (e.g. 1-1) and the shootout separately on each competitor
// (`shootoutScore`), forwarded by the proxy as home/awayShootout. Only a LEVEL
// knockout tie is settled on pens — group games and clear KO wins resolve from
// the score (via koWinner), so this stays null for them. `hId`/`aId` are the
// home/away team ids, matching the home/away shootout fields.
function apiPensWinner(m, hId, aId) {
  if (!STAGE[apiRoundToStage(m.round)]?.ko) return null;
  if ((Number(m.homeScore) || 0) !== (Number(m.awayScore) || 0)) return null;
  // Guard nulls BEFORE coercing — Number(null) is 0, which would pass a finite
  // check and pick a winner of a non-existent shootout. Then coerce: ESPN gives
  // no type contract (scores arrive as strings), so a string compare would rank
  // "10" below "9" and crown the loser of a double-digit shootout.
  if (m.homeShootout == null || m.awayShootout == null) return null;
  const ph = Number(m.homeShootout), pa = Number(m.awayShootout);
  if (!Number.isFinite(ph) || !Number.isFinite(pa) || ph === pa) return null;
  return ph > pa ? hId : aId;
}

function apiFixturesToPasteText(matches) {
  return matches.map(m => {
    const hId = apiTeamId(m.homeTeam);
    const aId = apiTeamId(m.awayTeam);
    if (!hId || !aId) return null;
    const hName = TEAM[hId]?.name || m.homeTeam;
    const aName = TEAM[aId]?.name || m.awayTeam;
    return `GROUP: ${hName} ${m.homeScore ?? 0}-${m.awayScore ?? 0} ${aName}`;
  }).filter(Boolean).join("\n");
}

// Derive group winners + group-stage eliminations from the ESPN standings feed
// (the /standings function's `{ groups }` payload). Only acts on COMPLETED groups
// so a winner/exit is never guessed mid-group. Returns id→true maps + any ESPN
// names we couldn't map (golden rule: an unmapped team would otherwise vanish
// silently).
//
// Elimination is deliberately conservative because eliminations are STICKY (the
// merge never clears them). We only mark a team out when it is *certainly* out:
//   - rank 4 of its group — 4th of 4 never qualifies, decidable per-group; OR
//   - any non-advanced team once EVERY group is complete — because WC26 sends the
//     8 best third-placed teams through, and that isn't settled until all groups
//     finish. Marking a not-yet-decided 3rd-placed team out early (on ESPN's
//     interim `advanced` flag) would wrongly, and permanently, eliminate a team
//     that still qualifies.
function deriveFromStandings(groups) {
  const winners = {}, eliminated = {}, unmapped = [];
  const list = groups || [];
  const allComplete = list.length > 0 && list.every(g => g.complete);
  for (const g of list) {
    if (!g.complete) continue;
    for (const t of g.teams || []) {
      const id = apiTeamId(t.name);
      if (!id) { unmapped.push(t.name); continue; }
      if (t.rank === 1) winners[id] = true;
      if (t.rank === 4 || (allComplete && !t.advanced)) eliminated[id] = true;
    }
  }
  return { winners, eliminated, unmapped };
}

// ── Round of 32 bracket (FIFA's pre-published structure) ──────────────────────
// Each tie is defined by the group POSITIONS that feed it, fixed in advance — so
// winners/runners-up auto-fill the moment a group ends. Slot shapes:
//   {w:"E"} group winner · {r:"C"} runner-up · {third:[...candidates]} best-third.
// Third slots only resolve once all 12 groups finish and the realised combination
// is known (FIFA Annexe C, 495 possible). ESPN R32 fixtures are the source of
// truth and OVERRIDE this once published — so any error here self-heals.
const R32_BRACKET = [
  { m: 73, a: { r: "A" }, b: { r: "B" } },
  { m: 74, a: { w: "E" }, b: { third: ["A","B","C","D","F"] } },
  { m: 75, a: { w: "F" }, b: { r: "C" } },
  { m: 76, a: { w: "C" }, b: { r: "F" } },
  { m: 77, a: { w: "I" }, b: { third: ["C","D","F","G","H"] } },
  { m: 78, a: { r: "E" }, b: { r: "I" } },
  { m: 79, a: { w: "A" }, b: { third: ["C","E","F","H","I"] } },
  { m: 80, a: { w: "L" }, b: { third: ["E","H","I","J","K"] } },
  { m: 81, a: { w: "D" }, b: { third: ["B","E","F","I","J"] } },
  { m: 82, a: { w: "G" }, b: { third: ["A","E","H","I","J"] } },
  { m: 83, a: { r: "K" }, b: { r: "L" } },
  { m: 84, a: { w: "H" }, b: { r: "J" } },
  { m: 85, a: { w: "B" }, b: { third: ["E","F","G","I","J"] } },
  { m: 86, a: { w: "J" }, b: { r: "H" } },
  { m: 87, a: { w: "K" }, b: { third: ["D","E","I","J","L"] } },
  { m: 88, a: { r: "D" }, b: { r: "G" } },
];

// Map position keys ("A1"/"A2"/"A3") to team ids from the live /standings payload.
// COMPLETE groups only — a winner/runner-up/third is never guessed mid-group.
function standingsPositions(groups) {
  const pos = {};
  for (const g of groups || []) {
    if (!g.complete) continue;
    const letter = ((String(g.name).match(/([A-L])\s*$/i) || [])[1] || "").toUpperCase();
    if (!letter) continue;
    for (const t of g.teams || []) {
      const id = apiTeamId(t.name);
      if (!id) continue;
      if (t.rank === 1) pos[letter + "1"] = id;
      else if (t.rank === 2) pos[letter + "2"] = id;
      else if (t.rank === 3) pos[letter + "3"] = id;
    }
  }
  return pos;
}

// Resolve the 16 R32 ties from live standings + the realised third-place
// combination (`thirdCombo`: { matchNumber: groupLetter }). Unknown sides come
// back as { teamId: null, label } so the UI can show a placeholder.
function resolveBracket(groups, thirdCombo) {
  const pos = standingsPositions(groups);
  const side = (m, s) => {
    if (s.w) return { kind: "w", teamId: pos[s.w + "1"] || null, label: `Winner ${s.w}` };
    if (s.r) return { kind: "r", teamId: pos[s.r + "2"] || null, label: `Runner-up ${s.r}` };
    const fromGroup = thirdCombo?.[m];
    return { kind: "third", teamId: fromGroup ? (pos[fromGroup + "3"] || null) : null, label: `3rd ${s.third.join("/")}` };
  };
  return R32_BRACKET.map(t => ({ m: t.m, a: side(t.m, t.a), b: side(t.m, t.b) }));
}

// Knockout flow after the R32. Each side feeds from the WINNER (`w`) or LOSER
// (`l`) of an earlier match number, so every later slot fills as results land.
// `stage` drives the result lookup. FIFA's published tree (validated: the two SF
// subtrees are disjoint and together cover all 16 R32 ties).
const KO_FLOW = [
  { m: 89,  stage: "R16",   a: { w: 74 },  b: { w: 77 } },
  { m: 90,  stage: "R16",   a: { w: 73 },  b: { w: 75 } },
  { m: 91,  stage: "R16",   a: { w: 76 },  b: { w: 78 } },
  { m: 92,  stage: "R16",   a: { w: 79 },  b: { w: 80 } },
  { m: 93,  stage: "R16",   a: { w: 83 },  b: { w: 84 } },
  { m: 94,  stage: "R16",   a: { w: 81 },  b: { w: 82 } },
  { m: 95,  stage: "R16",   a: { w: 86 },  b: { w: 88 } },
  { m: 96,  stage: "R16",   a: { w: 85 },  b: { w: 87 } },
  { m: 97,  stage: "QF",    a: { w: 89 },  b: { w: 90 } },
  { m: 98,  stage: "QF",    a: { w: 93 },  b: { w: 94 } },
  { m: 99,  stage: "QF",    a: { w: 91 },  b: { w: 92 } },
  { m: 100, stage: "QF",    a: { w: 95 },  b: { w: 96 } },
  { m: 101, stage: "SF",    a: { w: 97 },  b: { w: 98 } },
  { m: 102, stage: "SF",    a: { w: 99 },  b: { w: 100 } },
  { m: 103, stage: "THIRD", a: { l: 101 }, b: { l: 102 } },
  { m: 104, stage: "FINAL", a: { w: 101 }, b: { w: 102 } },
];
const KO_BY_NUM = new Map(KO_FLOW.map(d => [d.m, d]));

// Two-sided tree layout (match numbers top→bottom, ordered so a pure flex
// `space-around` centres each match between its two feeders). Left and right
// halves are the two SF subtrees; centre holds the Final + third-place game.
const BRACKET_COLUMNS = {
  left: [
    { stage: "R32", ms: [74, 77, 73, 75, 83, 84, 81, 82] },
    { stage: "R16", ms: [89, 90, 93, 94] },
    { stage: "QF",  ms: [97, 98] },
    { stage: "SF",  ms: [101] },
  ],
  center: [104], // third-place game (103) renders separately below the tree
  right: [
    { stage: "SF",  ms: [102] },
    { stage: "QF",  ms: [99, 100] },
    { stage: "R16", ms: [91, 92, 95, 96] },
    { stage: "R32", ms: [76, 78, 79, 80, 86, 88, 85, 87] },
  ],
};

// ESPN R32-fixture override for a third-place slot: fill/correct it from the real
// opponent of its (deterministic) winner partner. `byTeam`: team id → R32 opponent.
function overrideThird(s, partner, byTeam) {
  if (s.kind !== "third") return s;
  const opp = partner.teamId ? byTeam.get(partner.teamId) : null;
  return opp ? { ...s, teamId: opp } : s;
}

// Resolve the WHOLE knockout tree (matches 73–104). R32 teams come from standings
// + the realised third combo + ESPN R32 override (`byTeam`); every later slot
// fills from the winner (SF losers → third place) of its feeders. Winners
// propagate only from FINISHED matches (`resultIndex` entry with `done`) — a live
// match never advances a team. Returns Map(matchNumber → resolved match).
function resolveBracketTree(groups, thirdCombo, byTeam, resultIndex) {
  const r32ByNum = new Map(resolveBracket(groups, thirdCombo).map(t => [t.m, t]));
  const out = new Map();
  const winnerOf = {}, loserOf = {};
  const keyFor = (stage, a, b) => `${stage}|${[a, b].sort().join("|")}`;
  const feeder = (f) => f.w != null
    ? { teamId: winnerOf[f.w] ?? null, label: `Winner M${f.w}` }
    : { teamId: loserOf[f.l] ?? null, label: `Loser M${f.l}` };

  // Ascending order guarantees every feeder is resolved before its dependants.
  for (let m = 73; m <= 104; m++) {
    let stage, a, b;
    if (r32ByNum.has(m)) {
      const t = r32ByNum.get(m);
      stage = "R32"; a = overrideThird(t.a, t.b, byTeam); b = overrideThird(t.b, t.a, byTeam);
    } else {
      const def = KO_BY_NUM.get(m);
      stage = def.stage; a = feeder(def.a); b = feeder(def.b);
    }
    const res = (a.teamId && b.teamId) ? resultIndex.get(keyFor(stage, a.teamId, b.teamId)) : null;
    let winner = null, loser = null;
    if (res && res.done) {
      winner = koWinner(res) || null;
      loser = winner ? (winner === res.teamA ? res.teamB : res.teamA) : null;
    }
    winnerOf[m] = winner; loserOf[m] = loser;
    out.set(m, { m, stage, a, b, winner, loser, result: res || null });
  }
  return out;
}

// ── Predictions ───────────────────────────────────────────────────────────────
// A prediction is a full set of knockout winners — structurally the same shape the
// real bracket produces, but the winner of each tie comes from the predictor's
// `picks` ({ matchNumber: teamId }) instead of a result. This is the sibling of
// `resolveBracketTree`: the R32 sides come from the ACTUAL seeded tree (so everyone
// predicts the same real opponents), then each pick propagates up the same FIFA
// tree. A pick only counts if it names one of the two teams actually in that tie —
// flipping an earlier round silently invalidates now-impossible later picks.
function resolvePredictionTree(actualTree, picks) {
  const out = new Map();
  const winnerOf = {}, loserOf = {};
  const pk = picks || {};
  for (let m = 73; m <= 104; m++) {
    let stage, a, b;
    if (m <= 88) {
      const t = actualTree.get(m);
      stage = "R32";
      a = { teamId: t?.a.teamId || null, label: t?.a.label };
      b = { teamId: t?.b.teamId || null, label: t?.b.label };
    } else {
      const def = KO_BY_NUM.get(m);
      stage = def.stage;
      // Feeder side = this predictor's own pick for the feeding tie. But if they
      // never picked it AND that tie is already decided (a late entrant who missed
      // an earlier knockout game), fall back to who ACTUALLY advanced — otherwise a
      // single missed early game would kill the whole branch above it.
      const feeder = (f) => f.w != null
        ? { teamId: winnerOf[f.w] ?? actualTree.get(f.w)?.winner ?? null, label: `Winner M${f.w}` }
        : { teamId: loserOf[f.l] ?? actualTree.get(f.l)?.loser ?? null, label: `Loser M${f.l}` };
      a = feeder(def.a); b = feeder(def.b);
    }
    const pick = pk[m] || null;
    const winner = (pick && (pick === a.teamId || pick === b.teamId)) ? pick : null;
    const loser = winner ? (winner === a.teamId ? b.teamId : a.teamId) : null;
    winnerOf[m] = winner; loserOf[m] = loser;
    out.set(m, { m, stage, a, b, winner, loser });
  }
  return out;
}

// Points per correctly-picked tie winner, weighted by how far through the bracket
// it is (a correct final is worth more than a correct R32). Tunable later, but a
// sane default needs no config.
const PREDICTION_WEIGHTS = { R32: 1, R16: 2, QF: 3, SF: 5, THIRD: 1, FINAL: 8 };

// Score one prediction against the actual tree. Only DECIDED ties count (the live
// percentage climbs as results land). `pct` is weighted points earned / available.
function scorePrediction(actualTree, picks) {
  const predTree = resolvePredictionTree(actualTree, picks);
  let points = 0, correct = 0, decided = 0, possible = 0;
  for (let m = 73; m <= 104; m++) {
    const actual = actualTree.get(m);
    if (!actual || !actual.winner) continue;
    const w = PREDICTION_WEIGHTS[actual.stage] || 1;
    decided++; possible += w;
    if (predTree.get(m)?.winner === actual.winner) { points += w; correct++; }
  }
  return { points, correct, decided, possible, pct: possible ? Math.round((points / possible) * 100) : 0, predTree };
}

// Union derived facts into a sweep's stored maps. Additive ONLY — never clears a
// flag, so a manual override is preserved. Returns the next maps + a changed flag.
function mergeDerived(st, winners, eliminated) {
  const groupWinners = { ...(st.groupWinners || {}) };
  const elim = { ...(st.eliminated || {}) };
  let changed = false;
  for (const id in winners) if (!groupWinners[id]) { groupWinners[id] = true; changed = true; }
  for (const id in eliminated) if (!elim[id]) { elim[id] = true; changed = true; }
  return { groupWinners, eliminated: elim, changed };
}

const DEFAULT_SCORING = {
  win: 5, draw: 2, goal: 1, conceded: -1, cleanSheet: 2, redCard: -3, groupWin: 3, roundWin: 5,
};
const SCORING_LABELS = {
  win: "Win", draw: "Draw", goal: "Goal scored", conceded: "Goal conceded",
  cleanSheet: "Clean sheet", redCard: "Red card", groupWin: "Won group", roundWin: "Knockout round won",
};

/* ---- Supabase storage (multi-sweepstake, keyed by view PIN) ----
   Each sweepstake's row id IS its view PIN — so "type a PIN, see that
   sweepstake" is a single indexed lookup. The legacy "wc2026" row is
   still reachable via a fallback scan on data.pin. ---- */

// Load by view PIN. Tries id match first, then legacy data.pin fallback.
async function loadByPin(pin) {
  const key = (pin || "").trim();
  if (!key) return null;
  // Primary: row id === view PIN
  const { data, error } = await supabase
    .from("sweepstake")
    .select("id, data")
    .eq("id", key)
    .maybeSingle();
  if (!error && data) return { id: data.id, state: data.data };
  // Fallback: legacy rows where the PIN lived inside data.pin
  const { data: legacy } = await supabase
    .from("sweepstake")
    .select("id, data")
    .eq("data->>pin", key)
    .limit(1)
    .maybeSingle();
  if (legacy) return { id: legacy.id, state: legacy.data };
  return null;
}

// Load a known sweepstake by its row id (used by the switcher / remembered list).
async function loadById(id) {
  const { data, error } = await supabase
    .from("sweepstake")
    .select("id, data")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, state: data.data };
}

// Does a sweepstake already exist with this view PIN / id?
async function pinExists(pin) {
  const hit = await loadByPin(pin);
  return !!hit;
}

async function saveSweep(id, state) {
  const { error } = await supabase
    .from("sweepstake")
    .upsert({ id, data: state, updated_at: new Date().toISOString() });
  return !error;
}

async function deleteSweep(id) {
  await supabase.from("sweepstake").delete().eq("id", id);
}

/* ---- device memory: remember unlocked sweepstakes ---- */

const REMEMBER_KEY = "wc26_known_sweeps";

function loadKnownSweeps() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// entry: { id, name, viewPin }
function rememberSweep(entry) {
  try {
    const list = loadKnownSweeps().filter(s => s.id !== entry.id);
    list.unshift(entry);
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* ignore */ }
}

function forgetSweep(id) {
  try {
    const list = loadKnownSweeps().filter(s => s.id !== id);
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/* ---- helpers ---- */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function runDraw(names, teamsPer) {
  const stamp = Date.now().toString(36);
  const parts = names.map((name, i) => ({ id: `p${i}_${stamp}`, name }));
  const assignments = {};
  parts.forEach(p => (assignments[p.id] = []));
  for (let r = 0; r < teamsPer; r++) {
    const band = shuffle(
      TEAMS.slice(r * parts.length, r * parts.length + parts.length).map(t => t.id)
    );
    parts.forEach((p, i) => assignments[p.id].push(band[i]));
  }
  return { parts, assignments };
}

function koWinner(m) {
  if (m.scoreA > m.scoreB) return m.teamA;
  if (m.scoreB > m.scoreA) return m.teamB;
  return m.pensWinner || null;
}

function teamMatchPts(teamId, m, sc) {
  const isA = m.teamA === teamId;
  if (!isA && m.teamB !== teamId) return 0;
  const gf = isA ? m.scoreA : m.scoreB;
  const ga = isA ? m.scoreB : m.scoreA;
  const reds = (isA ? m.redsA : m.redsB) || 0;
  let pts = gf * sc.goal + ga * sc.conceded + (ga === 0 ? sc.cleanSheet : 0) + reds * sc.redCard;
  if (m.stage === "GROUP") {
    if (gf > ga) pts += sc.win;
    else if (gf === ga) pts += sc.draw;
  } else {
    if (koWinner(m) === teamId) pts += sc.win + sc.roundWin;
  }
  return pts;
}

function buildStats(state) {
  const sc = { ...DEFAULT_SCORING, ...(state.scoring || {}) };
  const teamPts = {};
  const eliminated = new Set(
    Object.keys(state.eliminated || {}).filter(k => state.eliminated[k])
  );
  const ownedTeams = new Set(Object.values(state.assignments).flat());
  ownedTeams.forEach(t => (teamPts[t] = 0));
  (state.results || []).forEach(m => {
    [m.teamA, m.teamB].forEach(t => {
      if (ownedTeams.has(t)) teamPts[t] = (teamPts[t] || 0) + teamMatchPts(t, m, sc);
    });
    if (m.stage !== "GROUP" && !m.live) {
      const w = koWinner(m);
      const loser = w === m.teamA ? m.teamB : w === m.teamB ? m.teamA : null;
      if (loser) eliminated.add(loser);
    }
  });
  Object.keys(state.groupWinners || {}).forEach(t => {
    if (state.groupWinners[t] && ownedTeams.has(t))
      teamPts[t] = (teamPts[t] || 0) + sc.groupWin;
  });
  const players = state.parts
    .map(p => {
      const teams = state.assignments[p.id] || [];
      const total = teams.reduce((s, t) => s + (teamPts[t] || 0), 0);
      const alive = teams.filter(t => !eliminated.has(t)).length;
      return { ...p, teams, total, alive };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  players.forEach((p, i) => {
    if (p.total !== prev) { rank = i + 1; prev = p.total; }
    p.rank = rank;
  });
  return { teamPts, eliminated, players, sc, ownedTeams };
}

/* ---- matchday commentary ---- */
// No AI, no em-dashes. Short sentences, varied templates.
// Seed picks between variants using player name so the same
// player always gets the same template style (feels consistent).

function generateCommentary(players, previousRankings) {
  if (!players.length) return "No players in the draw yet.";
  if (players[0].total === 0) return "Everyone on zero. It all starts here.";

  const total = players.length;
  const leader = players[0];
  const last = players[total - 1];

  // No previous snapshot — describe current table
  if (!previousRankings || Object.keys(previousRankings).length === 0) {
    const lead = leader.total - (players[1]?.total ?? 0);
    if (lead === 0 && players[1]) {
      return `Level at the top. ${leader.total} points apiece for ${leader.name} and ${players[1].name}.`;
    }
    if (lead >= 15) return `${leader.name} out in front on ${leader.total}. ${lead} the gap already.`;
    return `${leader.name} leads on ${leader.total}. ${lead === 1 ? "A single point" : lead + " points"} clear.`;
  }

  // Find biggest rank movers since last report
  let biggestClimber = null, biggestFaller = null;
  let maxClimb = 0, maxFall = 0;

  players.forEach(p => {
    const prev = previousRankings[p.id];
    if (!prev) return;
    const change = prev.rank - p.rank; // positive = climbed
    if (change > maxClimb) { maxClimb = change; biggestClimber = { ...p, change }; }
    if (-change > maxFall) { maxFall = -change; biggestFaller = { ...p, change }; }
  });

  const gap = leader.total - last.total;
  const lead = leader.total - (players[1]?.total ?? 0);

  if (biggestClimber && maxClimb >= 2) {
    const n = maxClimb;
    const s = n === 1 ? "" : "s";
    const pick = biggestClimber.name.charCodeAt(0) % 4;
    return [
      `${biggestClimber.name} up ${n} place${s} overnight. Worth watching.`,
      `${biggestClimber.name} on the move. Up ${n} since the last update.`,
      `${n} spot${s} gained for ${biggestClimber.name}. The table is shifting.`,
      `${biggestClimber.name} quietly climbing. Up ${n} place${s} from last time.`,
    ][pick];
  }

  if (biggestFaller && maxFall >= 2) {
    const n = maxFall;
    const s = n === 1 ? "" : "s";
    const pick = biggestFaller.name.charCodeAt(0) % 4;
    return [
      `${biggestFaller.name} drops ${n} place${s}. A rough matchday.`,
      `Down ${n} for ${biggestFaller.name} since the last report.`,
      `Hard session for ${biggestFaller.name}. Slipped ${n} in the table.`,
      `${biggestFaller.name} falls ${n}. The table is unforgiving.`,
    ][pick];
  }

  if (lead >= 20) return `${leader.name} pulling clear. ${lead} points out in front now.`;

  if (gap <= 8 && total >= 4) {
    return `${gap} point${gap === 1 ? "" : "s"} cover the whole field. Still completely open.`;
  }

  if (lead <= 2 && players[1]) {
    const word = lead === 0 ? "Dead level" : "Almost level";
    return `${word} at the top between ${leader.name} and ${players[1].name}.`;
  }

  return `${leader.name} leads on ${leader.total}. ${last.name} is ${leader.total - last.total} back.`;
}

/* ---- canvas share card ---- */

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function hline(ctx, x1, x2, y) {
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

function buildShareCanvas(players, commentary, sweepstakeName, eliminated) {
  // Palette — Paper + England Red
  const C = {
    bg:         "#EDE6DC",
    card:       "#FFFFFF",
    accent:     "#C8000A",
    ink:        "#141414",
    muted:      "#B0A89E",
    line:       "#E5DDD3",
    rank:       "#DDD6CE",
    track:      "#F2ECE5",
    accentSoft: "#fce8e9",
  };

  const W        = 600;
  const HDR_H    = 54;   // accent header bar
  const SUB_H    = 38;   // leader-eyebrow / sweepname sub-row
  const BAR_H    = 3;
  const ROW_H    = 62;
  const COMM_H   = 68;
  const FOOTER_H = 32;
  const H = HDR_H + SUB_H + players.length * (ROW_H + BAR_H) + COMM_H + FOOTER_H;

  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // ── Paper background ──────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Accent header bar ─────────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, W, HDR_H);

  // WC26 badge (white bg, red text)
  ctx.fillStyle = "#FFFFFF";
  rrect(ctx, 16, 13, 52, 28, 4);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.font = "700 13px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WC26", 42, 27);

  // Sweep name
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 17px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(sweepstakeName, 80, HDR_H / 2);

  // Date (right)
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "500 11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    W - 16, HDR_H / 2
  );

  // ── Sub-row (standings label + LIVE dot) ──────────────────────
  const subY = HDR_H;
  ctx.fillStyle = C.card;
  ctx.fillRect(0, subY, W, SUB_H);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  hline(ctx, 0, W, subY + SUB_H);

  ctx.fillStyle = C.accent;
  ctx.font = "700 9px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("STANDINGS · GROUP STAGE", 16, subY + SUB_H / 2);

  // LIVE dot
  ctx.beginPath();
  ctx.arc(W - 30, subY + SUB_H / 2, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = "700 9px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("LIVE", W - 16, subY + SUB_H / 2);

  // ── Player rows ───────────────────────────────────────────────
  const leaderPts = players[0]?.total ?? 0;

  players.forEach((p, i) => {
    const rowY   = HDR_H + SUB_H + i * (ROW_H + BAR_H);
    const midY   = rowY + ROW_H / 2;
    const isLeader = i === 0 && p.total > 0;

    // Card background
    ctx.fillStyle = isLeader ? C.accentSoft : C.card;
    ctx.fillRect(0, rowY, W, ROW_H);

    // Leader: left accent stripe
    if (isLeader) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(0, rowY, 4, ROW_H);
    }

    // Rank
    ctx.fillStyle = isLeader ? C.accent : C.rank;
    ctx.font = "700 20px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.rank), 36, midY - 6);

    // Name
    ctx.fillStyle = C.ink;
    ctx.font = "700 15px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(p.name, 58, midY - 8);

    // Alive count
    ctx.fillStyle = C.muted;
    ctx.font = "500 11px -apple-system, system-ui, sans-serif";
    ctx.fillText(`${p.alive} alive`, 58, midY + 9);

    // Team flags
    const aliveTeams = p.teams.filter(t => !eliminated.has(t));
    const deadTeams  = p.teams.filter(t => eliminated.has(t));
    ctx.font = `13px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textBaseline = "middle";
    let fx = 180;
    ctx.globalAlpha = 1;
    for (const tid of aliveTeams) {
      const t = TEAM[tid]; if (!t || fx > W - 100) continue;
      ctx.fillText(t.flag, fx, midY - 2); fx += 20;
    }
    ctx.globalAlpha = 0.3;
    for (const tid of deadTeams) {
      const t = TEAM[tid]; if (!t || fx > W - 100) continue;
      ctx.fillText(t.flag, fx, midY - 2); fx += 20;
    }
    ctx.globalAlpha = 1;

    // Points
    ctx.fillStyle = isLeader ? C.accent : C.ink;
    ctx.font = `700 22px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.total), W - 16, midY - 6);

    // Gap to leader
    if (!isLeader && leaderPts > 0) {
      ctx.fillStyle = C.muted;
      ctx.font = "500 10px -apple-system, system-ui, sans-serif";
      ctx.fillText(`−${leaderPts - p.total}`, W - 16, midY + 10);
    }

    // Row bottom border
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    hline(ctx, 0, W, rowY + ROW_H);

    // Progress bar
    const barY = rowY + ROW_H;
    ctx.fillStyle = C.track;
    ctx.fillRect(0, barY, W, BAR_H);
    if (leaderPts > 0) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(0, barY, W * (p.total / leaderPts), BAR_H);
    }
  });

  // ── Commentary ────────────────────────────────────────────────
  const commY = HDR_H + SUB_H + players.length * (ROW_H + BAR_H);
  ctx.fillStyle = C.card;
  ctx.fillRect(0, commY, W, COMM_H);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  hline(ctx, 0, W, commY);

  ctx.font = `14px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("⚽", 16, commY + 30);

  ctx.fillStyle = C.muted;
  ctx.font = "italic 400 12.5px -apple-system, system-ui, sans-serif";
  wrapText(ctx, commentary, 38, commY + 28, W - 54, 19);

  // ── Footer ────────────────────────────────────────────────────
  const footY = commY + COMM_H;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, footY, W, FOOTER_H);
  hline(ctx, 0, W, footY);

  ctx.fillStyle = C.muted;
  ctx.font = "600 10px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sweepstakeName.toUpperCase(), W / 2, footY + FOOTER_H / 2);

  return canvas;
}

/* ---- utility ---- */
const cls = (...xs) => xs.filter(Boolean).join(" ");

/* ============================================================
   COMPONENTS
   ============================================================ */

class ErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", gap:14, color:"#EDF3EC",
          background:"#0A1B12", padding:24, textAlign:"center" }}>
          <div style={{ fontWeight:700 }}>Something broke.</div>
          <button onClick={() => window.location.reload()}
            style={{ background:"#E9B44C", color:"#1a1407", border:"none",
              borderRadius:10, padding:"10px 20px", fontWeight:700, cursor:"pointer" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [state, setState]       = useState(null);
  const [sweepId, setSweepId]   = useState(null);   // row id of the loaded sweepstake
  const [phase, setPhase]       = useState("landing");
  const [tab, setTab]           = useState("table");
  const [saveStatus, setSave]   = useState("idle");
  const [unlocked, setUnlocked] = useState(false);   // organiser edit unlock
  const [showShare, setShowShare] = useState(false);
  const [known, setKnown]       = useState([]);
  const saveTimer = useRef(null);

  // On boot: read the remembered list. If the URL has ?s=<id>, try to
  // auto-open it (it'll already be in the remembered list if this device
  // has seen it). Otherwise land on the picker.
  useEffect(() => {
    const list = loadKnownSweeps();
    setKnown(list);
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get("s");
    if (urlId) {
      (async () => {
        const hit = await loadById(urlId);
        if (hit) {
          openSweep(hit.id, hit.state);
          return;
        }
        setPhase("landing");
      })();
    } else {
      setPhase("landing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-apply finished ESPN results, then group winners / exits, whenever a
  // sweep is (re-)loaded. Sequenced: standings sync re-reads each sweep fresh
  // AFTER the results sync has saved, so it never clobbers the new results.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sweepId) return;
    (async () => { await autoSyncFromESPN(); await autoSyncStandings(); })();
  }, [sweepId]);

  function openSweep(id, st) {
    setSweepId(id);
    setState(st);
    setUnlocked(!st.organiserPin);   // if no organiser PIN, editing is open
    rememberSweep({ id, name: st.name, viewPin: st.viewPin || id });
    setKnown(loadKnownSweeps());
    // reflect in URL so a refresh / shared link reopens it
    const url = new URL(window.location);
    url.searchParams.set("s", id);
    window.history.replaceState({}, "", url);
    setTab("table");
    setPhase("main");
  }

  async function commit(next) {
    setState(next);
    setSave("saving");
    const ok = await saveSweep(sweepId, next);
    setSave(ok ? "saved" : "error");
    // keep remembered name fresh
    rememberSweep({ id: sweepId, name: next.name, viewPin: next.viewPin || sweepId });
    setKnown(loadKnownSweeps());
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSave("idle"), 2500);
  }

  // Save ONE predictor's bracket. Unlike commit (which spreads in-memory state),
  // this re-reads the row fresh and merges only `predictions[playerId]` — so two
  // people submitting near-simultaneously, or a result that auto-synced in the
  // meantime, are never clobbered. Returns true on success.
  async function savePrediction(playerId, picks) {
    if (!sweepId || !playerId) return false;
    setSave("saving");
    const hit = await loadById(sweepId);
    const base = hit ? hit.state : state;
    const next = {
      ...base,
      predictions: {
        ...(base.predictions || {}),
        // Merge, don't replace: a pick saved by another device (or an earlier save)
        // is never dropped. Working picks win on conflicts. Safe because picks only
        // ever GROW — write-once means a saved tie is frozen, never removed.
        [playerId]: {
          picks: { ...(base.predictions?.[playerId]?.picks || {}), ...picks },
          savedAt: new Date().toISOString(),
        },
      },
    };
    const ok = await saveSweep(sweepId, next);
    if (ok) setState(next);   // don't show a prediction as saved if the write failed
    setSave(ok ? "saved" : "error");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSave("idle"), 2500);
    return ok;
  }

  // Adds new results to the current sweep AND silently syncs them to all other
  // sweepstakes remembered on this device. Edits/deletions stay scoped to the
  // current sweep — only brand-new results are broadcast.
  async function addResultsToAll(newResults, { updateExisting = false } = {}) {
    if (!newResults?.length) return;

    // Merge new results into an existing list. By default skips duplicates
    // (same stage + same pair of teams, either order). With updateExisting=true,
    // replaces a match if scores or red cards differ — used by auto-sync so a
    // corrected ESPN score lands without manual intervention.
    const mergeInto = (existing) => {
      let changed = false;
      const merged = [...(existing || [])];
      for (const nr of newResults) {
        const idx = merged.findIndex(er =>
          // Machine-synced results carry a stable ESPN event id, so match on it
          // first — a tie first stored under the wrong stage (e.g. a pens game
          // the old proxy mis-read as a group game) is then CORRECTED in place,
          // not duplicated. Manual results use the stage+pair identity (golden
          // rule #3); their ids never collide with an espn_ id.
          (nr.id?.startsWith("espn_") && er.id === nr.id) ||
          (er.stage === nr.stage &&
           ((er.teamA === nr.teamA && er.teamB === nr.teamB) ||
            (er.teamA === nr.teamB && er.teamB === nr.teamA)))
        );
        if (idx === -1) {
          merged.push(nr);
          changed = true;
        } else if (updateExisting && merged[idx].id?.startsWith("espn_")) {
          // Only auto-sync corrects results it placed itself. A result the
          // organiser typed or pasted (id "m…" / "imp_…") is left alone so
          // a manual fix is never silently reverted by an ESPN refresh.
          const er = merged[idx];
          // ESPN home/away may be reversed vs how this sweep stored teamA/teamB
          const flipped = er.teamA === nr.teamB;
          const scoreA = flipped ? nr.scoreB : nr.scoreA;
          const scoreB = flipped ? nr.scoreA : nr.scoreB;
          const redsA  = flipped ? nr.redsB  : nr.redsA;
          const redsB  = flipped ? nr.redsA  : nr.redsB;
          // pensWinner is a team id (position-independent, no flip). Take ESPN's
          // newly-derived winner, but never regress a known winner back to null
          // if a later poll lacks the shootout data. This lets an already-stored
          // espn_ result that stalled on a level KO tie self-heal once pens post.
          const pensWinner = nr.pensWinner ?? er.pensWinner ?? null;
          if (er.stage !== nr.stage ||
              er.scoreA !== scoreA || er.scoreB !== scoreB ||
              er.redsA  !== redsA  || er.redsB  !== redsB ||
              (er.pensWinner ?? null) !== pensWinner) {
            // Correct the stage too — a mis-staged espn_ result (GROUP→R32) heals
            // here, clearing the phantom group-draw points it was awarding.
            merged[idx] = { ...er, stage: nr.stage, scoreA, scoreB, redsA, redsB, pensWinner };
            changed = true;
          }
        }
      }
      return { results: merged, changed };
    };

    // 1) Current sweep — update the UI and save only if something changed.
    const { results: nextCurrent, changed: currentChanged } = mergeInto(state.results);
    if (currentChanged) await commit({ ...state, results: nextCurrent });

    // 2) Every OTHER sweepstake remembered on this device. Load each fresh
    //    from the server, merge the new results in, and save it back.
    const others = loadKnownSweeps().filter(k => k.id !== sweepId);
    for (const k of others) {
      const hit = await loadById(k.id);
      if (!hit) continue;
      const { results: nextResults, changed } = mergeInto(hit.state.results);
      if (changed) await saveSweep(k.id, { ...hit.state, results: nextResults });
    }
  }

  async function autoSyncFromESPN() {
    try {
      const res = await fetch('/.netlify/functions/fixtures');
      if (!res.ok) return;
      const data = await res.json();
      if (data.error) return;
      const newResults = (data.matches || [])
        .filter(m => m.statusState === 'post')
        .flatMap(m => {
          const hId = apiTeamId(m.homeTeam);
          const aId = apiTeamId(m.awayTeam);
          if (!hId || !aId) return [];
          return [{
            id: 'espn_' + m.id,
            stage: apiRoundToStage(m.round),
            teamA: hId,
            teamB: aId,
            scoreA: Number(m.homeScore) || 0,
            scoreB: Number(m.awayScore) || 0,
            redsA: m.redCardsHome || 0,
            redsB: m.redCardsAway || 0,
            pensWinner: apiPensWinner(m, hId, aId),
            at: m.date,
          }];
        });
      await addResultsToAll(newResults, { updateExisting: true });
    } catch (_) {}
  }

  // Pull ESPN group standings and write derived group winners + group-stage
  // exits to EVERY sweep this device knows (the same fact applies to all). Each
  // sweep is loaded fresh from the server before merging, so this never clobbers
  // results another sync just wrote; the merge is additive (manual flags survive).
  async function autoSyncStandings() {
    try {
      const res = await fetch('/.netlify/functions/standings');
      if (!res.ok) return;
      const data = await res.json();
      if (data.error || !data.groups) return;
      const { winners, eliminated, unmapped } = deriveFromStandings(data.groups);
      if (unmapped.length) console.warn('[standings] unmapped ESPN teams:', unmapped);
      if (!Object.keys(winners).length && !Object.keys(eliminated).length) return;
      for (const k of loadKnownSweeps()) {
        const hit = await loadById(k.id);
        if (!hit) continue;
        const m = mergeDerived(hit.state, winners, eliminated);
        if (!m.changed) continue;
        const nextState = { ...hit.state, groupWinners: m.groupWinners, eliminated: m.eliminated };
        await saveSweep(k.id, nextState);
        if (k.id === sweepId) setState(nextState);   // refresh the open sweep's UI
      }
    } catch (_) {}
  }

  async function refresh() {
    if (!sweepId) return;
    setSave("saving");
    const hit = await loadById(sweepId);
    if (hit) { setState(hit.state); if (!hit.state.organiserPin) setUnlocked(true); }
    setSave("idle");
  }

  function tryUnlock() {
    if (!state?.organiserPin) { setUnlocked(true); return; }
    const guess = window.prompt("Organiser PIN (needed to enter results):");
    if (guess === state.organiserPin) setUnlocked(true);
    else if (guess !== null) window.alert("Wrong organiser PIN.");
  }

  function goHome() {
    const url = new URL(window.location);
    url.searchParams.delete("s");
    window.history.replaceState({}, "", url);
    setSweepId(null);
    setState(null);
    setUnlocked(false);
    setKnown(loadKnownSweeps());
    setPhase("landing");
  }

  return (
    <div className="app">
      <Styles />
      <ErrorBoundary>
      {phase === "loading" && <Splash text="Warming up the floodlights…" />}

      {phase === "landing" && (
        <Landing
          known={known}
          onOpen={openSweep}
          onForget={id => { forgetSweep(id); setKnown(loadKnownSweeps()); }}
          onCreate={() => setPhase("setup")}
          onAdmin={() => setPhase("admin")}
        />
      )}

      {phase === "admin" && (
        <AdminView
          known={known}
          onOpen={openSweep}
          onForget={id => { forgetSweep(id); setKnown(loadKnownSweeps()); }}
          onBack={() => setPhase(sweepId && state ? "main" : "landing")}
        />
      )}

      {phase === "setup" && (
        <SetupScreen
          onCancel={() => setPhase("landing")}
          onComplete={async (id, s) => {
            await saveSweep(id, s);
            openSweep(id, s);
            setUnlocked(true);
            setPhase("reveal");
          }}
        />
      )}

      {phase === "reveal" && state && (
        <DrawReveal state={state} onDone={() => { setTab("table"); setPhase("main"); }} />
      )}

      {phase === "main" && state && (
        <>
          <Main
            state={state}
            sweepId={sweepId}
            known={known}
            commit={commit}
            refresh={refresh}
            saveStatus={saveStatus}
            tab={tab}
            setTab={setTab}
            unlocked={unlocked}
            tryUnlock={tryUnlock}
            savePrediction={savePrediction}
            showReveal={() => setPhase("reveal")}
            onMatchdayReport={() => setShowShare(true)}
            goHome={goHome}
            goAdmin={() => setPhase("admin")}
            addResultsToAll={addResultsToAll}
            switchTo={async id => {
              const hit = await loadById(id);
              if (hit) openSweep(hit.id, hit.state);
            }}
            resetAll={async () => {
              await deleteSweep(sweepId);
              forgetSweep(sweepId);
              goHome();
            }}
          />
          {showShare && (
            <ShareModal
              state={state}
              onClose={nextState => {
                setShowShare(false);
                if (nextState) commit(nextState);
              }}
            />
          )}
        </>
      )}
        </ErrorBoundary>
        </div>
  );
}

/* ---- Landing / sweepstake picker ---- */
function Landing({ known, onOpen, onForget, onCreate, onAdmin }) {
  const [pin, setPin]   = useState("");
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);

  async function enter() {
    const key = pin.trim();
    if (!key) { setErr("Enter a PIN."); return; }
    setBusy(true); setErr("");
    const hit = await loadByPin(key);
    setBusy(false);
    if (!hit) { setErr("No sweepstake found with that PIN."); return; }
    onOpen(hit.id, hit.state);
  }

  return (
    <div className="setup">
      <div className="setup-eyebrow">USA · CANADA · MEXICO — SUMMER 2026</div>
      <h1 className="display setup-title">THE<br />SWEEPSTAKE</h1>
      <p className="setup-sub">
        Enter the PIN for your sweepstake to jump in, or start a new one of your own.
      </p>

      <div className="card">
        <label className="lbl">Sweepstake PIN</label>
        <div className="frow" style={{ marginTop: 0 }}>
          <input
            className="inp"
            placeholder="e.g. Family"
            value={pin}
            onChange={e => { setPin(e.target.value); setErr(""); }}
            onKeyDown={e => { if (e.key === "Enter") enter(); }}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" style={{ marginTop: 0 }} onClick={enter} disabled={busy}>
            {busy ? "…" : "Enter →"}
          </button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>

      {known.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>On this device</div>
            {known.length > 1 && (
              <button
                className="btn-ghost"
                style={{ marginTop: 0, padding: "5px 12px", fontSize: 13 }}
                onClick={onAdmin}
              >📊 Admin view</button>
            )}
          </div>
          <div className="known-list">
            {known.map(k => (
              <div key={k.id} className="known-row">
                <button className="known-open" onClick={async () => {
                  const hit = await loadById(k.id);
                  if (hit) onOpen(hit.id, hit.state);
                  else onForget(k.id);
                }}>
                  <span className="known-name">{k.name || "Untitled sweepstake"}</span>
                  <span className="known-pin dim">PIN: {k.viewPin}</span>
                </button>
                <button className="mini mini-red" title="Forget on this device" onClick={() => onForget(k.id)}>✕</button>
              </div>
            ))}
          </div>
          <div className="dim small">These are remembered only on this device. Forgetting one doesn't delete it.</div>
        </div>
      )}

      <button className="btn-ghost" style={{ width: "100%" }} onClick={onCreate}>
        + Create a new sweepstake
      </button>
    </div>
  );
}

/* ---- Admin / Mission Control: every sweepstake on this device at a glance ---- */
function AdminView({ known, onOpen, onForget, onBack }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(
        known.map(async k => {
          const hit = await loadById(k.id);
          if (!hit) {
            return { id: k.id, name: k.name, viewPin: k.viewPin, missing: true };
          }
          const stats   = buildStats(hit.state);
          const started = (hit.state.results?.length || 0) > 0;
          return {
            id:       k.id,
            name:     hit.state.name || k.name || "Untitled sweepstake",
            viewPin:  hit.state.viewPin || k.viewPin || k.id,
            players:  hit.state.parts?.length || 0,
            teamsPer: hit.state.teamsPer || 0,
            results:  hit.state.results?.length || 0,
            leader:   started ? stats.players[0] : null,
            state:    hit.state,
          };
        })
      );
      if (!cancelled) setRows(loaded);
    })();
    return () => { cancelled = true; };
  }, [known]);

  return (
    <div className="setup">
      <button className="btn-ghost" style={{ marginTop: 0, marginBottom: 18 }} onClick={onBack}>← Back</button>
      <div className="setup-eyebrow">ADMIN · ALL YOUR SWEEPSTAKES</div>
      <h1 className="display setup-title" style={{ fontSize: "clamp(36px,9vw,64px)" }}>MISSION<br />CONTROL</h1>
      <p className="setup-sub">
        Every sweepstake remembered on this device, at a glance. Tap one to jump straight in.
      </p>

      {rows === null && <div className="dim">Loading your sweepstakes…</div>}
      {rows && rows.length === 0 && (
        <div className="notice">No sweepstakes remembered on this device yet.</div>
      )}

      <div className="admin-grid">
        {rows?.map(r => (
          <div key={r.id} className="admin-card">
            {r.missing ? (
              <>
                <div className="admin-name">{r.name || "Untitled sweepstake"}</div>
                <div className="dim small">
                  No longer reachable on the server.{" "}
                  <button className="linklike" onClick={() => onForget(r.id)}>Forget</button>
                </div>
              </>
            ) : (
              <>
                <div className="admin-top">
                  <div className="admin-name">{r.name}</div>
                  <span className="admin-pin mono">PIN {r.viewPin}</span>
                </div>
                <div className="admin-stats">
                  <span><b className="mono">{r.players}</b> players</span>
                  <span><b className="mono">{r.teamsPer}</b> teams each</span>
                  <span><b className="mono">{r.results}</b> results in</span>
                </div>
                <div className="admin-leader">
                  {r.leader
                    ? <>🏆 <b>{r.leader.name}</b> leading on <span className="mono">{r.leader.total}</span> pts</>
                    : <span className="dim">No results yet — everyone level.</span>}
                </div>
                <div className="admin-actions">
                  <button
                    className="btn-primary"
                    style={{ marginTop: 0, padding: "9px 18px" }}
                    onClick={() => onOpen(r.id, r.state)}
                  >Open →</button>
                  <button
                    className="mini mini-red"
                    title="Forget on this device"
                    onClick={() => onForget(r.id)}
                  >✕</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Splash ---- */
function Splash({ text }) {
  return (
    <div className="splash">
      <div className="splash-badge">WC26</div>
      <div className="splash-text">{text}</div>
    </div>
  );
}

/* ---- Setup ---- */
function SetupScreen({ onComplete, onCancel }) {
  const [mode, setMode]         = useState("draw");
  const [name, setName]         = useState("World Cup 2026 Sweepstake");
  const [namesText, setNamesText] = useState("");
  const [teamsPer, setTeamsPer] = useState(null);
  const [viewPin, setViewPin]       = useState("");
  const [organiserPin, setOrganiserPin] = useState("");
  const [err, setErr]           = useState("");
  const [busy, setBusy]         = useState(false);
  // import state
  const [importText, setImportText]     = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importErr, setImportErr]       = useState("");

  const names  = namesText.split("\n").map(s => s.trim()).filter(Boolean);
  const maxPer = names.length >= 2 ? Math.floor(48 / names.length) : 0;
  const per    = teamsPer && teamsPer <= maxPer ? teamsPer : Math.min(6, maxPer) || 1;
  const used   = names.length * per;

  // Shared validation + build, used by both draw and import.
  async function finalise(buildParts) {
    const vp = viewPin.trim();
    if (!vp) { setErr("Set a sweepstake PIN — it's how people get in."); return; }
    if (vp.length < 3) { setErr("Sweepstake PIN must be at least 3 characters."); return; }
    if (organiserPin.trim() && organiserPin.trim() === vp) {
      setErr("Organiser PIN must be different from the sweepstake PIN."); return;
    }
    setBusy(true); setErr("");
    const taken = await pinExists(vp);
    setBusy(false);
    if (taken) { setErr("That PIN is already in use. Pick another."); return; }

    const built = buildParts();
    if (!built) return;
    const state = {
      name: name.trim() || "World Cup 2026 Sweepstake",
      createdAt: new Date().toISOString(),
      ...built,
      scoring: { ...DEFAULT_SCORING },
      results: [],
      groupWinners: {},
      eliminated: {},
      previousRankings: {},
      viewPin: vp,
      organiserPin: organiserPin.trim() || null,
    };
    onComplete(vp, state);   // row id === view PIN
  }

  function go() {
    finalise(() => {
      if (names.length < 2) { setErr("Add at least two players."); return null; }
      if (names.length > 24) { setErr("24 players max."); return null; }
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      if (dupes.length) { setErr(`Duplicate name: ${dupes[0]}.`); return null; }
      const { parts, assignments } = runDraw(names, per);
      return { parts, assignments, teamsPer: per };
    });
  }

  function handleParseImport() {
    setImportErr("");
    const result = parseDrawTable(importText);
    if (result.error) { setImportErr(result.error); return; }
    setImportPreview(result);
    if (result.errors?.length) setImportErr("Warnings: " + result.errors.join(", "));
  }

  function goImport() {
    finalise(() => {
      if (!importPreview) { setErr("Parse the draw table first."); return null; }
      return {
        parts: importPreview.parts,
        assignments: importPreview.assignments,
        teamsPer: importPreview.teamsPer,
      };
    });
  }

  const PinFields = (
    <>
      <label className="lbl">Sweepstake PIN <span className="dim">(people type this to get in)</span></label>
      <input
        className="inp"
        style={{ maxWidth: 220 }}
        placeholder="e.g. RileyFamily26"
        value={viewPin}
        onChange={e => { setViewPin(e.target.value); setErr(""); }}
      />
      <label className="lbl">Organiser PIN <span className="dim">(optional — needed to enter results)</span></label>
      <input
        className="inp"
        style={{ maxWidth: 160 }}
        placeholder="e.g. 2026"
        value={organiserPin}
        onChange={e => { setOrganiserPin(e.target.value); setErr(""); }}
      />
    </>
  );

  return (
    <div className="setup">
      <button className="btn-ghost" style={{ marginTop: 0, marginBottom: 18 }} onClick={onCancel}>← Back</button>
      <div className="setup-eyebrow">USA · CANADA · MEXICO — SUMMER 2026</div>
      <h1 className="display setup-title">NEW<br />SWEEPSTAKE</h1>
      <p className="setup-sub">
        Names go in, teams come out. A banded draw deals every player one team from each
        strength band so nobody can moan about the hat. Set a PIN and share it with your group.
      </p>

      <div className="mode-toggle">
        <button
          className={cls("mode-btn", mode === "draw" && "mode-btn-on")}
          onClick={() => setMode("draw")}
        >🎲 Random draw</button>
        <button
          className={cls("mode-btn", mode === "import" && "mode-btn-on")}
          onClick={() => setMode("import")}
        >📋 Import draw</button>
      </div>

      {mode === "draw" && (
        <div className="card">
          <label className="lbl">Sweepstake name</label>
          <input className="inp" value={name} onChange={e => setName(e.target.value)} />

          <label className="lbl">Players — one per line</label>
          <textarea
            className="inp ta"
            rows={8}
            placeholder={"Alex\nHarry\nCam\nAdam\n…"}
            value={namesText}
            onChange={e => { setNamesText(e.target.value); setErr(""); }}
          />

          {names.length >= 2 && (
            <div className="setup-mathrow">
              <div className="setup-count">
                <span className="mono big">{names.length}</span> players
              </div>
              <div className="setup-per">
                <label className="lbl" style={{ margin: 0 }}>Teams each</label>
                <div className="stepper">
                  <button className="step" onClick={() => setTeamsPer(Math.max(1, per - 1))}>−</button>
                  <span className="mono big">{per}</span>
                  <button className="step" onClick={() => setTeamsPer(Math.min(maxPer, per + 1))}>+</button>
                </div>
              </div>
              <div className="setup-used">
                <span className="mono big">{used}</span>/48 teams used
                {used < 48 && <span className="dim"> · weakest {48 - used} dropped</span>}
              </div>
            </div>
          )}

          {PinFields}

          {err && <div className="err">{err}</div>}
          <button className="btn-primary" onClick={go} disabled={names.length < 2 || busy}>
            {busy ? "Checking PIN…" : "Run the draw"}
          </button>
        </div>
      )}

      {mode === "import" && (
        <div className="card">
          <label className="lbl">Sweepstake name</label>
          <input className="inp" value={name} onChange={e => setName(e.target.value)} />

          {PinFields}

          <label className="lbl">Paste draw table</label>
          <div className="dim small" style={{ marginBottom: 8 }}>
            Tab-separated. First column: participant name. Remaining columns: team names (flags optional).
            Copy-paste directly from Excel or Google Sheets works perfectly.
          </div>
          <textarea
            className="inp ta"
            rows={10}
            placeholder={"PARTICIPANT\tTIER 1\tTIER 2\t…\nAlex\tFrance 🇫🇷\tUSA 🇺🇸\t…"}
            value={importText}
            onChange={e => {
              setImportText(e.target.value);
              setImportPreview(null);
              setImportErr("");
            }}
          />

          {importErr && (
            <div className={importPreview ? "warn" : "err"} style={{ whiteSpace: "pre-wrap" }}>
              {importErr}
            </div>
          )}

          {importPreview && (
            <div className="import-preview">
              <div className="import-preview-title">
                ✓ {importPreview.parts.length} participants · {importPreview.teamsPer} teams each
              </div>
              {importPreview.parts.map(p => (
                <div key={p.id} className="import-row">
                  <span className="import-name">{p.name}</span>
                  <span className="import-flags">
                    {(importPreview.assignments[p.id] || []).map(tid => {
                      const t = TEAM[tid];
                      return t ? <span key={tid} title={t.name}>{t.flag}</span> : null;
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {err && <div className="err">{err}</div>}

          <div className="frow" style={{ marginTop: 16 }}>
            {!importPreview ? (
              <button
                className="btn-primary"
                style={{ marginTop: 0 }}
                onClick={handleParseImport}
                disabled={!importText.trim()}
              >
                Parse draw
              </button>
            ) : (
              <>
                <button className="btn-primary" style={{ marginTop: 0 }} onClick={goImport} disabled={busy}>
                  {busy ? "Checking PIN…" : "Load this draw →"}
                </button>
                <button
                  className="btn-ghost"
                  style={{ marginTop: 0 }}
                  onClick={() => { setImportPreview(null); setImportErr(""); }}
                >
                  Re-parse
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Draw Reveal ---- */
function DrawReveal({ state, onDone }) {
  const [skip, setSkip] = useState(false);
  let counter = 0;
  return (
    <div className={cls("reveal", skip && "reveal-skip")}>
      <div className="reveal-head">
        <div className="setup-eyebrow">THE DRAW</div>
        <h1 className="display" style={{ fontSize: "clamp(28px,6vw,44px)", margin: "4px 0 0" }}>
          {state.name.toUpperCase()}
        </h1>
      </div>
      {Array.from({ length: state.teamsPer }).map((_, r) => (
        <div className="reveal-round" key={r}>
          <div className="reveal-roundlbl">
            Round {r + 1}{" "}
            <span className="dim">· {TIERS[Math.min(5, Math.floor((r * state.parts.length) / 8))]} band</span>
          </div>
          <div className="reveal-grid">
            {state.parts.map(p => {
              const t = TEAM[state.assignments[p.id]?.[r]];
              if (!t) return null;
              const delay = `${(counter++) * 0.22 + 0.4}s`;
              return (
                <div className="pick" style={{ animationDelay: delay }} key={p.id + r}>
                  <span className="pick-flag">{t.flag}</span>
                  <span className="pick-team">{t.name}</span>
                  <span className="pick-owner">{p.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="reveal-actions">
        {!skip && <button className="btn-ghost" onClick={() => setSkip(true)}>Skip animation</button>}
        <button className="btn-primary" onClick={onDone}>To the table →</button>
      </div>
    </div>
  );
}

/* ---- Knockout bracket (full tree) ---- */
// Realised best-third combination (FIFA Annexe C) — keyed by R32 match number →
// the group whose 3rd-placed team fills that slot. null until the 8 qualifying
// thirds are known; fill it then (one ~8-entry row) and the third slots resolve.
// ESPN R32 fixtures override regardless. Everything past the R32 propagates from
// match winners, so it needs no config.
const R32_THIRD_COMBO = { 74:"D", 77:"F", 79:"E", 80:"K", 81:"B", 82:"I", 85:"J", 87:"L" }; // realised 2026 combo (from published R32 fixtures); ESPN overrides per match anyway

function BracketView({ state, stats, espnMatches = [] }) {
  const [groups, setGroups] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/.netlify/functions/standings');
        if (!res.ok) return;
        const data = await res.json();
        if (data.error) return;
        if (alive) setGroups(data.groups || []);
      } catch (_) {} finally { if (alive) setLoaded(true); }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Zoom: the bracket is ~1500px wide, so by default scale the WHOLE tree (width
  // and height) to fit the viewport; − / Fit / ＋ adjust, and zooming in pans.
  const viewportRef = useRef(null), contentRef = useRef(null);
  const [nat, setNat] = useState({ w: 1520, h: 760 }); // natural (unscaled) content size
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(null);              // null = auto-fit
  useLayoutEffect(() => {
    if (!loaded) return;
    const measure = () => {
      if (contentRef.current) {
        const w = contentRef.current.offsetWidth, h = contentRef.current.offsetHeight;
        if (w && h) setNat(p => (p.w === w && p.h === h) ? p : { w, h });
      }
      if (viewportRef.current) setVp({ w: viewportRef.current.clientWidth, h: window.innerHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loaded]);
  const fit = (vp.w && vp.h)
    ? Math.min(1, Math.max(0.12, Math.min((vp.w - 6) / nat.w, (vp.h * 0.72) / nat.h)))
    : 1;
  const z = zoom ?? fit;

  // Result index across EVERY stage (keyed `${stage}|${sortedPair}`) + the R32
  // `byTeam` opponent map for the third-place override. Committed results win over
  // ESPN (they carry pens winners + manual fixes). Scores are kept only once a
  // match has started — ESPN reports "0"/null pre-kickoff.
  const { resultIndex, byTeam } = useMemo(() => {
    const resultIndex = new Map(), byTeam = new Map();
    const key = (stage, a, b) => `${stage}|${[a, b].sort().join('|')}`;
    for (const m of espnMatches) {
      const stage = apiRoundToStage(m.round);
      const a = apiTeamId(m.homeTeam), b = apiTeamId(m.awayTeam);
      if (!a || !b) continue;
      const started = m.statusState === 'in' || m.statusState === 'post';
      resultIndex.set(key(stage, a, b), { teamA: a, teamB: b, scoreA: Number(m.homeScore), scoreB: Number(m.awayScore), pensWinner: apiPensWinner(m, a, b), done: m.statusState === 'post', started });
      if (stage === 'R32') { byTeam.set(a, b); byTeam.set(b, a); }
    }
    for (const r of state.results || []) {
      if (!r.teamA || !r.teamB) continue;
      resultIndex.set(key(r.stage, r.teamA, r.teamB), { teamA: r.teamA, teamB: r.teamB, scoreA: r.scoreA, scoreB: r.scoreB, pensWinner: r.pensWinner || null, done: !r.live, started: true });
      if (r.stage === 'R32') { byTeam.set(r.teamA, r.teamB); byTeam.set(r.teamB, r.teamA); }
    }
    return { resultIndex, byTeam };
  }, [espnMatches, state.results]);

  const tree = useMemo(
    () => resolveBracketTree(groups, R32_THIRD_COMBO, byTeam, resultIndex),
    [groups, byTeam, resultIndex]
  );

  const owned = stats.ownedTeams;
  const decided = [...tree.values()].filter(t => t.winner).length;
  const ownedAlive = [...owned].filter(id => !stats.eliminated.has(id)).length;

  function renderSide(side, t) {
    if (!side.teamId) return <div className="bkt-team bkt-ph">{side.label}</div>;
    const team = TEAM[side.teamId];
    const res = t.result;
    const sc = res?.started ? (side.teamId === res.teamA ? res.scoreA : res.scoreB) : undefined;
    return (
      <div className={cls("bkt-team", owned.has(side.teamId) && "bkt-own", t.winner === side.teamId && "bkt-win", t.loser === side.teamId && "bkt-dead")}>
        <span className="bkt-flag">{team.flag}</span>
        <span className="bkt-name">{team.name}</span>
        {owned.has(side.teamId) && <span className="bkt-dot" title="Your team">●</span>}
        {res?.pensWinner === side.teamId && <span className="bkt-pen" title="Won on penalties">p</span>}
        {Number.isFinite(sc) && <span className="bkt-score">{sc}</span>}
      </div>
    );
  }

  function renderMatch(num, sideClass) {
    const t = tree.get(num);
    if (!t) return null;
    const label = t.stage === "FINAL" ? "Final" : t.stage === "THIRD" ? "3rd place" : `M${num}`;
    return (
      <div key={num} className={cls("bkt-tie", `bkt-${sideClass}`, t.stage === "FINAL" && "bkt-final",
        (owned.has(t.a.teamId) || owned.has(t.b.teamId)) && "bkt-tie-own")}>
        <div className="bkt-num"><span>{label}</span></div>
        {renderSide(t.a, t)}
        {renderSide(t.b, t)}
      </div>
    );
  }

  const column = (col, sideClass, keyPrefix) => (
    <div className="bkt-col" key={keyPrefix + col.stage}>
      <div className="bkt-colhead">{STAGE[col.stage]?.short || col.stage}</div>
      <div className="bkt-colbody">{col.ms.map(num => renderMatch(num, sideClass))}</div>
    </div>
  );

  return (
    <div className="bracket-wrap">
      <div className="board-eyebrow">
        <span className="board-eyebrow-label">Knockout bracket</span>
        <div className="board-eyebrow-line" />
        <span className="board-eyebrow-right">{decided}/32 played · {ownedAlive} of yours alive</span>
      </div>

      <div className="bkt-note">
        Auto-fills as results land — group winners &amp; runners-up seed the Round of 32,
        then every winner advances through the tree (losing semi-finalists drop into the
        third-place game). ● marks your teams · scroll across for later rounds.
      </div>

      {!loaded ? (
        <div className="notice">Loading the bracket…</div>
      ) : (
        <>
          <div className="bkt-zoom">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.2, +(z / 1.2).toFixed(3)))}>−</button>
            <button type="button" className="bkt-zoom-fit" onClick={() => setZoom(null)}>
              {zoom == null ? "Fit" : `${Math.round(z * 100)}%`}
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2, +(z * 1.2).toFixed(3)))}>＋</button>
          </div>
          <div className="bkt-viewport" ref={viewportRef}>
            <div className="bkt-sizer" style={{ width: nat.w * z, height: nat.h * z }}>
              <div className="bkt-scaler" ref={contentRef} style={{ transform: `scale(${z})` }}>
                <div className="bkt-tree">
                  {BRACKET_COLUMNS.left.map(col => column(col, "left", "L"))}
                  <div className="bkt-col bkt-col-center" key="center">
                    <div className="bkt-colhead">Final</div>
                    <div className="bkt-colbody">{BRACKET_COLUMNS.center.map(num => renderMatch(num, "center"))}</div>
                  </div>
                  {BRACKET_COLUMNS.right.map(col => column(col, "right", "R"))}
                </div>
                <div className="bkt-thirdplace">
                  <div className="bkt-colhead bkt-3rd-head">Third-place play-off</div>
                  {renderMatch(103, "center")}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- Predictions (fill the blank knockout bracket, score against reality) ---- */
function PredictionsView({ state, sweepId, stats, espnMatches = [], savePrediction }) {
  const [groups, setGroups] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/.netlify/functions/standings');
        if (!res.ok) return;
        const data = await res.json();
        if (data.error) return;
        if (alive) setGroups(data.groups || []);
      } catch (_) {} finally { if (alive) setLoaded(true); }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Same actual-result index the live bracket builds — committed results win over
  // ESPN; scores only count once a match has started (ESPN reports "0"/null before).
  const { resultIndex, byTeam } = useMemo(() => {
    const resultIndex = new Map(), byTeam = new Map();
    const key = (stage, a, b) => `${stage}|${[a, b].sort().join('|')}`;
    for (const m of espnMatches) {
      const stage = apiRoundToStage(m.round);
      const a = apiTeamId(m.homeTeam), b = apiTeamId(m.awayTeam);
      if (!a || !b) continue;
      const started = m.statusState === 'in' || m.statusState === 'post';
      resultIndex.set(key(stage, a, b), { teamA: a, teamB: b, scoreA: Number(m.homeScore), scoreB: Number(m.awayScore), pensWinner: apiPensWinner(m, a, b), done: m.statusState === 'post', started });
      if (stage === 'R32') { byTeam.set(a, b); byTeam.set(b, a); }
    }
    for (const r of state.results || []) {
      if (!r.teamA || !r.teamB) continue;
      resultIndex.set(key(r.stage, r.teamA, r.teamB), { teamA: r.teamA, teamB: r.teamB, scoreA: r.scoreA, scoreB: r.scoreB, pensWinner: r.pensWinner || null, done: !r.live, started: true });
      if (r.stage === 'R32') { byTeam.set(r.teamA, r.teamB); byTeam.set(r.teamB, r.teamA); }
    }
    return { resultIndex, byTeam };
  }, [espnMatches, state.results]);

  const actualTree = useMemo(
    () => resolveBracketTree(groups, R32_THIRD_COMBO, byTeam, resultIndex),
    [groups, byTeam, resultIndex]
  );

  // The R32 is "set" once every tie has both real teams (groups done + thirds known).
  // Entry opens then and stays open — there is no global lock. Each tie freezes on
  // its own: once the player has SAVED a pick for it, or once that tie's real match
  // has kicked off (see `frozen` in renderSide). No organiser action needed.
  const r32Seeded = useMemo(
    () => [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88]
      .every(m => actualTree.get(m)?.a.teamId && actualTree.get(m)?.b.teamId),
    [actualTree]
  );
  const actualDecided = useMemo(
    () => [...actualTree.values()].filter(t => t.winner).length,
    [actualTree]
  );
  // Predicted champions are only revealed once every R32 game has kicked off — i.e.
  // once nobody can still be entering R32 picks — so the leaderboard can't leak a
  // strategy to someone who hasn't locked their own bracket yet.
  const allR32Started = useMemo(
    () => [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88]
      .every(m => actualTree.get(m)?.result?.started),
    [actualTree]
  );

  // Identity: claim yourself from the existing players (honour system, like the rest
  // of the app), remembered per-device. `viewing` lets you PEEK at someone else's
  // bracket read-only (from the leaderboard) WITHOUT changing who you are — so you can
  // never accidentally edit or save over another player's predictions.
  const idKey = 'wc26_predictor_' + sweepId;
  const [myId, setMyId] = useState(() => {
    try { return localStorage.getItem(idKey) || ''; } catch { return ''; }
  });
  const [viewing, setViewing] = useState('');   // a player being peeked at; '' = your own bracket
  const me = viewing || myId;                    // whose bracket is on screen
  const isMine = !viewing;                        // editable only when it's your own

  // Editable picks for `me`. Reloaded only when the displayed player changes — never
  // on state.predictions, so an in-flight edit is never clobbered by a save/refresh.
  const [picks, setPicks] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editSeq = useRef(0);                      // bumped on every pick, to detect edits mid-save
  useEffect(() => {
    setPicks({ ...(state.predictions?.[me]?.picks || {}) });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, sweepId]);

  // Ties this player has already SAVED. Write-once: a saved pick can't be changed,
  // but blank ties stay open until you save (or until that game kicks off).
  const committedPicks = state.predictions?.[me]?.picks || {};

  const predTree = useMemo(() => resolvePredictionTree(actualTree, picks), [actualTree, picks]);
  const picked = useMemo(() => [...predTree.values()].filter(t => t.winner).length, [predTree]);

  function pick(m, teamId) {
    if (!isMine || !teamId) return;                   // can't edit someone else's bracket
    if (actualTree.get(m)?.result?.started) return;  // that game has already kicked off
    if (committedPicks[m] != null) return;            // already saved this tie — write-once
    setPicks(p => ({ ...p, [m]: teamId }));
    editSeq.current += 1;
    setDirty(true);
  }
  async function onSave() {
    if (!me || !isMine || saving) return;
    if (!window.confirm("Save your picks? Saved picks lock in — you can't change them afterwards. You can still come back to fill in games that haven't kicked off yet.")) return;
    const seq = editSeq.current;
    setSaving(true);
    const ok = await savePrediction(me, picks);
    setSaving(false);
    if (ok && editSeq.current === seq) setDirty(false);  // don't claim "saved" if edited mid-save
  }
  // The dropdown: declare who YOU are — your bracket becomes editable.
  function claimMe(id) {
    if (dirty && !window.confirm("You have unsaved picks that will be lost. Switch anyway?")) return;
    setMyId(id);
    setViewing('');
    try { id ? localStorage.setItem(idKey, id) : localStorage.removeItem(idKey); } catch {}
  }
  // Click a leaderboard name → PEEK at that player's bracket, read-only.
  function viewPlayer(id) {
    if (dirty && id !== myId && !window.confirm("You have unsaved picks that will be lost. View anyway?")) return;
    setViewing(id === myId ? '' : id);
    viewportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Leaderboard: everyone who has entered, scored against the actual tree (live).
  const board = useMemo(() => {
    const preds = state.predictions || {};
    const rows = state.parts
      .filter(p => preds[p.id]?.picks)
      .map(p => ({ p, ...scorePrediction(actualTree, preds[p.id].picks) }))
      .sort((a, b) => b.points - a.points || b.pct - a.pct || b.correct - a.correct || a.p.name.localeCompare(b.p.name));
    let rank = 0, prev = null;
    rows.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = rank; });
    return rows;
  }, [state.predictions, state.parts, actualTree]);

  // ── zoom / fit (mirrors the live bracket) ──
  const viewportRef = useRef(null), contentRef = useRef(null);
  const [nat, setNat] = useState({ w: 1520, h: 760 });
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(null);
  useLayoutEffect(() => {
    if (!loaded) return;
    const measure = () => {
      if (contentRef.current) {
        const w = contentRef.current.offsetWidth, h = contentRef.current.offsetHeight;
        if (w && h) setNat(p => (p.w === w && p.h === h) ? p : { w, h });
      }
      if (viewportRef.current) setVp({ w: viewportRef.current.clientWidth, h: window.innerHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loaded, r32Seeded, me]);
  const fit = (vp.w && vp.h) ? Math.min(1, Math.max(0.12, Math.min(vp.w / nat.w, (vp.h * 0.74) / nat.h))) : 1;
  const z = zoom ?? fit;

  const owned = stats.ownedTeams;

  function renderSide(side, m) {
    const t = predTree.get(m);
    const actualWinner = actualTree.get(m)?.winner || null;
    if (!side.teamId) return <div className="bkt-team bkt-ph bkt-pick-ph">{side.label}</div>;
    const team = TEAM[side.teamId];
    const isPick = t?.winner === side.teamId;
    const decided = !!actualWinner;
    const started = !!actualTree.get(m)?.result?.started;
    const frozen = started || committedPicks[m] != null;  // game kicked off, or pick already saved
    const correct = decided && isPick && actualWinner === side.teamId;
    const wrong   = decided && isPick && actualWinner !== side.teamId;
    const actualHit = decided && actualWinner === side.teamId && !isPick;
    const pickable = isMine && !frozen && t?.a.teamId && t?.b.teamId;
    return (
      <button
        type="button"
        className={cls("bkt-team bkt-pickbtn",
          owned.has(side.teamId) && "bkt-own",
          isPick && "bkt-pick", correct && "bkt-correct", wrong && "bkt-wrong", actualHit && "bkt-actual",
          !pickable && "bkt-pick-locked")}
        onClick={() => pick(m, side.teamId)}
        disabled={!pickable}
        title={correct ? "Correct" : wrong ? "Wrong" : actualHit ? "Actually advanced" : undefined}
      >
        <span className="bkt-flag">{team.flag}</span>
        <span className="bkt-name">{team.name}</span>
        {owned.has(side.teamId) && <span className="bkt-dot" title="Your team">●</span>}
        {correct && <span className="bkt-mark bkt-mark-ok">✓</span>}
        {wrong && <span className="bkt-mark bkt-mark-no">✗</span>}
      </button>
    );
  }
  function renderMatch(num, sideClass) {
    const t = predTree.get(num);
    if (!t) return null;
    const label = t.stage === "FINAL" ? "Final" : t.stage === "THIRD" ? "3rd place" : `M${num}`;
    const lockedIn = committedPicks[num] != null && !actualTree.get(num)?.winner;  // saved, not yet played
    return (
      <div key={num} className={cls("bkt-tie", `bkt-${sideClass}`, t.stage === "FINAL" && "bkt-final")}>
        <div className="bkt-num"><span>{label}</span>{lockedIn && <span className="bkt-lock" title="Saved — locked in">🔒</span>}</div>
        {renderSide(t.a, num)}
        {renderSide(t.b, num)}
      </div>
    );
  }
  const column = (col, sideClass, keyPrefix) => (
    <div className="bkt-col" key={keyPrefix + col.stage}>
      <div className="bkt-colhead">{STAGE[col.stage]?.short || col.stage}</div>
      <div className="bkt-colbody">{col.ms.map(num => renderMatch(num, sideClass))}</div>
    </div>
  );

  const champOf = (row) => row.predTree.get(104)?.winner ? TEAM[row.predTree.get(104).winner] : null;

  return (
    <div className="bracket-wrap">
      <div className="board-eyebrow">
        <span className="board-eyebrow-label">Predictions</span>
        <div className="board-eyebrow-line" />
        <span className="board-eyebrow-right">
          {r32Seeded ? `Open · ${actualDecided}/32 played` : "Opens when groups end"}
        </span>
      </div>

      {!loaded ? (
        <div className="notice">Loading the bracket…</div>
      ) : !r32Seeded ? (
        <div className="bkt-note">
          Predictions open once the group stage finishes and the Round of 32 is set —
          then you fill in every knockout winner. You can enter any time, but each pick
          locks the moment you save it (and you can't pick a game that has already kicked
          off). Scores update live as results land.
        </div>
      ) : (
        <>
          <div className="pred-bar">
            <label className="pred-who">
              <span>You are:</span>
              <select value={myId} onChange={e => claimMe(e.target.value)}>
                <option value="">— pick your name —</option>
                {state.parts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{(state.predictions?.[p.id]?.picks) ? " ✓" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!me ? (
            <div className="bkt-note">Pick your name above to fill in your predictions.</div>
          ) : (
            <>
              {isMine ? (
                <div className="bkt-note">
                  Tap who you think wins each tie, then Save — saved picks lock in (🔒) and
                  can't be changed. Fill the rest whenever you like; you just can't pick a
                  game that has already kicked off. ✓ correct · ✗ missed · faded = who
                  actually advanced. ● marks your sweep teams.
                </div>
              ) : (
                <div className="bkt-note">
                  Viewing <strong>{state.parts.find(p => p.id === me)?.name || 'this player'}</strong>'s
                  bracket — read-only.{" "}
                  <button type="button" className="pred-linkbtn" onClick={() => viewPlayer(myId)}>
                    Back to your bracket
                  </button>
                </div>
              )}
              <div className="bkt-zoom">
                <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.2, +(z / 1.2).toFixed(3)))}>−</button>
                <button type="button" className="bkt-zoom-fit" onClick={() => setZoom(null)}>{zoom == null ? "Fit" : `${Math.round(z * 100)}%`}</button>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2, +(z * 1.2).toFixed(3)))}>＋</button>
              </div>
              <div className="bkt-viewport" ref={viewportRef}>
                <div className="bkt-sizer" style={{ width: nat.w * z, height: nat.h * z }}>
                  <div className="bkt-scaler" ref={contentRef} style={{ transform: `scale(${z})` }}>
                    <div className="bkt-tree">
                      {BRACKET_COLUMNS.left.map(col => column(col, "left", "L"))}
                      <div className="bkt-col bkt-col-center" key="center">
                        <div className="bkt-colhead">Final</div>
                        <div className="bkt-colbody">{BRACKET_COLUMNS.center.map(num => renderMatch(num, "center"))}</div>
                      </div>
                      {BRACKET_COLUMNS.right.map(col => column(col, "right", "R"))}
                    </div>
                    <div className="bkt-thirdplace">
                      <div className="bkt-colhead bkt-3rd-head">Third-place play-off</div>
                      {renderMatch(103, "center")}
                    </div>
                  </div>
                </div>
              </div>
              {isMine && (
                <div className="pred-savebar">
                  <span className="pred-progress">{picked}/32 picked</span>
                  <button type="button" className="pred-save" onClick={onSave} disabled={!dirty || saving}>
                    {saving ? "Saving…" : dirty ? "Save & lock picks" : state.predictions?.[me]?.picks ? "Saved ✓" : "Save & lock picks"}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="pred-board-wrap">
            <div className="board-eyebrow">
              <span className="board-eyebrow-label">Leaderboard</span>
              <div className="board-eyebrow-line" />
              <span className="board-eyebrow-right">{board.length}/{state.parts.length} entered</span>
            </div>
            {board.length === 0 ? (
              <div className="bkt-note">No predictions entered yet.</div>
            ) : actualDecided === 0 ? (
              <div className="pred-roster">
                Entered: {board.map(r => r.p.name).join(" · ")} — scores appear once the knockouts begin.
              </div>
            ) : (
              <table className="pred-table">
                <thead>
                  <tr><th>#</th><th>Name</th>{allR32Started && <th>Champion</th>}<th className="num">Correct</th><th className="num">Points</th><th className="num">%</th></tr>
                </thead>
                <tbody>
                  {board.map(r => {
                    const champ = champOf(r);
                    return (
                      <tr key={r.p.id} className={cls("pred-row", r.p.id === me && "pred-me")}
                        onClick={() => viewPlayer(r.p.id)} title={`View ${r.p.name}'s bracket`}>
                        <td>{r.rank}</td>
                        <td>{r.p.name}</td>
                        {allR32Started && <td className="pred-champ">{champ ? <>{champ.flag} {champ.name}</> : <span className="bkt-ph">—</span>}</td>}
                        <td className="num">{r.correct}/{r.decided}</td>
                        <td className="num">{r.points}</td>
                        <td className="num">{r.pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---- Main shell ---- */
function Main({
  state, sweepId, known, commit, refresh, saveStatus, tab, setTab,
  unlocked, tryUnlock, savePrediction, showReveal, onMatchdayReport, resetAll, goHome, goAdmin, switchTo, addResultsToAll,
}) {
  const [espnMatches, setEspnMatches] = useState([]);
  useEffect(() => {
    async function fetchLive() {
      try {
        const res = await fetch('/.netlify/functions/fixtures');
        if (!res.ok) return;
        const data = await res.json();
        if (data.error) return;
        setEspnMatches(data.matches || []);
      } catch (_) {}
    }
    fetchLive();
    const id = setInterval(fetchLive, 60_000);
    return () => clearInterval(id);
  }, []);

  const existingPairs = useMemo(
    () => new Set((state.results || []).map(r => [r.teamA, r.teamB].sort().join('|'))),
    [state.results]
  );

  // Live in-progress games converted to provisional result objects for scoring.
  // Display-only — never saved. Points update every 60s as the score changes.
  const provisionalLive = useMemo(() =>
    espnMatches
      .filter(m => m.statusState === 'in')
      .flatMap(m => {
        const hId = apiTeamId(m.homeTeam);
        const aId = apiTeamId(m.awayTeam);
        if (!hId || !aId) return [];
        if (existingPairs.has([hId, aId].sort().join('|'))) return [];
        return [{
          id: 'live_' + m.id,
          stage: apiRoundToStage(m.round),
          teamA: hId, teamB: aId,
          scoreA: Number(m.homeScore) || 0,
          scoreB: Number(m.awayScore) || 0,
          redsA: m.redCardsHome || 0,
          redsB: m.redCardsAway || 0,
          pensWinner: null, at: m.date, live: true,
        }];
      }),
    [espnMatches, existingPairs]
  );

  const stats = useMemo(
    () => buildStats({ ...state, results: [...(state.results || []), ...provisionalLive] }),
    [state, provisionalLive]
  );
  const tabs  = [["table","Table"],["teams","Teams"],["matches","Matches"],["bracket","Bracket"],["predict","Predictions"],["howto","How it works"],["setup","Setup"]];
  const others = known.filter(k => k.id !== sweepId);
  return (
    <div className="main">
      <header className="hdr">
        <button className="hdr-badge hdr-home" title="All sweepstakes" onClick={goHome}>WC26</button>
        <div className="hdr-title">{state.name}</div>
        <div className="hdr-right">
          <span className={cls("savestate", saveStatus)}>
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Error" : ""}
          </span>
          {others.length > 0 && (
            <select
              className="sweep-switch"
              value=""
              onChange={e => { if (e.target.value) switchTo(e.target.value); }}
              title="Switch sweepstake"
            >
              <option value="">Switch ▾</option>
              {others.map(k => (
                <option key={k.id} value={k.id}>{k.name || k.viewPin}</option>
              ))}
            </select>
          )}
          {known.length > 1 && (
            <button className="btn-icon" title="Admin: all sweepstakes" onClick={goAdmin}>📊</button>
          )}
          <button className="btn-icon" title="Refresh" onClick={refresh}>↻</button>
          {provisionalLive.length > 0 && (
            <div className="hdr-live">
              <span className="live-dot" />
              <span className="live-label">LIVE</span>
            </div>
          )}
        </div>
      </header>
      <nav className="tabs">
        {tabs.map(([id, lbl]) => (
          <button key={id} className={cls("tab", tab === id && "tab-on")} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </nav>
      {tab === "table"   && <TableView   state={state} stats={stats} onMatchdayReport={onMatchdayReport} hasLive={provisionalLive.length > 0} />}
      {tab === "teams"   && <TeamsView   state={state} stats={stats} commit={commit} unlocked={unlocked} tryUnlock={tryUnlock} />}
      {tab === "matches" && <MatchesView state={state} stats={stats} commit={commit} unlocked={unlocked} tryUnlock={tryUnlock} addResultsToAll={addResultsToAll} espnMatches={espnMatches} />}
      {tab === "bracket" && <BracketView state={state} stats={stats} espnMatches={espnMatches} />}
      {tab === "predict" && <PredictionsView state={state} sweepId={sweepId} stats={stats} espnMatches={espnMatches} savePrediction={savePrediction} />}
      {tab === "howto"   && <HowItWorks  state={state} stats={stats} />}
      {tab === "setup"   && (
        <SetupView
          state={state} commit={commit} sweepId={sweepId}
          unlocked={unlocked} tryUnlock={tryUnlock}
          showReveal={showReveal} resetAll={resetAll}
        />
      )}
    </div>
  );
}

/* ---- How it works ---- */
function HowItWorks({ state, stats }) {
  const [openTier, setOpenTier] = useState(null);
  const sc = stats.sc;
  const scoreRows = [
    ["Win (group game)", sc.win, "Your team wins a group match."],
    ["Draw (group game)", sc.draw, "Your team draws a group match."],
    ["Goal scored", sc.goal, "Per goal your team scores, any stage."],
    ["Goal conceded", sc.conceded, "Per goal your team lets in, any stage."],
    ["Clean sheet", sc.cleanSheet, "Your team concedes zero in a match."],
    ["Red card", sc.redCard, "Per red card your team picks up."],
    ["Won group", sc.groupWin, "Your team finishes top of its group."],
    ["Knockout round won", sc.roundWin, "On top of the win points, each KO round your team progresses through."],
  ];
  return (
    <div className="pane">
      <div className="card">
        <div className="card-title">The draw</div>
        <p className="howto-p">
          Every team at the World Cup is ranked, then split into strength bands — Favourites at the
          top, down through Dark Horses, Outsiders, Passengers, Cannon Fodder and Tourists at the
          bottom.
        </p>
        <p className="howto-p">
          The draw deals one team from each band to every player, in turn. So everyone ends up with a
          balanced spread: a genuine contender, a couple of mid-tier sides, and a few rank outsiders.
          Nobody gets all the giants, nobody gets all the minnows. No moaning about the hat.
        </p>
        <div className="howto-bands">
          {TIERS.map((t, i) => {
            const tierTeams = TEAMS.filter(tm => tm.tier === i);
            const isOpen = openTier === i;
            return (
              <div key={t} className="howto-band-wrap">
                <button
                  className={cls("howto-band", isOpen && "howto-band-open")}
                  onClick={() => setOpenTier(isOpen ? null : i)}
                >
                  <span className="howto-band-n mono">{i + 1}</span>
                  <span className="howto-band-l">{t}</span>
                  <span className="howto-band-count dim">{tierTeams.length} teams</span>
                  <span className={cls("chev", isOpen && "chev-open")}>▾</span>
                </button>
                {isOpen && (
                  <div className="howto-band-teams">
                    {[...tierTeams]
                      .sort((a, b) => {
                        const pa = stats.teamPts[a.id] ?? null;
                        const pb = stats.teamPts[b.id] ?? null;
                        if (pa !== null && pb !== null) return pb - pa;
                        if (pa !== null) return -1;
                        if (pb !== null) return 1;
                        return 0;
                      })
                      .map(tm => {
                        const pts = stats.teamPts[tm.id];
                        const owned = pts !== undefined;
                        const out = stats.eliminated.has(tm.id);
                        return (
                          <span key={tm.id} className={cls("howto-band-team", out && "chip-out")}>
                            <span>{tm.flag}</span>
                            <span>{tm.name}</span>
                            {owned && (
                              <span className="howto-band-pts mono">{pts}</span>
                            )}
                          </span>
                        );
                      })
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Scoring</div>
        <p className="howto-p">
          You score points from <strong>every team you own</strong>, all the way through the tournament,
          until they're knocked out. Points keep ticking over in the knockouts too.
        </p>
        <div className="howto-score">
          {scoreRows.map(([label, val, desc]) => (
            <div key={label} className="howto-score-row">
              <span className={cls("howto-pts mono", val < 0 && "howto-pts-neg")}>
                {val > 0 ? `+${val}` : val}
              </span>
              <span className="howto-score-label">
                {label}
                <span className="howto-score-desc dim">{desc}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="howto-p dim small" style={{ marginTop: 14 }}>
          Note: goals and clean sheets count at every stage, including knockouts. Win points only apply to
          group games and to the team that wins a knockout tie (penalties count as a win). The organiser
          can tweak any of these values on the Setup tab — the table recalculates instantly.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Winning</div>
        <p className="howto-p">
          Add up the points from all your teams. Most points when the final whistle blows in the final
          takes the sweepstake. Simple as that.
        </p>
      </div>
    </div>
  );
}

/* ---- Table / Leaderboard ---- */
function TableView({ state, stats, onMatchdayReport, hasLive }) {
  const [openIds, setOpenIds] = useState(() => {
    const leader = stats.players[0];
    return leader ? new Set([leader.id]) : new Set();
  });

  const leaderPts = stats.players[0]?.total ?? 0;
  const hasResults = state.results.length > 0;
  const allOpen = stats.players.length > 0 && openIds.size === stats.players.length;

  const commentary = useMemo(
    () => generateCommentary(stats.players, state.previousRankings),
    [stats.players, state.previousRankings]
  );

  const recentResults = useMemo(() => [...state.results].slice(-3).reverse(), [state.results]);

  const stageLabel = useMemo(() => {
    const stages = new Set(state.results.map(r => r.stage));
    if (stages.has("FINAL")) return "Final";
    if (stages.has("THIRD")) return "Third Place";
    if (stages.has("SF")) return "Semi-finals";
    if (stages.has("QF")) return "Quarter-finals";
    if (stages.has("R16")) return "Round of 16";
    if (stages.has("R32")) return "Round of 32";
    return "Group Stage";
  }, [state.results]);

  function toggleRow(id) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(stats.players.map(p => p.id)));
  }

  const [leaderPlayer, ...restPlayers] = stats.players;
  const rowPlayers = hasResults ? restPlayers : stats.players;

  return (
    <div className="board-wrap">
      {/* Eyebrow */}
      <div className="board-eyebrow">
        <span className="board-eyebrow-label">
          Standings · {stageLabel}
          {hasLive && <span style={{ marginLeft:6, color:"#c62828", fontSize:11, fontWeight:700, letterSpacing:"0.04em" }}>● LIVE</span>}
        </span>
        <div className="board-eyebrow-line" />
        <button
          className="btn-ghost"
          style={{ margin: 0, padding: "4px 10px", fontSize: 11.5 }}
          onClick={toggleAll}
        >
          {allOpen ? "Collapse" : "Expand all"}
        </button>
        {hasResults && (
          <span className="board-eyebrow-right">
            {state.results.length} result{state.results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!hasResults && (
        <div className="notice" style={{ marginLeft: 0, marginRight: 0 }}>
          No results in yet. Everyone's level on 0 — enjoy it while it lasts.
        </div>
      )}

      {/* Leader card */}
      {hasResults && leaderPlayer && (() => {
        const p = leaderPlayer;
        const alivePts = p.teams
          .filter(tid => !stats.eliminated.has(tid))
          .map(tid => stats.teamPts[tid] ?? 0);
        const topPts = alivePts.length > 0 ? Math.max(...alivePts) : 0;
        return (
          <div className="leader-card">
            <div className="leader-stripe" />
            <div className="leader-body">
              <div className="leader-eyebrow">Leader</div>
              <div className="leader-main">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="leader-name">{p.name}</div>
                  <div className="leader-sub">
                    {p.alive} team{p.alive !== 1 ? "s" : ""} alive
                    {p.teams.length - p.alive > 0 ? ` · ${p.teams.length - p.alive} out` : ""}
                  </div>
                </div>
                <div className="leader-pts-wrap">
                  <div className="leader-pts">{p.total}</div>
                  <div className="leader-pts-lbl">Points</div>
                </div>
              </div>
            </div>
            <div className="leader-chips">
              {p.teams.map(tid => {
                const t = TEAM[tid];
                const out = stats.eliminated.has(tid);
                const isTop = !out && topPts > 0 && (stats.teamPts[tid] ?? 0) === topPts;
                return (
                  <span key={tid} className={cls("chip", isTop && "chip-leader", out && "chip-out")}>
                    <span>{t.flag}</span>
                    <span className="chip-name">{t.name}</span>
                    {state.groupWinners?.[tid] && <span className="chip-star">★</span>}
                    <span className={isTop ? "chip-pts" : "chip-pts-plain"}>{stats.teamPts[tid] ?? 0}</span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Row cards */}
      {rowPlayers.map((p, i) => {
        const isOpen = openIds.has(p.id);
        const pct = leaderPts > 0 ? (p.total / leaderPts) * 100 : 0;
        const gap = leaderPts - p.total;
        const delay = `${(i + (hasResults ? 1 : 0)) * 0.05 + 0.05}s`;
        const alivePts = p.teams
          .filter(tid => !stats.eliminated.has(tid))
          .map(tid => stats.teamPts[tid] ?? 0);
        const topTeamPts = alivePts.length > 0 ? Math.max(...alivePts) : 0;
        return (
          <div key={p.id} className="row-wrap" style={{ animation: `rise .4s ${delay} ease both` }}>
            <button className="row" onClick={() => toggleRow(p.id)}>
              <div className="row-rank">{p.rank}</div>
              <div className="row-info">
                <div className="row-name">{p.name}</div>
                <div className="row-alive">{p.alive} alive</div>
              </div>
              <div className="row-score">
                <div className="row-pts">{p.total}</div>
                {hasResults && gap > 0 && <div className="row-gap">−{gap} pts</div>}
              </div>
              <svg
                className={cls("row-chev", isOpen && "row-chev-open")}
                width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {hasResults && leaderPts > 0 && (
              <div className="row-bar">
                <div className="row-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
            {isOpen && (
              <div className="row-teams">
                {p.teams.map(tid => {
                  const t = TEAM[tid];
                  const out = stats.eliminated.has(tid);
                  const isTop = !out && topTeamPts > 0 && (stats.teamPts[tid] ?? 0) === topTeamPts;
                  return (
                    <span key={tid} className={cls("chip", isTop && "chip-leader", out && "chip-out")}>
                      <span>{t.flag}</span>
                      <span className="chip-name">{t.name}</span>
                      {state.groupWinners?.[tid] && <span className="chip-star">★</span>}
                      <span className={isTop ? "chip-pts" : "chip-pts-plain"}>{stats.teamPts[tid] ?? 0}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Commentary */}
      {hasResults && commentary && (
        <div className="board-commentary">
          <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>⚽</span>
          <p>{commentary}</p>
        </div>
      )}

      {/* Recent results */}
      {recentResults.length > 0 && (
        <div className="board-results">
          <div className="board-results-head">
            <span className="board-results-title">Recent Results</span>
            <div style={{ flex: 1, height: 1, background: "var(--line)", margin: "0 8px" }} />
            <span className="board-results-label">
              {STAGE[recentResults[0]?.stage]?.label || ""}
            </span>
          </div>
          {recentResults.map(m => {
            const A = TEAM[m.teamA], B = TEAM[m.teamB];
            if (!A || !B) return null;
            const w = m.stage !== "GROUP" ? koWinner(m) : null;
            const aWon = m.stage === "GROUP" ? m.scoreA > m.scoreB : w === m.teamA;
            const bWon = m.stage === "GROUP" ? m.scoreB > m.scoreA : w === m.teamB;
            return (
              <div key={m.id} className="result-row">
                <div className="result-home">
                  <span className={aWon ? "result-name-win" : "result-name-draw"}>{A.name}</span>
                  <span>{A.flag}</span>
                </div>
                <span className="result-score">{m.scoreA} – {m.scoreB}</span>
                <div className="result-away">
                  <span>{B.flag}</span>
                  <span className={bWon ? "result-name-win" : "result-name-draw"}>{B.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button className="btn-report" onClick={onMatchdayReport} style={{ marginTop: 18 }}>
        📸 Matchday Report
      </button>
    </div>
  );
}

/* ---- Teams ---- */
function TeamsView({ state, stats, commit, unlocked, tryUnlock }) {
  const ownerOf = {};
  state.parts.forEach(p =>
    (state.assignments[p.id] || []).forEach(t => (ownerOf[t] = p.name))
  );
  const rows = [...stats.ownedTeams]
    .map(tid => ({
      t:     TEAM[tid],
      pts:   stats.teamPts[tid] ?? 0,
      owner: ownerOf[tid],
      out:   stats.eliminated.has(tid),
    }))
    .sort((a, b) => b.pts - a.pts || a.t.rank - b.t.rank);

  function toggle(field, tid) {
    if (!unlocked) { tryUnlock(); return; }
    commit({ ...state, [field]: { ...(state[field] || {}), [tid]: !state[field]?.[tid] } });
  }

  return (
    <div className="pane">
      <div className="pane-note dim">
        Group winners (★, +{stats.sc.groupWin} pts) and exits are filled in
        automatically from live results. Tap ★ or ✕ to override.
      </div>
      <div className="tlist">
        {rows.map(({ t, pts, owner, out }) => (
          <div key={t.id} className={cls("trow", out && "trow-out")}>
            <span className="trow-flag">{t.flag}</span>
            <span className="trow-name">
              {t.name}
              <span className="trow-tier">{TIERS[t.tier]}</span>
            </span>
            <span className="trow-owner dim">{owner}</span>
            <button
              className={cls("mini", state.groupWinners?.[t.id] && "mini-on")}
              title="Won group"
              onClick={() => toggle("groupWinners", t.id)}
            >★</button>
            <button
              className={cls("mini", state.eliminated?.[t.id] && "mini-red")}
              title="Eliminated"
              onClick={() => toggle("eliminated", t.id)}
            >✕</button>
            <span className="trow-pts mono">{pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Matches ---- */
const EMPTY_FORM = {
  stage: "GROUP", teamA: "", teamB: "",
  scoreA: "", scoreB: "", redsA: 0, redsB: 0, pensWinner: "",
};

/* ---- Live Scores Panel ---- */
function LiveScoresPanel({ state, espnMatches, onImport }) {
  const [open, setOpen] = useState(true);

  const existingPairs = new Set(
    state.results.map(m => [m.teamA, m.teamB].sort().join("|"))
  );

  const liveMatches  = espnMatches.filter(m => m.statusState === 'in');
  const newFinished  = espnMatches.filter(m => {
    if (m.statusState !== 'post') return false;
    const hId = apiTeamId(m.homeTeam);
    const aId = apiTeamId(m.awayTeam);
    if (!hId || !aId) return false;
    return !existingPairs.has([hId, aId].sort().join("|"));
  });

  function importNew() {
    const text = apiFixturesToPasteText(newFinished);
    if (text) onImport(text);
  }

  if (liveMatches.length === 0 && newFinished.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div className="card-title" style={{ marginBottom:0 }}>
          <span className="ls-dot" /> Live Scores
        </div>
        <button
          className="btn-ghost"
          style={{ marginTop:0, padding:"5px 12px", fontSize:13 }}
          onClick={() => setOpen(v => !v)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop:12 }}>

          {liveMatches.length > 0 && (
            <>
              <div className="dim small" style={{ marginBottom:6 }}>Live now — updates every minute</div>
              {liveMatches.map(m => {
                const hId = apiTeamId(m.homeTeam);
                const aId = apiTeamId(m.awayTeam);
                const hT  = hId ? TEAM[hId] : { name: m.homeTeam, flag: "🏳" };
                const aT  = aId ? TEAM[aId] : { name: m.awayTeam, flag: "🏳" };
                return (
                  <div key={m.id} className="ls-row">
                    <span className="mstage mono" style={{ fontSize:11, color:"var(--eng-red,#cf1b1b)" }}>
                      {m.displayClock || 'LIVE'}
                    </span>
                    <span className="ls-teams">
                      {hT.flag} {hT.name}{" "}
                      <strong className="mono">{m.homeScore ?? 0}–{m.awayScore ?? 0}</strong>{" "}
                      {aT.name} {aT.flag}
                    </span>
                    <span className="ls-new" style={{ background:"#c62828", color:"#fff" }}>live</span>
                  </div>
                );
              })}
            </>
          )}

          {newFinished.length > 0 && (
            <>
              <div className="dim small" style={{ marginBottom:6, marginTop: liveMatches.length > 0 ? 12 : 0 }}>
                Finished — not yet logged
              </div>
              {newFinished.map(m => {
                const hId = apiTeamId(m.homeTeam);
                const aId = apiTeamId(m.awayTeam);
                const hT  = hId ? TEAM[hId] : { name: m.homeTeam, flag: "🏳" };
                const aT  = aId ? TEAM[aId] : { name: m.awayTeam, flag: "🏳" };
                return (
                  <div key={m.id} className="ls-row">
                    <span className="mstage mono" style={{ fontSize:11 }}>FT</span>
                    <span className="ls-teams">
                      {hT.flag} {hT.name}{" "}
                      <strong className="mono">{m.homeScore}–{m.awayScore}</strong>{" "}
                      {aT.name} {aT.flag}
                    </span>
                    <span className="ls-new">new</span>
                  </div>
                );
              })}
              <button className="btn-primary" style={{ marginTop:12 }} onClick={importNew}>
                Import {newFinished.length} result{newFinished.length !== 1 ? "s" : ""} into paste box
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MatchesView({ state, stats, commit, unlocked, tryUnlock, addResultsToAll, espnMatches = [] }) {
  const [form, setForm]       = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [err, setErr]         = useState("");
  const [showPaste, setShowPaste]       = useState(false);
  const [pasteText, setPasteText]       = useState("");
  const [pastePreview, setPastePreview] = useState(null);

  const owned   = TEAMS.filter(t =>  stats.ownedTeams.has(t.id));
  const unowned = TEAMS.filter(t => !stats.ownedTeams.has(t.id));
  const stage   = STAGE[form.stage];
  const level   = form.scoreA !== "" && form.scoreA === form.scoreB;

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErr(""); }

  function submit() {
    if (!unlocked) { tryUnlock(); return; }
    const a = parseInt(form.scoreA, 10), b = parseInt(form.scoreB, 10);
    if (!form.teamA || !form.teamB)     { setErr("Pick both teams."); return; }
    if (form.teamA === form.teamB)      { setErr("A team can't play itself."); return; }
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) { setErr("Enter both scores."); return; }
    if (stage.ko && a === b && !form.pensWinner)  { setErr("Knockout draw — pick the pens winner."); return; }
    const match = {
      id: editing || "m" + Date.now().toString(36),
      stage: form.stage, teamA: form.teamA, teamB: form.teamB,
      scoreA: a, scoreB: b,
      redsA: Number(form.redsA) || 0,
      redsB: Number(form.redsB) || 0,
      pensWinner: stage.ko && a === b ? form.pensWinner : null,
      at: new Date().toISOString(),
    };
    if (editing) {
      // Edits stay local to this sweep only
      const results = state.results.map(m => (m.id === editing ? match : m));
      commit({ ...state, results });
    } else {
      // New result: broadcast to all sweeps on this device
      addResultsToAll([match]);
    }
    setForm(EMPTY_FORM);
    setEditing(null);
  }

  function edit(m) {
    if (!unlocked) { tryUnlock(); return; }
    setEditing(m.id);
    setForm({
      stage: m.stage, teamA: m.teamA, teamB: m.teamB,
      scoreA: String(m.scoreA), scoreB: String(m.scoreB),
      redsA: m.redsA, redsB: m.redsB, pensWinner: m.pensWinner || "",
    });
  }

  function remove(id) {
    if (!unlocked) { tryUnlock(); return; }
    if (!window.confirm("Delete this result?")) return;
    commit({ ...state, results: state.results.filter(m => m.id !== id) });
  }

  function handleParsePaste() {
    setPastePreview(parseResultsText(pasteText, state.results));
  }

  function handleLiveImport(text) {
    setShowPaste(true);
    setPasteText(text);
    setPastePreview(parseResultsText(text, state.results));
  }

  function applyPaste() {
    if (!unlocked) { tryUnlock(); return; }
    if (!pastePreview?.parsed?.length) return;
    addResultsToAll(pastePreview.parsed);
    setShowPaste(false);
    setPasteText("");
    setPastePreview(null);
  }

  const TeamSelect = ({ value, onChange, exclude }) => (
    <select className="inp sel" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Team…</option>
      <optgroup label="In the sweepstake">
        {owned.filter(t => t.id !== exclude).map(t => (
          <option key={t.id} value={t.id}>{t.flag} {t.name}</option>
        ))}
      </optgroup>
      {unowned.length > 0 && (
        <optgroup label="Unowned">
          {unowned.filter(t => t.id !== exclude).map(t => (
            <option key={t.id} value={t.id}>{t.flag} {t.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );

  const sorted = [...state.results].reverse();

  return (
    <div className="pane">
      <LiveScoresPanel state={state} espnMatches={espnMatches} onImport={handleLiveImport} />
      <div className="card">
        <div className="card-title">{editing ? "Edit result" : "Add result"}</div>
        <div className="frow">
          <select className="inp sel" value={form.stage} onChange={e => set("stage", e.target.value)}>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="frow score-row">
          <TeamSelect value={form.teamA} onChange={v => set("teamA", v)} exclude={form.teamB} />
          <input
            className="inp scorebox mono" inputMode="numeric" placeholder="0"
            value={form.scoreA} onChange={e => set("scoreA", e.target.value.replace(/\D/g, ""))}
          />
          <span className="dash">–</span>
          <input
            className="inp scorebox mono" inputMode="numeric" placeholder="0"
            value={form.scoreB} onChange={e => set("scoreB", e.target.value.replace(/\D/g, ""))}
          />
          <TeamSelect value={form.teamB} onChange={v => set("teamB", v)} exclude={form.teamA} />
        </div>
        <div className="frow reds-row">
          <label className="lbl-inline">
            🟥 {TEAM[form.teamA]?.name || "Team A"}
            <input className="inp redbox mono" inputMode="numeric" value={form.redsA}
              onChange={e => set("redsA", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="lbl-inline">
            🟥 {TEAM[form.teamB]?.name || "Team B"}
            <input className="inp redbox mono" inputMode="numeric" value={form.redsB}
              onChange={e => set("redsB", e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        {stage.ko && level && form.scoreA !== "" && (
          <div className="frow">
            <label className="lbl">Won on penalties</label>
            <select className="inp sel" value={form.pensWinner} onChange={e => set("pensWinner", e.target.value)}>
              <option value="">Pick winner…</option>
              {form.teamA && <option value={form.teamA}>{TEAM[form.teamA].flag} {TEAM[form.teamA].name}</option>}
              {form.teamB && <option value={form.teamB}>{TEAM[form.teamB].flag} {TEAM[form.teamB].name}</option>}
            </select>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="frow">
          <button className="btn-primary" onClick={submit}>
            {editing ? "Save changes" : "Add result"}
          </button>
          {editing && (
            <button className="btn-ghost" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Paste results</div>
          <button
            className="btn-ghost"
            style={{ marginTop: 0, padding: "5px 12px", fontSize: 13 }}
            onClick={() => { setShowPaste(v => !v); setPastePreview(null); setPasteText(""); }}
          >
            {showPaste ? "Close" : "Open"}
          </button>
        </div>
        {showPaste && (
          <>
            <div className="dim small" style={{ marginTop: 10, marginBottom: 8 }}>
              One result per line:
              <pre style={{ marginTop: 6, background: "var(--pitch)", padding: "8px 10px", borderRadius: 7, fontSize: 12, color: "var(--chalk)", lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre" }}>
{`GROUP: Spain 2-1 France
GROUP: USA 0-0 Mexico
R16: Argentina 1-1 England (pens: Argentina)`}
              </pre>
            </div>
            <textarea
              className="inp ta"
              rows={5}
              placeholder={"GROUP: Spain 2-1 France\nGROUP: USA 0-0 Mexico"}
              value={pasteText}
              onChange={e => { setPasteText(e.target.value); setPastePreview(null); }}
            />
            {pastePreview && (
              <div style={{ marginTop: 12 }}>
                {pastePreview.parsed.length > 0 && (
                  <div className="import-preview">
                    <div className="import-preview-title">
                      ✓ {pastePreview.parsed.length} result{pastePreview.parsed.length !== 1 ? "s" : ""} ready
                    </div>
                    {pastePreview.parsed.map(m => {
                      const A = TEAM[m.teamA], B = TEAM[m.teamB];
                      return (
                        <div key={m.id} className="import-row">
                          <span className="mstage mono">{STAGE[m.stage].short}</span>
                          <span style={{ flex: 1 }}>
                            {A.flag} {A.name} <strong className="mono">{m.scoreA}–{m.scoreB}</strong> {B.name} {B.flag}
                          </span>
                          {m.pensWinner && (
                            <span className="dim" style={{ fontSize: 12 }}>pens: {TEAM[m.pensWinner]?.name}</span>
                          )}
                          {(m.redsA > 0 || m.redsB > 0) && (
                            <span className="dim" style={{ fontSize: 12 }}>🟥 {m.redsA}-{m.redsB}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {pastePreview.dupes.length > 0 && (
                  <div className="warn" style={{ marginTop: 8 }}>
                    Already logged — skipped: {pastePreview.dupes.join(", ")}
                  </div>
                )}
                {pastePreview.errors.length > 0 && (
                  <div className="err" style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
                    {pastePreview.errors.join("\n")}
                  </div>
                )}
              </div>
            )}
            <div className="frow" style={{ marginTop: 14 }}>
              {!pastePreview ? (
                <button
                  className="btn-primary"
                  style={{ marginTop: 0 }}
                  onClick={handleParsePaste}
                  disabled={!pasteText.trim()}
                >
                  Parse
                </button>
              ) : pastePreview.parsed.length > 0 ? (
                <>
                  <button className="btn-primary" style={{ marginTop: 0 }} onClick={applyPaste}>
                    Import {pastePreview.parsed.length} result{pastePreview.parsed.length !== 1 ? "s" : ""}
                  </button>
                  <button className="btn-ghost" style={{ marginTop: 0 }} onClick={() => setPastePreview(null)}>
                    Re-parse
                  </button>
                </>
              ) : (
                <button className="btn-ghost" style={{ marginTop: 0 }} onClick={() => setPastePreview(null)}>
                  Try again
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mlist">
        {sorted.length === 0 && <div className="notice">No matches yet. The table moves the moment you add one.</div>}
        {sorted.map(m => {
          const A = TEAM[m.teamA], B = TEAM[m.teamB];
          const w = m.stage !== "GROUP" ? koWinner(m) : null;
          return (
            <div key={m.id} className="mrow">
              <span className="mstage mono">{STAGE[m.stage].short}</span>
              <span className={cls("mteam", w === m.teamA && "mwin")}>{A.flag} {A.name}</span>
              <span className="mscore mono">{m.scoreA}–{m.scoreB}</span>
              <span className={cls("mteam mteam-r", w === m.teamB && "mwin")}>{B.name} {B.flag}</span>
              <span className="mmeta dim">
                {(m.redsA > 0 || m.redsB > 0) && `🟥${m.redsA + m.redsB} `}
                {m.pensWinner && "pens"}
              </span>
              <button className="mini" onClick={() => edit(m)} title="Edit">✎</button>
              <button className="mini mini-red" onClick={() => remove(m.id)} title="Delete">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Setup ---- */
function SetupView({ state, commit, sweepId, unlocked, tryUnlock, showReveal, resetAll }) {
  const [sc, setSc]   = useState({ ...DEFAULT_SCORING, ...(state.scoring || {}) });
  const [orgPin, setOrgPin] = useState(state.organiserPin || "");
  const [nameEdit, setNameEdit] = useState(state.name || "");
  const [copied, setCopied] = useState(false);
  const [showImport, setShowImport]     = useState(false);
  const [importText, setImportText]     = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importErr, setImportErr]       = useState("");

  const viewPin = state.viewPin || sweepId;
  const shareUrl = `${window.location.origin}${window.location.pathname}?s=${encodeURIComponent(sweepId)}`;

  function guard(fn) {
    return () => { if (!unlocked) { tryUnlock(); return; } fn(); };
  }

  function copyShare() {
    const msg = `Join my World Cup 2026 sweepstake "${state.name}"!\n\nLink: ${shareUrl}\nPIN: ${viewPin}`;
    navigator.clipboard?.writeText(msg).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {}
    );
  }

  function handleParseImport() {
    setImportErr("");
    const result = parseDrawTable(importText);
    if (result.error) { setImportErr(result.error); return; }
    setImportPreview(result);
    if (result.errors?.length) setImportErr("Warnings: " + result.errors.join(", "));
  }

  function applyImport() {
    if (!importPreview) return;
    if (!window.confirm(
      `Replace the current draw with the imported one? Results stay, but points will reflect new assignments.`
    )) return;
    commit({
      ...state,
      parts: importPreview.parts,
      assignments: importPreview.assignments,
      teamsPer: importPreview.teamsPer,
      groupWinners: {},
      eliminated: {},
      previousRankings: {},
      createdAt: new Date().toISOString(),
    });
    setShowImport(false);
    setImportText("");
    setImportPreview(null);
    setImportErr("");
  }

  return (
    <div className="pane">
      {!unlocked && state.organiserPin && (
        <div className="notice">
          Read-only — entering results needs the organiser PIN.{" "}
          <button className="linklike" onClick={tryUnlock}>Unlock</button>
        </div>
      )}

      <div className="card">
        <div className="card-title">Sweepstake name</div>
        <div className="frow" style={{ marginTop: 0 }}>
          <input
            className="inp"
            value={nameEdit}
            onChange={e => setNameEdit(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn-ghost" style={{ marginTop: 0 }} onClick={guard(() => {
            const v = nameEdit.trim();
            if (!v) { window.alert("Give the sweepstake a name."); return; }
            commit({ ...state, name: v });
          })}>Rename</button>
        </div>
        <div className="dim small">Renaming updates it for everyone using this sweepstake.</div>
      </div>

      <div className="card">
        <div className="card-title">Share this sweepstake</div>
        <div className="share-pin-row">
          <span className="dim small">Sweepstake PIN</span>
          <span className="share-pin mono">{viewPin}</span>
        </div>
        <div className="dim small" style={{ margin: "8px 0 12px" }}>
          Send people the link and PIN. They enter the PIN on the home screen to view the table.
        </div>
        <button className="btn-primary" style={{ marginTop: 0 }} onClick={copyShare}>
          {copied ? "✓ Copied" : "📋 Copy invite (link + PIN)"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Scoring</div>
        <div className="scgrid">
          {Object.keys(SCORING_LABELS).map(k => (
            <label key={k} className="scitem">
              <span>{SCORING_LABELS[k]}</span>
              <input
                className="inp scnum mono"
                inputMode="numeric"
                value={sc[k]}
                onChange={e => setSc({ ...sc, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <button className="btn-primary" onClick={guard(() => {
          const clean = {};
          Object.keys(SCORING_LABELS).forEach(k => {
            const v = parseInt(sc[k], 10);
            clean[k] = isNaN(v) ? DEFAULT_SCORING[k] : v;
          });
          setSc(clean);
          commit({ ...state, scoring: clean });
        })}>Save scoring</button>
        <div className="dim small">Changing scoring recalculates every result instantly.</div>
      </div>

      <div className="card">
        <div className="card-title">The draw</div>
        <div className="dim small" style={{ marginBottom: 10 }}>
          Drawn {new Date(state.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          {" · "}{state.parts.map(p => p.name).join(", ")}
        </div>
        <div className="frow">
          <button className="btn-ghost" onClick={showReveal}>Replay the draw</button>
          <button className="btn-ghost" onClick={guard(() => {
            if (!window.confirm("Redraw all teams? Results stay, but points land on the new owners. Best done before kick-off.")) return;
            const { parts, assignments } = runDraw(state.parts.map(p => p.name), state.teamsPer);
            commit({ ...state, parts, assignments, groupWinners: {}, eliminated: {}, previousRankings: {}, createdAt: new Date().toISOString() });
          })}>Redraw teams</button>
          <button className="btn-ghost" onClick={guard(() => setShowImport(v => !v))}>
            {showImport ? "Cancel import" : "Import draw"}
          </button>
        </div>

        {showImport && (
          <div style={{ marginTop: 14 }}>
            <div className="dim small" style={{ marginBottom: 8 }}>
              Paste a tab-separated draw table (participant names in column 1, team names in the rest). Copy-paste from Excel or Sheets works directly.
            </div>
            <textarea
              className="inp ta"
              rows={9}
              placeholder={"PARTICIPANT\tTIER 1\tTIER 2\t…\nAlex\tFrance 🇫🇷\tUSA 🇺🇸\t…"}
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportPreview(null); setImportErr(""); }}
            />
            {importErr && (
              <div className={importPreview ? "warn" : "err"} style={{ whiteSpace: "pre-wrap" }}>
                {importErr}
              </div>
            )}
            {importPreview && (
              <div className="import-preview">
                <div className="import-preview-title">
                  ✓ {importPreview.parts.length} participants · {importPreview.teamsPer} teams each
                </div>
                {importPreview.parts.map(p => (
                  <div key={p.id} className="import-row">
                    <span className="import-name">{p.name}</span>
                    <span className="import-flags">
                      {(importPreview.assignments[p.id] || []).map(tid => {
                        const t = TEAM[tid];
                        return t ? <span key={tid} title={t.name}>{t.flag}</span> : null;
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="frow" style={{ marginTop: 12 }}>
              {!importPreview ? (
                <button
                  className="btn-ghost"
                  style={{ marginTop: 0 }}
                  onClick={handleParseImport}
                  disabled={!importText.trim()}
                >Parse draw</button>
              ) : (
                <>
                  <button className="btn-primary" style={{ marginTop: 0 }} onClick={applyImport}>
                    Apply this draw
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ marginTop: 0 }}
                    onClick={() => { setImportPreview(null); setImportErr(""); }}
                  >Re-parse</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Organiser PIN</div>
        <div className="frow">
          <input
            className="inp" style={{ maxWidth: 160 }}
            placeholder="No PIN set" value={orgPin}
            onChange={e => setOrgPin(e.target.value)}
          />
          <button className="btn-ghost" onClick={guard(() => {
            const v = orgPin.trim();
            if (v && v === viewPin) { window.alert("Organiser PIN must differ from the sweepstake PIN."); return; }
            commit({ ...state, organiserPin: v || null });
          })}>
            {orgPin.trim() ? "Set PIN" : "Remove PIN"}
          </button>
        </div>
        <div className="dim small">With an organiser PIN, anyone with the sweepstake PIN can view, but only the organiser can enter results.</div>
      </div>

      <div className="card card-danger">
        <div className="card-title">Danger zone</div>
        <button className="btn-danger" onClick={guard(() => {
          if (window.confirm("Wipe EVERYTHING — players, draw, results — for everyone using this page?")) resetAll();
        })}>Reset entire sweepstake</button>
      </div>

      <div className="dim small" style={{ padding: "0 4px" }}>
        Everyone who enters this sweepstake's PIN shares the same live data. Share the PIN, the table updates for all.
      </div>
    </div>
  );
}

/* ---- Matchday Share Modal ---- */
function ShareModal({ state, onClose }) {
  const stats       = useMemo(() => buildStats(state), [state]);
  const commentary  = useMemo(
    () => generateCommentary(stats.players, state.previousRankings),
    [stats.players, state.previousRankings]
  );

  const canvasRef    = useRef(null);
  const [shareImg, setShareImg] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [ready, setReady]     = useState(false);

  useEffect(() => {
    // Small timeout lets the modal paint before the canvas draw
    const id = setTimeout(() => {
      const c = buildShareCanvas(stats.players, commentary, state.name, stats.eliminated);
      canvasRef.current = c;
      // Convert to data URL so React renders a plain <img> — avoids direct DOM
      // manipulation that breaks React's reconciler on modal close.
      setShareImg(c.toDataURL("image/png"));
      setReady(true);
    }, 80);
    return () => clearTimeout(id);
  }, []); // intentionally only on mount

  function handleDone() {
    // Snapshot current rankings so next report shows deltas
    const prevRanks = {};
    stats.players.forEach(p => { prevRanks[p.id] = { rank: p.rank, total: p.total }; });
    onClose({ ...state, previousRankings: prevRanks });
  }

  async function handleShare() {
    const c = canvasRef.current;
    if (!c || !ready) return;
    setSharing(true);
    let blob = null;
    try {
      blob = await new Promise((resolve, reject) => {
        c.toBlob(
          b => b ? resolve(b) : reject(new Error("Canvas export returned null.")),
          "image/png"
        );
      });
      const file = new File([blob], "sweepstake-standings.png", { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: state.name });
      } else if (navigator.share) {
        await navigator.share({ title: state.name, url: window.location.href });
      } else {
        downloadBlob(blob);
      }
    } catch (e) {
      if (e.name !== "AbortError" && blob) downloadBlob(blob);
    } finally {
      setSharing(false);
    }
  }

  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url; a.download = "standings.png"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) handleDone(); }}>
      <div className="modal">
        <div className="modal-head">
          <span className="card-title">Matchday Report</span>
          <button className="btn-icon" onClick={handleDone}>✕</button>
        </div>
        <div className="canvas-wrap">
          {shareImg
            ? <img src={shareImg} alt="Sweepstake standings" style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: "10px" }} />
            : <div className="canvas-placeholder" />
          }
        </div>
        <div className="modal-commentary dim">{commentary}</div>
        <div className="modal-foot">
          <button className="btn-primary modal-share-btn" onClick={handleShare} disabled={!ready || sharing}>
            {sharing ? "Sharing…" : "📤 Share"}
          </button>
          <button className="btn-ghost modal-done-btn" onClick={handleDone}>Done</button>
        </div>
        <p className="dim small" style={{ textAlign: "center", marginTop: 6, marginBottom: 0 }}>
          On iPhone, tap Share to save to Photos or send to Snapchat directly.
          Tapping Done snapshots the table so next report shows movement.
        </p>
      </div>
    </div>
  );
}

/* ---- Styles ---- */
function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&display=swap');

      @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.2} }
      @keyframes rise    { from { opacity:0; transform:translateY(10px); } }
      @keyframes barFill { from { transform:scaleX(0); } }
      @keyframes pop     { to { opacity:1; transform:none; } }
      @keyframes ls-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

      :root {
        --accent:       #C8000A;
        --on-accent:    #FFFFFF;
        --accent-soft:  #fce8e9;
        --accent-line:  #f0b3b5;
        --accent-faint: #c87070;
        --bg:           #EDE6DC;
        --card:         #FFFFFF;
        --ink:          #141414;
        --muted:        #B0A89E;
        --line:         #E5DDD3;
        --rank:         #DDD6CE;
        --track:        #F2ECE5;
        --chip-bg:      #FAFAF8;
        --chip-border:  #E5DDD3;
        --dead-bg:      #F8F6F4;
        --dead-border:  #EAE4DC;
        --faint:        #CCCCCC;
        --tnum:         #888888;
        /* legacy aliases */
        --pitch:    #EDE6DC;
        --panel:    #FFFFFF;
        --panel-2:  #F5EFE8;
        --chalk:    #141414;
        --dim:      #B0A89E;
        --gold:     #C8000A;
        --gold-dk:  #a00008;
        --signal:   #D32F2F;
        --win:      #1a7a42;
      }

      *, *::before, *::after { box-sizing: border-box; margin: 0; }

      .app {
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-size: 15px;
        line-height: 1.45;
        -webkit-font-smoothing: antialiased;
      }

      .display { font-family: 'Archivo Black', system-ui, sans-serif; letter-spacing: .01em; line-height: .95; }
      .mono    { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
      .dim     { color: var(--muted); }
      .small   { font-size: 12.5px; margin-top: 8px; }
      button   { font: inherit; color: inherit; cursor: pointer; }

      /* splash */
      .splash       { min-height: 100vh; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; }
      .splash-badge { font-family: 'Archivo Black'; font-size: 28px; color: var(--on-accent); background: var(--accent); padding: 6px 14px; border-radius: 6px; }
      .splash-text  { color: var(--muted); }

      /* setup */
      .setup        { max-width: 640px; margin: 0 auto; padding: 48px 20px 40px; }
      .setup-eyebrow { font-size: 11px; letter-spacing: .22em; color: var(--accent); font-weight: 700; }
      .setup-title  { font-size: clamp(44px,10vw,76px); margin: 10px 0 14px; color: var(--ink); }
      .setup-sub    { color: var(--muted); max-width: 520px; margin-bottom: 26px; }

      .card           { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 16px; }
      .card-title     { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; color: var(--accent); margin-bottom: 14px; }
      .card-danger    { border-color: #fca5a5; }

      .lbl            { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; }
      .lbl:first-child { margin-top: 0; }
      .inp            { width: 100%; background: var(--bg); border: 1px solid var(--line); color: var(--ink); border-radius: 9px; padding: 10px 12px; font: inherit; outline: none; }
      .inp:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
      .ta             { resize: vertical; min-height: 120px; }
      .sel            { appearance: auto; width: auto; min-width: 0; flex: 1; }
      .err            { color: var(--signal); margin-top: 12px; font-size: 14px; }

      .btn-primary    { margin-top: 16px; background: var(--accent); color: var(--on-accent); border: none; border-radius: 10px; padding: 12px 22px; font-weight: 700; letter-spacing: .03em; }
      .btn-primary:hover { opacity: .88; }
      .btn-primary:disabled { opacity: .4; cursor: default; }
      .btn-ghost      { margin-top: 16px; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 11px 18px; color: var(--ink); }
      .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
      .btn-danger     { margin-top: 4px; background: transparent; border: 1px solid #fca5a5; color: var(--signal); border-radius: 10px; padding: 11px 18px; }
      .linklike       { background: none; border: none; color: var(--accent); text-decoration: underline; padding: 0; }

      .btn-report     { display: block; width: 100%; background: transparent; border: 1px solid var(--accent-line); color: var(--accent); border-radius: 12px; padding: 14px; font-weight: 600; font-size: 15px; letter-spacing: .03em; text-align: center; }
      .btn-report:hover { background: var(--accent-soft); }

      .setup-mathrow  { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin-top: 16px; padding: 12px; background: var(--bg); border-radius: 10px; border: 1px dashed var(--line); }
      .big            { font-size: 20px; font-weight: 700; color: var(--accent); }
      .stepper        { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
      .step           { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }

      /* reveal */
      .reveal         { max-width: 760px; margin: 0 auto; padding: 40px 20px; }
      .reveal-head    { margin-bottom: 24px; }
      .reveal-round   { margin-bottom: 22px; }
      .reveal-roundlbl { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
      .reveal-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px,1fr)); gap: 8px; }
      .pick           { display: flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; opacity: 0; transform: translateY(8px) scale(.97); animation: pop .45s cubic-bezier(.2,.9,.3,1.2) forwards; }
      .pick-flag      { font-size: 18px; }
      .pick-team      { font-weight: 700; }
      .pick-owner     { margin-left: auto; color: var(--accent); font-size: 13px; }
      .reveal-skip .pick { animation-delay: 0s !important; }
      .reveal-actions { display: flex; gap: 12px; margin-top: 10px; }

      /* main shell */
      .main { min-height: 100vh; }

      /* header */
      .hdr          { background: var(--accent); height: 54px; display: flex; align-items: center; gap: 14px; padding: 0 20px; }
      .hdr-badge    { font-family: 'Archivo Black'; font-size: 14px; color: var(--accent); background: #fff; border-radius: 4px; padding: 6px 10px; letter-spacing: .03em; flex-shrink: 0; line-height: 1; border: none; cursor: pointer; }
      .hdr-home:hover { background: #f2f2f2; }
      .hdr-title    { font-family: 'Archivo Black'; font-size: 17px; color: var(--on-accent); flex: 1; letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hdr-right    { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .hdr-live     { display: flex; align-items: center; gap: 6px; color: var(--on-accent); }
      .live-dot     { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--on-accent); animation: pulse 1.4s ease-in-out infinite; flex-shrink: 0; }
      .live-label   { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; color: var(--on-accent); }
      .savestate    { font-size: 11px; color: rgba(255,255,255,.7); min-width: 40px; text-align: right; }
      .savestate.error { color: #ffcdd2; }
      .savestate.saved { color: #c8e6c9; }
      .sweep-switch { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); color: #fff; border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 12px; max-width: 110px; }
      .btn-icon     { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); border-radius: 6px; width: 30px; height: 30px; color: #fff; display: inline-flex; align-items: center; justify-content: center; }

      /* nav tabs */
      .tabs   { background: var(--card); border-bottom: 3px solid var(--ink); padding: 0 20px; display: flex; overflow-x: auto; position: sticky; top: 0; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
      .tab    { background: none; border: none; cursor: pointer; padding: 13px 18px 11px; font: 600 11.5px 'Space Grotesk',sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); border-bottom: 3px solid transparent; margin-bottom: -3px; white-space: nowrap; transition: color .15s; }
      .tab-on { color: var(--ink); font-weight: 700; border-bottom-color: var(--accent); }
      .tab:hover:not(.tab-on) { color: var(--ink); }

      /* pane (non-table tabs) */
      .pane       { max-width: 720px; margin: 0 auto; padding: 16px 16px 40px; }
      .pane-note  { font-size: 13px; margin-bottom: 12px; padding: 0 2px; color: var(--muted); }
      .notice     { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; color: var(--muted); margin-bottom: 14px; font-size: 14px; }

      /* ── LEADERBOARD ── */
      .board-wrap { max-width: 680px; margin: 0 auto; padding: 0 16px 80px; }

      .board-eyebrow       { display: flex; align-items: center; gap: 8px; margin: 22px 0 14px; }
      .board-eyebrow-label { font-size: 9.5px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
      .board-eyebrow-line  { flex: 1; height: 1px; background: var(--line); }
      .board-eyebrow-right { font-size: 9.5px; font-weight: 600; color: var(--muted); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }

      /* Leader card */
      .leader-card     { background: var(--card); border-radius: 4px; overflow: hidden; border: 1px solid var(--line); box-shadow: 0 2px 18px rgba(0,0,0,.06), 0 1px 4px rgba(0,0,0,.05); position: relative; margin-bottom: 6px; animation: rise .4s .05s ease both; }
      .leader-stripe   { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--accent); }
      .leader-body     { padding: 20px 22px 0 26px; }
      .leader-eyebrow  { font-size: 9px; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
      .leader-main     { display: flex; align-items: flex-end; gap: 12px; }
      .leader-name     { font-family: 'Archivo Black'; font-size: 50px; line-height: .88; color: var(--ink); text-transform: uppercase; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .leader-sub      { font-size: 12px; color: var(--muted); margin-top: 10px; font-weight: 500; }
      .leader-pts-wrap { text-align: right; flex-shrink: 0; padding-bottom: 2px; }
      .leader-pts      { font-family: 'Archivo Black'; font-size: 58px; color: var(--accent); line-height: .82; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
      .leader-pts-lbl  { font-size: 9px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--accent-faint); margin-top: 7px; }
      .leader-chips    { display: flex; flex-wrap: wrap; gap: 6px; padding: 16px 22px 22px 26px; }

      /* Row cards */
      .row-wrap       { background: var(--card); border-radius: 4px; border: 1px solid var(--line); overflow: hidden; margin-bottom: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.04); transition: border-color .15s; }
      .row-wrap:hover { border-color: var(--accent); }
      .leader         { } /* no override needed */
      .row            { display: flex; align-items: center; width: 100%; padding: 16px 18px; background: none; border: none; cursor: pointer; text-align: left; color: var(--ink); }
      .row-rank       { font-family: 'Archivo Black'; font-size: 24px; color: var(--rank); width: 44px; text-align: center; flex-shrink: 0; font-variant-numeric: tabular-nums; line-height: 1; }
      .row-info       { flex: 1; min-width: 0; }
      .row-name       { font-weight: 700; font-size: 16px; line-height: 1.2; }
      .row-alive      { font-size: 11.5px; color: var(--muted); margin-top: 2px; font-weight: 500; }
      .row-score      { text-align: right; flex-shrink: 0; margin-right: 12px; }
      .row-pts        { font-family: 'Archivo Black'; font-size: 30px; color: var(--accent); line-height: 1; font-variant-numeric: tabular-nums; }
      .row-gap        { font-size: 10px; color: var(--faint); font-weight: 500; margin-top: 2px; }
      .row-chev       { flex-shrink: 0; color: var(--faint); transition: transform .2s cubic-bezier(.4,0,.2,1), color .15s; }
      .row-chev-open  { transform: rotate(180deg); color: var(--accent); }
      .row-bar        { height: 3px; background: var(--track); }
      .row-bar-fill   { height: 100%; background: var(--accent); transform-origin: left; animation: barFill .8s .5s cubic-bezier(.4,0,.2,1) both; }
      .row-teams      { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 18px 16px 62px; }
      .leader-tag     { display: none; }
      .gapnote        { display: none; }

      /* Team chips */
      .chip          { display: inline-flex; align-items: center; gap: 6px; background: var(--chip-bg); border: 1px solid var(--chip-border); border-radius: 4px; padding: 5px 10px; font-size: 13px; font-weight: 500; }
      .chip-leader   { background: var(--accent-soft); border-color: var(--accent-line); }
      .chip-out      { opacity: .38; }
      .chip-out .chip-name { text-decoration: line-through; text-decoration-color: var(--muted); }
      .chip-star     { color: var(--accent); font-size: 10px; line-height: 1; }
      .chip-pts      { font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
      .chip-pts-plain { font-weight: 700; color: var(--tnum); font-variant-numeric: tabular-nums; }

      /* Knockout bracket — two-sided tree */
      .bracket-wrap   { padding: 4px 0 24px; }
      .bkt-note       { font-size: 12px; color: var(--muted); margin: 10px 0 12px; line-height: 1.5; }
      .bkt-zoom       { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }
      .bkt-zoom button { min-width: 30px; height: 30px; padding: 0; border: 1px solid var(--line); background: var(--card); border-radius: 6px; font: 700 17px/1 'Space Grotesk',sans-serif; color: var(--ink); display: flex; align-items: center; justify-content: center; }
      .bkt-zoom button:hover { border-color: var(--accent-line); color: var(--accent); }
      .bkt-zoom .bkt-zoom-fit { min-width: 56px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
      .bkt-viewport   { overflow: auto; max-height: 78vh; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); -webkit-overflow-scrolling: touch; }
      .bkt-sizer      { overflow: hidden; }
      .bkt-scaler     { display: inline-block; transform-origin: top left; }
      .bkt-tree       { display: flex; align-items: stretch; gap: 16px; width: max-content; padding: 6px 8px 14px; min-height: 640px; }
      .bkt-col        { display: flex; flex-direction: column; flex: 0 0 auto; width: 152px; }
      .bkt-col-center { width: 172px; }
      .bkt-colhead    { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); font-weight: 700; text-align: center; padding-bottom: 8px; }
      .bkt-colbody    { flex: 1; display: flex; flex-direction: column; justify-content: space-around; }
      .bkt-tie        { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; }
      .bkt-tie-own    { border-color: var(--accent-line); box-shadow: inset 0 0 0 1px var(--accent-line); }
      .bkt-final      { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
      .bkt-num        { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); font-weight: 700; margin-bottom: 3px; }
      .bkt-final .bkt-num { color: var(--accent); }
      .bkt-team       { display: flex; align-items: center; gap: 6px; padding: 4px 1px; font-size: 13px; font-weight: 600; }
      .bkt-team + .bkt-team { border-top: 1px solid var(--line); }
      .bkt-flag       { font-size: 14px; line-height: 1; }
      .bkt-name       { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bkt-dot        { color: var(--accent); font-size: 8px; line-height: 1; }
      .bkt-pen        { font-size: 8.5px; font-weight: 700; color: var(--win); background: #e7f3ec; border-radius: 2px; padding: 0 3px; }
      .bkt-score      { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--tnum); min-width: 12px; text-align: right; }
      .bkt-ph         { color: var(--muted); font-style: italic; font-weight: 500; font-size: 11.5px; }
      .bkt-own        { color: var(--accent); }
      .bkt-win .bkt-name  { color: var(--win); }
      .bkt-win .bkt-score { color: var(--win); }
      .bkt-dead       { opacity: .42; }
      .bkt-dead .bkt-name { text-decoration: line-through; text-decoration-color: var(--muted); }
      .bkt-thirdplace { margin-top: 14px; max-width: 230px; }
      .bkt-3rd-head   { text-align: left; }

      /* Predictions — tappable bracket + leaderboard (reuses .bkt-* layout) */
      .bkt-pickbtn    { width: 100%; text-align: left; background: none; border: 0; border-radius: 4px; cursor: pointer; color: inherit; font: inherit; }
      .bkt-pickbtn:disabled { cursor: default; }
      .bkt-pickbtn:not(:disabled):hover { background: var(--bg); }
      .bkt-pick       { background: var(--accent-line); }
      .bkt-pick .bkt-name { color: var(--accent); font-weight: 700; }
      .bkt-pick-locked:not(.bkt-pick) { opacity: .8; }
      .bkt-correct    { background: #e7f3ec; }
      .bkt-correct .bkt-name { color: var(--win); }
      .bkt-wrong      { background: #f7e3e4; }
      .bkt-wrong .bkt-name   { color: var(--accent); text-decoration: line-through; text-decoration-color: var(--accent-line); }
      .bkt-actual .bkt-name  { color: var(--win); }
      .bkt-mark       { font-size: 10px; font-weight: 800; line-height: 1; }
      .bkt-mark-ok    { color: var(--win); }
      .bkt-mark-no    { color: var(--accent); }
      .bkt-pick-ph    { padding-left: 6px; }
      .bkt-lock       { font-size: 9px; margin-left: 4px; opacity: .55; }
      .pred-linkbtn   { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

      .pred-bar       { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 4px; }
      .pred-who       { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--muted); }
      .pred-who select { font: inherit; font-weight: 600; color: var(--ink); padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); }
      .pred-actions   { display: flex; align-items: center; gap: 10px; }
      .pred-savebar   { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 10px; padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 -2px 10px rgba(0,0,0,.06); }
      .pred-progress  { font-size: 11px; font-weight: 700; letter-spacing: .04em; color: var(--muted); font-variant-numeric: tabular-nums; }
      .pred-save      { padding: 7px 14px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: #fff; font: 700 12px/1 'Space Grotesk',sans-serif; cursor: pointer; }
      .pred-save:disabled { background: var(--card); color: var(--muted); border-color: var(--line); cursor: default; }
      .pred-board-wrap { margin-top: 8px; }
      .pred-roster    { font-size: 12px; color: var(--muted); line-height: 1.6; }
      .pred-table     { width: 100%; border-collapse: collapse; font-size: 13px; }
      .pred-table th  { text-align: left; font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--line); }
      .pred-table td  { padding: 9px 10px; border-bottom: 1px solid var(--line); font-weight: 600; }
      .pred-table .num { text-align: right; font-variant-numeric: tabular-nums; }
      .pred-table .pred-champ { color: var(--muted); font-weight: 600; }
      .pred-table tr.pred-me td { background: var(--accent-line); }
      .pred-table tr.pred-row { cursor: pointer; }
      .pred-table tr.pred-row:hover td { background: var(--bg); }
      .pred-table tr.pred-row.pred-me:hover td { background: var(--accent-line); }

      /* Commentary & results */
      .board-commentary    { margin-top: 18px; display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 4px; animation: rise .4s .3s ease both; }
      .board-commentary p  { font-size: 12.5px; color: var(--muted); margin: 0; line-height: 1.6; font-weight: 500; }
      .board-results       { margin-top: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; animation: rise .4s .35s ease both; }
      .board-results-head  { display: flex; align-items: center; gap: 8px; padding: 12px 16px 10px; }
      .board-results-title { font-size: 9.5px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); }
      .board-results-label { font-size: 9.5px; font-weight: 600; color: var(--muted); letter-spacing: .1em; text-transform: uppercase; }
      .result-row          { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-top: 1px solid var(--line); }
      .result-home         { flex: 1; display: flex; align-items: center; gap: 7px; justify-content: flex-end; min-width: 0; }
      .result-away         { flex: 1; display: flex; align-items: center; gap: 7px; min-width: 0; }
      .result-score        { font-family: 'Archivo Black'; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .result-name-win     { white-space: nowrap; font-size: 13px; font-weight: 700; color: var(--ink); }
      .result-name-draw    { white-space: nowrap; font-size: 13px; font-weight: 500; color: var(--muted); }

      /* Teams */
      .tlist     { display: flex; flex-direction: column; gap: 6px; }
      .trow      { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; }
      .trow-out  { opacity: .5; }
      .trow-out .trow-name { text-decoration: line-through; }
      .trow-flag  { font-size: 18px; }
      .trow-name  { font-weight: 700; flex: 1; min-width: 0; color: var(--ink); }
      .trow-tier  { display: block; font-size: 10.5px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
      .trow-owner { font-size: 13px; color: var(--muted); }
      .trow-pts   { font-size: 17px; font-weight: 700; color: var(--accent); min-width: 34px; text-align: right; }
      .mini       { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--muted); flex-shrink: 0; }
      .mini-on    { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
      .mini-red   { border-color: #fca5a5; color: var(--signal); }

      /* Matches */
      .frow             { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
      .frow:first-of-type { margin-top: 0; }
      .score-row        { flex-wrap: nowrap; }
      .scorebox         { width: 52px; text-align: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
      .dash             { color: var(--muted); flex-shrink: 0; }
      .reds-row         { gap: 18px; }
      .lbl-inline       { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
      .redbox           { width: 46px; text-align: center; }
      .mlist            { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; }
      .mrow             { display: flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; font-size: 14px; color: var(--ink); }
      .mstage           { font-size: 10.5px; color: var(--accent); border: 1px solid var(--accent-line); border-radius: 5px; padding: 2px 5px; flex-shrink: 0; }
      .mteam            { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mteam-r          { text-align: right; }
      .mwin             { color: var(--win); font-weight: 700; }
      .mscore           { font-weight: 700; font-size: 16px; flex-shrink: 0; }
      .mmeta            { font-size: 11px; flex-shrink: 0; min-width: 34px; text-align: right; color: var(--muted); }

      /* Settings */
      .scgrid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px,1fr)); gap: 10px; }
      .scitem  { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; background: var(--bg); border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; color: var(--ink); }
      .scnum   { width: 56px; text-align: center; padding: 6px; }

      /* Share modal */
      .modal-bg        { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: flex-end; justify-content: center; z-index: 200; padding: 12px; backdrop-filter: blur(6px); }
      .modal           { background: var(--card); border: 1px solid var(--line); border-radius: 20px 20px 16px 16px; padding: 18px; width: 100%; max-width: 640px; max-height: 92vh; overflow-y: auto; }
      .modal-head      { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; color: var(--ink); }
      .canvas-wrap     { width: 100%; border-radius: 10px; overflow: hidden; background: #0A1B12; }
      .canvas-placeholder { height: 300px; }
      .modal-commentary { color: var(--muted); font-size: 13px; font-style: italic; margin: 10px 2px 0; }
      .modal-foot      { display: flex; gap: 10px; margin-top: 14px; }
      .modal-share-btn { margin-top: 0; flex: 1; text-align: center; }
      .modal-done-btn  { margin-top: 0; }

      /* Mode toggle */
      .mode-toggle { display: flex; gap: 8px; margin-bottom: 20px; }
      .mode-btn    { flex: 1; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; font-size: 14px; font-weight: 600; color: var(--muted); transition: border-color .15s, color .15s; }
      .mode-btn:hover { border-color: var(--accent); color: var(--ink); }
      .mode-btn-on    { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

      /* Import preview */
      .import-preview       { margin-top: 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
      .import-preview-title { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--win); margin-bottom: 10px; }
      .import-row           { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
      .import-row:last-child { border-bottom: none; }
      .import-name          { font-weight: 600; min-width: 80px; font-size: 14px; }
      .import-flags         { display: flex; gap: 3px; flex-wrap: wrap; font-size: 20px; line-height: 1; }
      .warn                 { color: var(--accent); margin-top: 10px; font-size: 13px; }

      /* Landing / known list */
      .known-list  { display: flex; flex-direction: column; gap: 6px; }
      .known-row   { display: flex; align-items: center; gap: 8px; }
      .known-open  { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; text-align: left; color: var(--ink); }
      .known-open:hover { border-color: var(--accent); }
      .known-name  { font-weight: 600; }
      .known-pin   { font-size: 12px; }

      /* Admin */
      .admin-grid    { display: flex; flex-direction: column; gap: 10px; }
      .admin-card    { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
      .admin-top     { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .admin-name    { font-weight: 700; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
      .admin-pin     { font-size: 12px; color: var(--accent); flex-shrink: 0; }
      .admin-stats   { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: 13px; color: var(--muted); }
      .admin-stats b { color: var(--ink); font-weight: 700; }
      .admin-leader  { margin-top: 10px; font-size: 14px; color: var(--ink); }
      .admin-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
      .admin-actions .btn-primary { flex: 1; text-align: center; }

      /* Share card */
      .share-pin-row { display: flex; align-items: center; justify-content: space-between; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
      .share-pin     { font-size: 20px; font-weight: 700; color: var(--accent); letter-spacing: .02em; }

      /* How it works */
      .howto-p           { margin-bottom: 12px; line-height: 1.6; color: var(--ink); }
      .howto-p:last-child { margin-bottom: 0; }
      .howto-bands       { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
      .howto-band-wrap   { display: flex; flex-direction: column; }
      .howto-band        { display: flex; align-items: center; gap: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; width: 100%; text-align: left; cursor: pointer; color: var(--ink); }
      .howto-band:hover  { border-color: var(--accent); }
      .howto-band-open   { border-color: var(--accent-line); border-radius: 8px 8px 0 0; }
      .howto-band-n      { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: var(--accent); color: var(--on-accent); border-radius: 5px; font-weight: 700; font-size: 13px; flex-shrink: 0; }
      .howto-band-l      { font-weight: 600; flex: 1; }
      .howto-band-count  { font-size: 12px; color: var(--muted); }
      .howto-band-teams  { display: flex; flex-wrap: wrap; gap: 6px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-top: none; border-radius: 0 0 8px 8px; padding: 10px 12px; }
      .howto-band-team   { display: flex; align-items: center; gap: 5px; background: var(--card); border: 1px solid var(--line); border-radius: 7px; padding: 5px 8px; font-size: 13px; font-weight: 500; color: var(--ink); }
      .howto-band-pts    { color: var(--accent); font-weight: 700; font-size: 12px; margin-left: 2px; }
      .howto-score       { display: flex; flex-direction: column; gap: 6px; }
      .howto-score-row   { display: flex; align-items: flex-start; gap: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; color: var(--ink); }
      .howto-pts         { min-width: 42px; font-size: 17px; font-weight: 700; color: var(--win); flex-shrink: 0; }
      .howto-pts-neg     { color: var(--signal); }
      .howto-score-label { display: flex; flex-direction: column; gap: 2px; font-weight: 600; }
      .howto-score-desc  { font-weight: 400; font-size: 12.5px; }
      .chev      { color: var(--muted); transition: transform .15s; }
      .chev-open { transform: rotate(180deg); }

      /* Live scores */
      .ls-dot  { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--win); margin-right: 6px; vertical-align: middle; animation: ls-pulse 1.4s ease-in-out infinite; }
      .ls-row  { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); color: var(--ink); }
      .ls-row:last-of-type { border-bottom: none; }
      .ls-teams { flex: 1; font-size: 13.5px; }
      .ls-new   { background: var(--accent); color: var(--on-accent); border-radius: 5px; font-size: 11px; font-weight: 700; padding: 2px 6px; flex-shrink: 0; }

      @media (max-width: 560px) {
        .score-row { flex-wrap: wrap; }
        .score-row .sel { flex-basis: 100%; }
        .leader-name { font-size: 36px; }
        .leader-pts  { font-size: 44px; }
        .row-alive   { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pick, .leader-card, .row-wrap, .board-commentary, .board-results { animation: none; opacity: 1; transform: none; }
        .row-chev { transition: none; }
        .row-bar-fill { animation: none; }
      }
    `}</style>
  );
}

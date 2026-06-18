import { useState, useEffect, useMemo, useRef, Component } from "react";
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
  "Iran":"irn","Bosnia":"bih","Bosnia and Herzegovina":"bih","Saudi Arabia":"ksa",
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
    if (m.stage !== "GROUP") {
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
  const W        = 600;
  const HEADER_H = 96;
  const ROW_H    = 66;
  const COMM_H   = 82;
  const FOOTER_H = 36;
  const H        = HEADER_H + players.length * ROW_H + COMM_H + FOOTER_H;

  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = "#0A1B12";
  ctx.fillRect(0, 0, W, H);

  // Subtle pitch-grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y <= H; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Header gradient strip
  const hg = ctx.createLinearGradient(0, 0, W, HEADER_H);
  hg.addColorStop(0, "#172E1E");
  hg.addColorStop(1, "#0A1B12");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, HEADER_H);

  // WC26 badge
  ctx.fillStyle = "#E9B44C";
  rrect(ctx, 20, 18, 66, 32, 6);
  ctx.fill();
  ctx.fillStyle = "#1a1407";
  ctx.font = "700 14px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WC26", 53, 34);

  // Title
  ctx.fillStyle = "#EDF3EC";
  ctx.font = "700 18px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SWEEPSTAKE STANDINGS", 100, 36);

  // Name + date line
  ctx.fillStyle = "#8BA694";
  ctx.font = "400 12px -apple-system, system-ui, sans-serif";
  ctx.fillText(sweepstakeName, 100, 55);

  ctx.textAlign = "right";
  ctx.fillText(
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    W - 20, 55
  );

  // Header divider
  ctx.strokeStyle = "#22422F";
  ctx.lineWidth = 1;
  hline(ctx, 0, W, HEADER_H);

  // Player rows
  players.forEach((p, i) => {
    const rowY = HEADER_H + i * ROW_H;
    const midY = rowY + ROW_H / 2;
    const isLeader = i === 0 && p.total > 0;

    if (isLeader) {
      ctx.fillStyle = "rgba(233,180,76,0.08)";
      ctx.fillRect(0, rowY, W, ROW_H);
    }

    // Rank
    ctx.fillStyle = isLeader ? "#E9B44C" : "#8BA694";
    ctx.font = "700 16px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.rank), 44, midY - 8);

    // Name
    ctx.fillStyle = "#EDF3EC";
    ctx.font = "600 16px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(p.name, 56, midY - 8);

    // Team flags: alive full opacity, eliminated dimmed
    const aliveTeams = p.teams.filter(t => !eliminated.has(t));
    const deadTeams  = p.teams.filter(t => eliminated.has(t));
    ctx.font = `15px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textBaseline = "middle";
    let fx = 56;

    ctx.globalAlpha = 1;
    for (const tid of aliveTeams) {
      const t = TEAM[tid];
      if (!t) continue;
      ctx.fillText(t.flag, fx, midY + 12);
      fx += 22;
    }
    ctx.globalAlpha = 0.28;
    for (const tid of deadTeams) {
      const t = TEAM[tid];
      if (!t) continue;
      ctx.fillText(t.flag, fx, midY + 12);
      fx += 22;
    }
    ctx.globalAlpha = 1;

    // Points
    ctx.fillStyle = isLeader ? "#E9B44C" : "#EDF3EC";
    ctx.font = "700 23px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.total), W - 20, midY - 4);

    // Row divider
    if (i < players.length - 1) {
      ctx.strokeStyle = "#1E3829";
      ctx.lineWidth = 1;
      hline(ctx, 0, W, rowY + ROW_H);
    }
  });

  // Commentary section
  const commY = HEADER_H + players.length * ROW_H;
  ctx.strokeStyle = "#22422F";
  ctx.lineWidth = 1;
  hline(ctx, 0, W, commY);

  ctx.fillStyle = "#8BA694";
  ctx.font = "italic 400 13.5px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  wrapText(ctx, commentary, 22, commY + 30, W - 44, 20);

  // Footer
  hline(ctx, 0, W, H - FOOTER_H);
  ctx.fillStyle = "#3a5e47";
  ctx.font = "500 11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(sweepstakeName.toUpperCase(), W / 2, H - FOOTER_H + 22);

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

  // Adds new results to the current sweep AND silently syncs them to all other
  // sweepstakes remembered on this device. Edits/deletions stay scoped to the
  // current sweep — only brand-new results are broadcast.
  async function addResultsToAll(newResults) {
    if (!newResults?.length) return;

    // Merge new results into an existing list, skipping any that already exist
    // (same stage + same pair of teams, either order).
    const mergeInto = (existing) => {
      const merged = [...(existing || [])];
      for (const nr of newResults) {
        const dupe = merged.some(er =>
          er.stage === nr.stage &&
          ((er.teamA === nr.teamA && er.teamB === nr.teamB) ||
           (er.teamA === nr.teamB && er.teamB === nr.teamA))
        );
        if (!dupe) merged.push(nr);
      }
      return merged;
    };

    // 1) Current sweep — update the UI and save.
    await commit({ ...state, results: mergeInto(state.results) });

    // 2) Every OTHER sweepstake remembered on this device. Load each fresh
    //    from the server, merge the new results in, and save it back. This is
    //    what makes "enter a result once, every sweep updates" actually work.
    const others = loadKnownSweeps().filter(k => k.id !== sweepId);
    for (const k of others) {
      const hit = await loadById(k.id);
      if (!hit) continue;
      const nextResults = mergeInto(hit.state.results);
      if (nextResults.length !== (hit.state.results?.length || 0)) {
        await saveSweep(k.id, { ...hit.state, results: nextResults });
      }
    }
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

/* ---- Main shell ---- */
function Main({
  state, sweepId, known, commit, refresh, saveStatus, tab, setTab,
  unlocked, tryUnlock, showReveal, onMatchdayReport, resetAll, goHome, goAdmin, switchTo, addResultsToAll,
}) {
  const stats = useMemo(() => buildStats(state), [state]);
  const tabs  = [["table","Table"],["teams","Teams"],["matches","Matches"],["howto","How it works"],["setup","Setup"]];
  const others = known.filter(k => k.id !== sweepId);
  return (
    <div className="main">
      <header className="hdr">
        <div className="hdr-left">
          <button className="hdr-badge hdr-home" title="All sweepstakes" onClick={goHome}>WC26</button>
          <div>
            <div className="hdr-title">{state.name}</div>
            <div className="hdr-sub">{state.parts.length} players · {state.teamsPer} teams each</div>
          </div>
        </div>
        <div className="hdr-right">
          <span className={cls("savestate", saveStatus)}>
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : ""}
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
        </div>
      </header>
      <nav className="tabs">
        {tabs.map(([id, lbl]) => (
          <button key={id} className={cls("tab", tab === id && "tab-on")} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </nav>
      {tab === "table"   && <TableView   state={state} stats={stats} onMatchdayReport={onMatchdayReport} />}
      {tab === "teams"   && <TeamsView   state={state} stats={stats} commit={commit} unlocked={unlocked} tryUnlock={tryUnlock} />}
      {tab === "matches" && <MatchesView state={state} stats={stats} commit={commit} unlocked={unlocked} tryUnlock={tryUnlock} addResultsToAll={addResultsToAll} />}
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
function TableView({ state, stats, onMatchdayReport }) {
  const [openIds, setOpenIds] = useState(() => new Set());
  const leaderPts = stats.players[0]?.total ?? 0;
  const allOpen = stats.players.length > 0 && openIds.size === stats.players.length;

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

  return (
    <div className="pane">
      {state.results.length === 0 && (
        <div className="notice">No results in yet. Everyone's level on 0 — enjoy it while it lasts.</div>
      )}
      {stats.players.length > 0 && (
        <div className="board-tools">
          <button className="btn-ghost" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <div className="board">
        {stats.players.map(p => {
          const isLeader = p.rank === 1 && state.results.length > 0;
          const isOpen   = openIds.has(p.id);
          return (
            <div key={p.id} className={cls("row-wrap", isLeader && "leader")}>
              <button className="row" onClick={() => toggleRow(p.id)}>
                <span className="row-rank mono">{p.rank}</span>
                <span className="row-name">{p.name}</span>
                <span className="row-alive dim">{p.alive}/{p.teams.length} alive</span>
                <span className="row-pts mono">{p.total}</span>
                <span className={cls("chev", isOpen && "chev-open")}>▾</span>
              </button>
              {isOpen && (
                <div className="row-teams">
                  {p.teams.map(tid => {
                    const t   = TEAM[tid];
                    const out = stats.eliminated.has(tid);
                    return (
                      <div key={tid} className={cls("chip", out && "chip-out")}>
                        <span>{t.flag}</span>
                        <span className="chip-name">{t.name}</span>
                        {state.groupWinners?.[tid] && <span className="chip-star">★</span>}
                        <span className="chip-pts mono">{stats.teamPts[tid] ?? 0}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {isLeader && !isOpen && p.total > 0 && (
                <div className="leader-tag">LEADING · {p.total} PTS</div>
              )}
            </div>
          );
        })}
      </div>
      {stats.players.length > 1 && leaderPts > 0 && (
        <div className="gapnote dim">
          Gap to top:{" "}
          {stats.players.slice(1).map(p => `${p.name} −${leaderPts - p.total}`).join(" · ")}
        </div>
      )}
      <button className="btn-report" onClick={onMatchdayReport}>
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
        Tap ★ when a team wins its group (+{stats.sc.groupWin} pts).
        Knockout exits are marked automatically; use ✕ for group-stage eliminations.
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
function LiveScoresPanel({ state, onImport }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [fixtures, setFixtures] = useState([]);

  async function fetchScores() {
    setLoading(true); setError(""); setFixtures([]);
    try {
      const res = await fetch(`/.netlify/functions/fixtures`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFixtures((data.matches || []).filter(m => m.statusState === "post"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open) fetchScores();
    setOpen(v => !v);
  }

  const existingPairs = new Set(
    state.results.map(m => [m.teamA, m.teamB].sort().join("|"))
  );
  const newFixtures = fixtures.filter(m => {
    const hId = apiTeamId(m.homeTeam);
    const aId = apiTeamId(m.awayTeam);
    if (!hId || !aId) return false;
    return !existingPairs.has([hId, aId].sort().join("|"));
  });

  function importAll() {
    const text = apiFixturesToPasteText(newFixtures);
    if (text) onImport(text);
  }

  return (
    <div className="card">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div className="card-title" style={{ marginBottom:0 }}>
          <span className="ls-dot" /> Live Scores
        </div>
        <button
          className="btn-ghost"
          style={{ marginTop:0, padding:"5px 12px", fontSize:13 }}
          onClick={toggle}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop:12 }}>
          {loading && <div className="dim small">Fetching results…</div>}
          {error   && <div className="err" style={{ marginTop:8 }}>{error}</div>}
          {!loading && !error && fixtures.length === 0 && (
            <div className="dim small">No finished matches found in the last 3 days.</div>
          )}
          {!loading && fixtures.length > 0 && (
            <>
              {fixtures.map(m => {
                const hId  = apiTeamId(m.homeTeam);
                const aId  = apiTeamId(m.awayTeam);
                const hT   = hId ? TEAM[hId] : { name: m.homeTeam, flag: "🏳" };
                const aT   = aId ? TEAM[aId] : { name: m.awayTeam, flag: "🏳" };
                const isNew = hId && aId && !existingPairs.has([hId,aId].sort().join("|"));
                return (
                  <div key={m.id} className="ls-row">
                    <span className="mstage mono" style={{ fontSize:11 }}>
                      GRP
                    </span>
                    <span className="ls-teams">
                      {hT.flag} {hT.name}{" "}
                      <strong className="mono">{m.homeScore}–{m.awayScore}</strong>{" "}
                      {aT.name} {aT.flag}
                    </span>
                    {isNew && <span className="ls-new">new</span>}
                  </div>
                );
              })}
              {newFixtures.length > 0 && (
                <button
                  className="btn-primary"
                  style={{ marginTop:12 }}
                  onClick={importAll}
                >
                  Import {newFixtures.length} new result{newFixtures.length !== 1 ? "s" : ""} into paste box
                </button>
              )}
              {newFixtures.length === 0 && (
                <div className="dim small" style={{ marginTop:8 }}>
                  All fetched results are already logged ✓
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MatchesView({ state, stats, commit, unlocked, tryUnlock, addResultsToAll }) {
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
      <LiveScoresPanel state={state} onImport={handleLiveImport} />
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

      :root {
        --pitch:   #0A1B12;
        --panel:   #10241A;
        --panel-2: #152E20;
        --line:    #22422F;
        --chalk:   #EDF3EC;
        --dim:     #8BA694;
        --gold:    #E9B44C;
        --gold-dk: #B8862F;
        --signal:  #FF5A5F;
        --win:     #9FE3B4;
      }

      *, *::before, *::after { box-sizing: border-box; margin: 0; }

      .app {
        min-height: 100vh;
        background:
          radial-gradient(1200px 500px at 50% -10%, #16352440, transparent),
          repeating-linear-gradient(0deg, transparent 0 64px, #ffffff05 64px 65px),
          var(--pitch);
        color: var(--chalk);
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-size: 15px;
        line-height: 1.45;
        padding-bottom: 60px;
      }

      .display { font-family: 'Archivo Black', system-ui, sans-serif; letter-spacing: .01em; line-height: .95; }
      .mono    { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
      .dim     { color: var(--dim); }
      .small   { font-size: 12.5px; margin-top: 8px; }
      button   { font: inherit; color: inherit; cursor: pointer; }

      /* splash */
      .splash       { min-height: 100vh; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; }
      .splash-badge { font-family: 'Archivo Black'; font-size: 28px; color: var(--pitch); background: var(--gold); padding: 6px 14px; border-radius: 6px; }
      .splash-text  { color: var(--dim); }

      /* setup */
      .setup        { max-width: 640px; margin: 0 auto; padding: 48px 20px 40px; }
      .setup-eyebrow { font-size: 11px; letter-spacing: .22em; color: var(--gold); font-weight: 700; }
      .setup-title  { font-size: clamp(44px,10vw,76px); margin: 10px 0 14px; color: var(--chalk); }
      .setup-sub    { color: var(--dim); max-width: 520px; margin-bottom: 26px; }

      .card           { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 16px; }
      .card-title     { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 12px; color: var(--gold); margin-bottom: 14px; }
      .card-danger    { border-color: #5a2a2e; }

      .lbl            { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); margin: 14px 0 6px; }
      .lbl:first-child { margin-top: 0; }
      .inp            { width: 100%; background: var(--pitch); border: 1px solid var(--line); color: var(--chalk); border-radius: 9px; padding: 10px 12px; font: inherit; outline: none; }
      .inp:focus-visible { border-color: var(--gold); box-shadow: 0 0 0 2px #e9b44c33; }
      .ta             { resize: vertical; min-height: 120px; }
      .sel            { appearance: auto; width: auto; min-width: 0; flex: 1; }
      .err            { color: var(--signal); margin-top: 12px; font-size: 14px; }

      .btn-primary    { margin-top: 16px; background: var(--gold); color: #1a1407; border: none; border-radius: 10px; padding: 12px 22px; font-weight: 700; letter-spacing: .03em; }
      .btn-primary:hover { background: #f4c763; }
      .btn-primary:disabled { opacity: .4; cursor: default; }
      .btn-ghost      { margin-top: 16px; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 11px 18px; }
      .btn-ghost:hover { border-color: var(--gold); color: var(--gold); }
      .btn-danger     { margin-top: 4px; background: transparent; border: 1px solid #7c343a; color: var(--signal); border-radius: 10px; padding: 11px 18px; }
      .btn-icon       { background: transparent; border: 1px solid var(--line); border-radius: 8px; width: 34px; height: 34px; }
      .linklike       { background: none; border: none; color: var(--gold); text-decoration: underline; padding: 0; }

      .btn-report     { display: block; width: 100%; margin-top: 24px; background: transparent; border: 1px solid var(--gold-dk); color: var(--gold); border-radius: 12px; padding: 14px; font-weight: 600; font-size: 15px; letter-spacing: .03em; text-align: center; }
      .btn-report:hover { background: rgba(233,180,76,0.08); }

      .setup-mathrow  { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin-top: 16px; padding: 12px; background: var(--pitch); border-radius: 10px; border: 1px dashed var(--line); }
      .big            { font-size: 20px; font-weight: 700; color: var(--gold); }
      .stepper        { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
      .step           { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2); }

      /* reveal */
      .reveal         { max-width: 760px; margin: 0 auto; padding: 40px 20px; }
      .reveal-head    { margin-bottom: 24px; }
      .reveal-round   { margin-bottom: 22px; }
      .reveal-roundlbl { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; }
      .reveal-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px,1fr)); gap: 8px; }
      .pick           { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; opacity: 0; transform: translateY(8px) scale(.97); animation: pop .45s cubic-bezier(.2,.9,.3,1.2) forwards; }
      .pick-flag      { font-size: 18px; }
      .pick-team      { font-weight: 700; }
      .pick-owner     { margin-left: auto; color: var(--gold); font-size: 13px; }
      @keyframes pop  { to { opacity: 1; transform: none; } }
      .reveal-skip .pick { animation-delay: 0s !important; }
      .reveal-actions { display: flex; gap: 12px; margin-top: 10px; }

      /* main */
      .main           { max-width: 760px; margin: 0 auto; padding: 18px 14px 0; }
      .hdr            { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 2px 14px; }
      .hdr-left       { display: flex; gap: 12px; align-items: center; min-width: 0; }
      .hdr-badge      { font-family: 'Archivo Black'; background: var(--gold); color: var(--pitch); border-radius: 6px; padding: 4px 8px; font-size: 15px; flex-shrink: 0; }
      .hdr-title      { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 48vw; }
      .hdr-sub        { font-size: 12px; color: var(--dim); }
      .hdr-right      { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
      .savestate      { font-size: 12px; color: var(--dim); min-width: 60px; text-align: right; }
      .savestate.error { color: var(--signal); }
      .savestate.saved { color: var(--win); }

      .tabs           { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; overflow-x: auto; }
      .tab            { background: none; border: none; padding: 10px 14px; color: var(--dim); font-weight: 500; border-bottom: 2px solid transparent; white-space: nowrap; }
      .tab-on         { color: var(--chalk); border-bottom-color: var(--gold); }

      .pane           { padding-bottom: 30px; }
      .pane-note      { font-size: 13px; margin-bottom: 12px; padding: 0 2px; }
      .notice         { background: var(--panel); border: 1px dashed var(--line); border-radius: 10px; padding: 14px; color: var(--dim); margin-bottom: 14px; }

      /* leaderboard */
      .board-tools    { display: flex; justify-content: flex-end; margin-bottom: 8px; }
      .board-tools .btn-ghost { margin-top: 0; padding: 6px 12px; font-size: 13px; }
      .board          { display: flex; flex-direction: column; gap: 8px; }
      .row-wrap       { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; position: relative; }
      .row-wrap.leader { border-color: var(--gold-dk); box-shadow: 0 0 0 1px var(--gold-dk), 0 6px 24px -12px #e9b44c66; }
      .row            { display: flex; align-items: center; gap: 12px; width: 100%; padding: 13px 14px; background: none; border: none; text-align: left; }
      .row-rank       { width: 26px; font-size: 17px; font-weight: 700; color: var(--dim); }
      .leader .row-rank { color: var(--gold); }
      .row-name       { font-weight: 700; font-size: 16px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .row-alive      { font-size: 12px; }
      .row-pts        { font-size: 24px; font-weight: 700; color: var(--gold); min-width: 48px; text-align: right; }
      .chev           { color: var(--dim); transition: transform .15s; }
      .chev-open      { transform: rotate(180deg); }
      .leader-tag     { position: absolute; top: -1px; right: 14px; font-size: 9px; letter-spacing: .18em; background: var(--gold); color: var(--pitch); padding: 2px 8px; border-radius: 0 0 6px 6px; font-weight: 700; }
      .row-teams      { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 14px; }
      .chip           { display: flex; align-items: center; gap: 6px; background: var(--pitch); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; font-size: 13px; }
      .chip-out       { opacity: .45; }
      .chip-out .chip-name { text-decoration: line-through; }
      .chip-star      { color: var(--gold); }
      .chip-pts       { color: var(--gold); font-weight: 700; }
      .gapnote        { font-size: 12px; margin-top: 14px; padding: 0 4px; }

      /* teams */
      .tlist          { display: flex; flex-direction: column; gap: 6px; }
      .trow           { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; }
      .trow-out       { opacity: .5; }
      .trow-out .trow-name { text-decoration: line-through; }
      .trow-flag      { font-size: 18px; }
      .trow-name      { font-weight: 700; flex: 1; min-width: 0; }
      .trow-tier      { display: block; font-size: 10.5px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
      .trow-owner     { font-size: 13px; }
      .trow-pts       { font-size: 17px; font-weight: 700; color: var(--gold); min-width: 34px; text-align: right; }
      .mini           { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--dim); flex-shrink: 0; }
      .mini-on        { background: var(--gold); border-color: var(--gold); color: var(--pitch); }
      .mini-red       { border-color: #7c343a; color: var(--signal); }

      /* matches */
      .frow           { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
      .frow:first-of-type { margin-top: 0; }
      .score-row      { flex-wrap: nowrap; }
      .scorebox       { width: 52px; text-align: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
      .dash           { color: var(--dim); flex-shrink: 0; }
      .reds-row       { gap: 18px; }
      .lbl-inline     { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dim); }
      .redbox         { width: 46px; text-align: center; }
      .mlist          { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; }
      .mrow           { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; font-size: 14px; }
      .mstage         { font-size: 10.5px; color: var(--gold); border: 1px solid var(--gold-dk); border-radius: 5px; padding: 2px 5px; flex-shrink: 0; }
      .mteam          { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mteam-r        { text-align: right; }
      .mwin           { color: var(--win); font-weight: 700; }
      .mscore         { font-weight: 700; font-size: 16px; flex-shrink: 0; }
      .mmeta          { font-size: 11px; flex-shrink: 0; min-width: 34px; text-align: right; }

      /* settings */
      .scgrid         { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px,1fr)); gap: 10px; }
      .scitem         { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; background: var(--pitch); border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; }
      .scnum          { width: 56px; text-align: center; padding: 6px; }

      /* share modal */
      .modal-bg       { position: fixed; inset: 0; background: rgba(0,0,0,0.78); display: flex; align-items: flex-end; justify-content: center; z-index: 200; padding: 12px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
      .modal          { background: var(--panel); border: 1px solid var(--line); border-radius: 20px 20px 16px 16px; padding: 18px; width: 100%; max-width: 640px; max-height: 92vh; overflow-y: auto; }
      .modal-head     { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .canvas-wrap    { width: 100%; border-radius: 10px; overflow: hidden; background: #0A1B12; }
      .canvas-placeholder { height: 300px; }
      .modal-commentary { color: var(--dim); font-size: 13px; font-style: italic; margin: 10px 2px 0; }
      .modal-foot     { display: flex; gap: 10px; margin-top: 14px; }
      .modal-share-btn { margin-top: 0; flex: 1; text-align: center; }
      .modal-done-btn  { margin-top: 0; }

      /* mode toggle */
      .mode-toggle    { display: flex; gap: 8px; margin-bottom: 20px; }
      .mode-btn       { flex: 1; padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; font-size: 14px; font-weight: 600; color: var(--dim); transition: border-color .15s, color .15s; }
      .mode-btn:hover { border-color: var(--gold); color: var(--chalk); }
      .mode-btn-on    { border-color: var(--gold); color: var(--gold); background: rgba(233,180,76,0.08); }

      /* import preview */
      .import-preview       { margin-top: 14px; background: var(--pitch); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
      .import-preview-title { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #9FE3B4; margin-bottom: 10px; }
      .import-row           { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); }
      .import-row:last-child { border-bottom: none; }
      .import-name          { font-weight: 600; min-width: 80px; font-size: 14px; }
      .import-flags         { display: flex; gap: 3px; flex-wrap: wrap; font-size: 20px; line-height: 1; }
      .warn                 { color: var(--gold); margin-top: 10px; font-size: 13px; }

      /* landing / known list */
      .known-list     { display: flex; flex-direction: column; gap: 6px; }
      .known-row      { display: flex; align-items: center; gap: 8px; }
      .known-open     { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; background: var(--pitch); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; text-align: left; }
      .known-open:hover { border-color: var(--gold); }
      .known-name     { font-weight: 600; }
      .known-pin      { font-size: 12px; }

      /* switcher */
      .hdr-home       { border: none; cursor: pointer; }
      .hdr-home:hover { background: #f4c763; }
      .sweep-switch   { background: var(--panel); border: 1px solid var(--line); color: var(--chalk); border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px; max-width: 130px; }

      /* admin / mission control */
      .admin-grid     { display: flex; flex-direction: column; gap: 10px; }
      .admin-card     { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
      .admin-top      { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .admin-name     { font-weight: 700; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .admin-pin      { font-size: 12px; color: var(--gold); flex-shrink: 0; }
      .admin-stats    { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: 13px; color: var(--dim); }
      .admin-stats b  { color: var(--chalk); font-weight: 700; }
      .admin-leader   { margin-top: 10px; font-size: 14px; }
      .admin-actions  { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
      .admin-actions .btn-primary { flex: 1; text-align: center; }

      /* share card */
      .share-pin-row  { display: flex; align-items: center; justify-content: space-between; background: var(--pitch); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
      .share-pin      { font-size: 20px; font-weight: 700; color: var(--gold); letter-spacing: .02em; }

      /* how it works */
      .howto-p        { margin-bottom: 12px; line-height: 1.6; }
      .howto-p:last-child { margin-bottom: 0; }
      .howto-bands      { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
      .howto-band-wrap  { display: flex; flex-direction: column; }
      .howto-band       { display: flex; align-items: center; gap: 12px; background: var(--pitch); border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; width: 100%; text-align: left; cursor: pointer; }
      .howto-band:hover { border-color: var(--gold); }
      .howto-band-open  { border-color: var(--gold-dk); border-radius: 8px 8px 0 0; }
      .howto-band-n     { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: var(--gold); color: var(--pitch); border-radius: 5px; font-weight: 700; font-size: 13px; flex-shrink: 0; }
      .howto-band-l     { font-weight: 600; flex: 1; }
      .howto-band-count { font-size: 12px; }
      .howto-band-teams { display: flex; flex-wrap: wrap; gap: 6px; background: var(--panel-2); border: 1px solid var(--gold-dk); border-top: none; border-radius: 0 0 8px 8px; padding: 10px 12px; }
      .howto-band-team  { display: flex; align-items: center; gap: 5px; background: var(--pitch); border: 1px solid var(--line); border-radius: 7px; padding: 5px 8px; font-size: 13px; font-weight: 500; }
      .howto-band-pts   { color: var(--gold); font-weight: 700; font-size: 12px; margin-left: 2px; }
      .howto-score    { display: flex; flex-direction: column; gap: 6px; }
      .howto-score-row { display: flex; align-items: flex-start; gap: 12px; background: var(--pitch); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
      .howto-pts      { min-width: 42px; font-size: 17px; font-weight: 700; color: var(--win); flex-shrink: 0; }
      .howto-pts-neg  { color: var(--signal); }
      .howto-score-label { display: flex; flex-direction: column; gap: 2px; font-weight: 600; }
      .howto-score-desc { font-weight: 400; font-size: 12.5px; }

      /* live scores panel */
      .ls-dot       { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--win); margin-right: 6px; vertical-align: middle; animation: ls-pulse 1.4s ease-in-out infinite; }
      @keyframes ls-pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
      .ls-row       { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
      .ls-row:last-of-type { border-bottom: none; }
      .ls-teams     { flex: 1; font-size: 13.5px; }
      .ls-new       { background: var(--gold); color: var(--pitch); border-radius: 5px; font-size: 11px; font-weight: 700; padding: 2px 6px; flex-shrink: 0; }

      @media (max-width: 560px) {
        .score-row { flex-wrap: wrap; }
        .score-row .sel { flex-basis: 100%; }
        .hdr-title { max-width: 38vw; }
        .row-alive { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pick { animation: none; opacity: 1; transform: none; }
        .chev { transition: none; }
      }
    `}</style>
  );
}

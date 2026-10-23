// Simulates whole tournaments and breaks highlight scores down by round-weight tier.
// node tools/highlight-weights.js [tournamentsPerType=3]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');

function load() {
  for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js', 'highlights.js', 'tourney.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
  }
  globalThis.VB.MODE = 'casual';
  return globalThis.VB;
}

const TYPES = {
  'pools→8 playoff': { teams: 10, cfg: { format: 'pool-playoff', pools: 2, advanceMode: 'perPool', advanceCount: 4, thirdPlace: true } },
  '16 single elim': { teams: 16, cfg: { format: 'single', thirdPlace: true } },
  '8 double elim': { teams: 8, cfg: { format: 'double', gfReset: true } },
};

// ---------------------------------------------------------------- worker: run one tournament
if (!isMainThread) {
  const VB = load(), T = VB.T;
  const { type } = workerData;
  const spec = TYPES[type];
  // A realistic open-gym spread of 1-10 ratings and positions.
  const players = Array.from({ length: spec.teams * 6 }, (_, i) => ({
    id: 'p' + i, name: 'P' + i + ' X', skill: Math.max(1, Math.min(10, Math.round(4.5 + VB.gauss() * 2))), pos: 'AAHHMLS'[i % 7], gender: i % 2 ? 'M' : 'F',
  }));
  const pm = Object.fromEntries(players.map((p) => [p.id, p]));
  const groups = T.makeTeams(players, spec.teams, []);
  const tour = {
    players, playerMap: pm, config: Object.assign(JSON.parse(JSON.stringify(T.DEFAULT_CONFIG)), spec.cfg),
    teams: groups.map((ids, i) => Object.assign({ id: 't' + i, playerIds: ids }, T.teamIdentity(i))),
  };
  T.start(tour);
  const rows = [];
  let guard = 0;
  while (tour.stage !== 'done' && guard++ < 300) {
    const m = T.nextPlayable(tour);
    if (!m) break;
    const tier = T.stageTier(tour, m), w = T.ROUND_WEIGHTS[tier];
    const res = T.simMatch([T.gameTeam(tour, m.a), T.gameTeam(tour, m.b)], T.gameSettings(tour, m, true), { highlights: 10 });
    const points = res.setScores[0].reduce((a, b) => a + b, 0) + res.setScores[1].reduce((a, b) => a + b, 0);
    const base = res.highlights.map((h) => h.score);
    rows.push({ tier, w, points, base, label: m.label });
    delete res.highlights;
    T.applyResult(tour, m.id, res);
  }
  // Tournament top 10 by weighted score.
  const all = rows.flatMap((r) => r.base.map((s) => ({ tier: r.tier, ws: s * r.w })));
  const top10 = all.sort((a, b) => b.ws - a.ws).slice(0, 10).map((x) => x.tier);
  parentPort.postMessage({ type, rows, top10 });
  return;
}

// ---------------------------------------------------------------- main: run tournaments in parallel and report
const per = +process.argv[2] || 3;
const jobs = [];
for (const type of Object.keys(TYPES)) for (let i = 0; i < per; i++) jobs.push(type);
const out = [];
const t0 = Date.now();
const par = Math.max(1, os.cpus().length - 1);
let next = 0, running = 0;
function launch() {
  while (running < par && next < jobs.length) {
    const type = jobs[next++];
    running++;
    const w = new Worker(__filename, { workerData: { type } });
    w.on('message', (msg) => out.push(msg));
    w.on('error', (e) => console.error(e));
    w.on('exit', () => { running--; process.stdout.write(`\r${out.length}/${jobs.length} tournaments done`); if (next < jobs.length) launch(); else if (!running) report(); });
  }
}
launch();

function report() {
  const VB = load(), T = VB.T;
  const tiers = Object.keys(T.ROUND_WEIGHTS);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  console.log(`\n\n${out.length} tournaments in ${((Date.now() - t0) / 1000).toFixed(0)}s (${per} of each type). Match length: pool ${fmt(T.DEFAULT_CONFIG.match.pool)}, playoff ${fmt(T.DEFAULT_CONFIG.match.playoff)}, final ${fmt(T.DEFAULT_CONFIG.match.final)}.\n`);
  const head = ['Tier', 'Weight', 'Matches', 'Pts/match', 'Avg kept (raw)', 'Avg best (raw)', 'Avg kept (weighted)', 'Avg best (weighted)'];
  const lines = [head];
  for (const t of tiers) {
    const rs = out.flatMap((o) => o.rows).filter((r) => r.tier === t);
    if (!rs.length) { lines.push([T.TIER_LABELS[t], f(T.ROUND_WEIGHTS[t], 3), '0', '—', '—', '—', '—', '—']); continue; }
    const w = T.ROUND_WEIGHTS[t];
    const kept = rs.flatMap((r) => r.base), best = rs.map((r) => Math.max(...r.base));
    lines.push([T.TIER_LABELS[t], f(w, 3), String(rs.length), f(avg(rs.map((r) => r.points)), 0), f(avg(kept)), f(avg(best)), f(avg(kept) * w), f(avg(best) * w)]);
  }
  const widths = head.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  for (const [i, l] of lines.entries()) {
    console.log(l.map((c, j) => (j === 0 ? c.padEnd(widths[j]) : c.padStart(widths[j]))).join('  '));
    if (!i) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
  console.log('\nShare of each tournament\'s Top 10 (weighted), by tournament type:');
  for (const type of Object.keys(TYPES)) {
    const tops = out.filter((o) => o.type === type);
    const counts = {};
    let matchesByTier = {};
    for (const o of tops) {
      o.top10.forEach((t) => (counts[t] = (counts[t] || 0) + 1));
      o.rows.forEach((r) => (matchesByTier[r.tier] = (matchesByTier[r.tier] || 0) + 1));
    }
    const n = tops.length * 10;
    const totalMatches = Object.values(matchesByTier).reduce((a, b) => a + b, 0);
    console.log(`  ${type}: ` + tiers.filter((t) => matchesByTier[t]).map((t) => `${t} ${Math.round(((counts[t] || 0) / n) * 100)}% of Top 10 (${Math.round((matchesByTier[t] / totalMatches) * 100)}% of matches)`).join(' · '));
  }
}
function fmt(m) { return (m.playAllSets ? `${m.bestOf} sets` : m.bestOf === 1 ? '1 set' : 'best of ' + m.bestOf) + ' to ' + m.pointsPerSet; }

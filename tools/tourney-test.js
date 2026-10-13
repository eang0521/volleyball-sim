// Tests the tournament logic: node tools/tourney-test.js [backup.json]
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js', 'tourney.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const VB = globalThis.VB, T = VB.T;
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

// Star/position stats: equal totals per star level, within 0..10.
for (let s = 1; s <= 5; s++) {
  const totals = Object.keys(T.OFFSETS).map((p) => Object.values(T.starStats(s, p)).reduce((a, b) => a + b, 0));
  check(totals.every((x) => x === totals[0] && x === [1, 3, 5, 7, 9][s - 1] * 9), `star ${s} totals ${totals}`);
  for (const p of Object.keys(T.OFFSETS)) check(Object.values(T.starStats(s, p)).every((v) => v >= 0 && v <= 10), `range ${s}${p}`);
}
console.log('5★ hitter', T.starStats(5, 'H'), '\n1★ libero', T.starStats(1, 'L'));

const src = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
const parsed = src ? T.parsePlayers(src) : { players: Array.from({ length: 63 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, skill: 1 + (i % 5), pos: 'AHMLA'[i % 5], gender: i % 3 ? 'M' : 'F' })), pairs: [] };
const players = parsed.players;
console.log('players', players.length);
const k = Math.floor(players.length / 6);
let t0 = Date.now();
const teams = T.makeTeams(players, k, parsed.pairs);
console.log(`makeTeams k=${k} in ${Date.now() - t0}ms; sizes`, teams.map((t) => t.length).join(','));
const pm = Object.fromEntries(players.map((p) => [p.id, p]));
const str = teams.map((t) => T.teamStrength(t.map((id) => pm[id])).toFixed(2));
console.log('team strengths', str.join(' '));
check(Math.max(...str) - Math.min(...str) < 0.35, 'teams balanced');
// Lineups for 6/7-player teams
t0 = Date.now();
const pdata = (id) => ({ ...pm[id], height: 68, stats: T.starStats(pm[id].skill, pm[id].pos) });
const lu = T.bestLineup(teams.find((t) => t.length === 7) ? teams.find((t) => t.length === 7).map(pdata) : teams[0].map(pdata));
console.log(`bestLineup(${lu.length}) ${Date.now() - t0}ms; rotations:`, T.cycleRotations(lu).map((r) => r.front.map((p) => p.name.split(' ')[0]).join('/') + (r.bench.length ? ' [bench ' + r.bench.map((p) => p.name.split(' ')[0]).join(',') + ']' : '')).join(' | '));

// Run every format with random results to check bracket integrity.
function makeTour(cfg) {
  return {
    players, playerMap: pm, config: Object.assign(JSON.parse(JSON.stringify(T.DEFAULT_CONFIG)), cfg),
    teams: teams.map((ids, i) => Object.assign({ id: 't' + i, playerIds: ids }, T.teamIdentity(i))),
  };
}
function runRandom(cfg, label, nTeams) {
  const tour = makeTour(cfg);
  if (nTeams) tour.teams = tour.teams.slice(0, nTeams);
  T.start(tour);
  let guard = 0;
  while (tour.stage !== 'done' && guard++ < 500) {
    const m = T.nextPlayable(tour);
    if (!m) { check(false, `${label}: stuck in stage ${tour.stage}`); break; }
    const w = Math.random() < 0.5 ? 'A' : 'B';
    T.applyResult(tour, m.id, { winner: w, sets: w === 'A' ? [1, 0] : [0, 1], setScores: [[25], [20]] });
  }
  const played = tour.matches.filter((m) => m.result && !m.result.bye && !m.result.skipped).length;
  check(tour.stage === 'done' && tour.champion && tour.champion !== T.BYE, `${label}: finished with champion`);
  // Every team that played in a single-elim bracket should lose at most once; double elim at most twice before elimination.
  console.log(`${label.padEnd(38)} teams=${tour.teams.length} matches played=${played} champion=${tour.teams.find((t) => t.id === tour.champion)?.name}`);
}
for (const n of [2, 3, 5, 8, 10]) {
  runRandom({ format: 'single' }, `single elim (${n})`, n);
  runRandom({ format: 'single', thirdPlace: true }, `single elim + 3rd (${n})`, n);
  runRandom({ format: 'double', gfReset: true }, `double elim + reset (${n})`, n);
  runRandom({ format: 'double', gfReset: false }, `double elim no reset (${n})`, n);
  runRandom({ format: 'roundrobin' }, `round robin (${n})`, n);
}
runRandom({ format: 'pool-playoff', pools: 2, advanceMode: 'perPool', advanceCount: 2 }, 'pools 2, top 2 each → single');
runRandom({ format: 'pool-playoff', pools: 3, poolGames: 2, advanceMode: 'overall', advanceCount: 6, playoffType: 'double' }, 'pools 3, 2 games, top 6 → double');
runRandom({ format: 'pool-playoff', pools: 1, poolDouble: true, advanceMode: 'overall', advanceCount: 4, thirdPlace: true }, 'one pool double RR, top 4 → single+3rd');
console.log(fails ? `${fails} FAILURES` : 'all checks passed');

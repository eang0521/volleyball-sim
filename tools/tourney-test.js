// Tests the tournament logic: node tools/tourney-test.js [backup.json]
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js', 'tourney.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const VB = globalThis.VB, T = VB.T;
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

// Rating/position skills: equal totals per rating (rating x 9), within 0..10.
for (let r = 1; r <= 10; r++) {
  const totals = Object.keys(T.OFFSETS).map((p) => Object.values(T.ratingStats(r, p)).reduce((a, b) => a + b, 0));
  check(totals.every((x) => x === r * 9), `rating ${r} totals ${totals}`);
  for (const p of Object.keys(T.OFFSETS)) check(Object.values(T.ratingStats(r, p)).every((v) => v >= 0 && v <= 10), `range ${r}${p}`);
}
console.log('10 hitter', T.ratingStats(10, 'H'), '\n1 libero', T.ratingStats(1, 'L'));

// Input parsing: old 1-5 star backups convert as 2x - 1; scale:10 backups and plain lines are taken as-is.
const oldB = T.parsePlayers(JSON.stringify({ app: 'open-gym-teams', v: 1, players: [{ id: 'a', name: 'A', skill: 4 }, { id: 'b', name: 'B', skill: 1 }] }));
check(oldB.converted && oldB.players[0].skill === 7 && oldB.players[1].skill === 1, 'old backup converts 4->7, 1->1');
const newB = T.parsePlayers(JSON.stringify({ app: 'open-gym-teams', v: 1, scale: 10, players: [{ id: 'a', name: 'A', skill: 8 }] }));
check(!newB.converted && newB.players[0].skill === 8, 'scale:10 backup kept');
const lines = T.parsePlayers('Jamie, 7, hitter, F\nPat, ***\nLee');
check(lines.players.map((p) => p.skill).join() === '7,5,5' && lines.players[0].pos === 'H', 'line parsing ' + lines.players.map((p) => p.skill));

const src = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
const parsed = src ? T.parsePlayers(src) : { players: Array.from({ length: 63 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, skill: 1 + (i % 10), pos: 'AHMLA'[i % 5], gender: i % 3 ? 'M' : 'F' })), pairs: [] };
const players = parsed.players;
console.log('players', players.length);
const k = Math.floor(players.length / 6);
let t0 = Date.now();
const teams = T.makeTeams(players, k, parsed.pairs);
console.log(`makeTeams k=${k} in ${Date.now() - t0}ms; sizes`, teams.map((t) => t.length).join(','));
const pm = Object.fromEntries(players.map((p) => [p.id, p]));
const str = teams.map((t) => T.teamStrength(t.map((id) => pm[id])).toFixed(2));
console.log('team strengths', str.join(' '));
check(Math.max(...str) - Math.min(...str) < 0.7, 'teams balanced (within 0.7 on the 1-10 scale)');
// Lineups for 6/7-player teams
t0 = Date.now();
const pdata = (id) => ({ ...pm[id], height: 68, stats: T.ratingStats(pm[id].skill, pm[id].pos) });
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
// Stepladder brackets: automatic byes for every team count, plus the 8-team "4, 2" example.
for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) runRandom({ format: 'single', bracketStyle: 'ladder' }, `stepladder auto (${n})`, n);
runRandom({ format: 'single', bracketStyle: 'ladder', ladderByes: '4, 2', thirdPlace: true }, 'stepladder 4,2 + 3rd (8)', 8);
{
  const tour = makeTour({ format: 'single', bracketStyle: 'ladder', ladderByes: '4, 2' });
  tour.teams = tour.teams.slice(0, 8);
  T.start(tour);
  const seedOf = (id) => tour.seeds.indexOf(id) + 1;
  const r1 = tour.matches.filter((m) => m.round === 1).map((m) => `${seedOf(m.a)}v${seedOf(m.b)}`).sort().join(',');
  check(r1 === '5v8,6v7', 'ladder round 1 is 5v8, 6v7 (got ' + r1 + ')');
  check(tour.matches.filter((m) => m.round === 3).every((m) => [1, 2].includes(seedOf(m.a))), 'seeds 1-2 enter in the semis');
  check(tour.matches.length === 7, 'ladder of 8 has 7 matches');
}
runRandom({ format: 'pool-playoff', pools: 2, advanceMode: 'overall', advanceCount: 6, bracketStyle: 'ladder' }, 'pools 2, top 6 → stepladder');
runRandom({ format: 'pool-playoff', pools: 2, advanceMode: 'perPool', advanceCount: 2 }, 'pools 2, top 2 each → single');
runRandom({ format: 'pool-playoff', pools: 3, poolGames: 2, advanceMode: 'overall', advanceCount: 6, playoffType: 'double' }, 'pools 3, 2 games, top 6 → double');
runRandom({ format: 'pool-playoff', pools: 1, poolDouble: true, advanceMode: 'overall', advanceCount: 4, thirdPlace: true }, 'one pool double RR, top 4 → single+3rd');
console.log(fails ? `${fails} FAILURES` : 'all checks passed');

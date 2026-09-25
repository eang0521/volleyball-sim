// Headless match runner for tuning: node tools/headless.js [matches] [skill]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const VB = globalThis.VB;
const matches = +process.argv[2] || 3;
const level = process.argv[3] || "intermediate";
const mode = level === "casual" ? "casual" : "competitive";
VB.MODE = mode;

const agg = {};
const bump = (k, n = 1) => (agg[k] = (agg[k] || 0) + n);
let totalRallyTime = 0, totalContacts = 0, rallies = 0;
const t0 = Date.now();
for (let m = 0; m < matches; m++) {
  const g = new VB.Game(VB.randomTeams(level), mode === "casual" ? { netHeight: 2.35 } : {}, mode);
  let lastPhase = g.phase, rallyStart = 0, steps = 0;
  while (g.phase !== 'over' && steps < 240 * 60 * 180) {
    g.update(VB.C.DT);
    steps++;
    if (g.phase !== lastPhase) {
      if (g.phase === 'rally' && lastPhase === 'serve') rallyStart = g.time;
      if (g.phase === 'dead' && lastPhase === 'rally') {
        rallies++;
        totalRallyTime += g.time - rallyStart;
        totalContacts += g.contacts.length;
        bump('attacks', g.contacts.filter((c) => c.kind === 'attack').length);
        bump('sets', g.contacts.filter((c) => c.kind === 'set').length);
        bump('digs', g.contacts.filter((c) => c.kind === 'dig').length);
        bump('blocksTouch', g.contacts.filter((c) => c.kind === 'block').length);
        const last = g.log[g.log.length - 1].text;
        const key = last.split(/ by | — |  →/)[0].replace(/#\d+.*/, '').trim();
        bump('end:' + key);
      }
      lastPhase = g.phase;
    }
  }
  const [a, b] = g.teams;
  console.log(`match ${m + 1}: ${a.name} ${a.sets} - ${b.sets} ${b.name}  sets: ${a.setScores.map((s, i) => s + '-' + b.setScores[i]).join(', ')}  simTime=${(g.time / 60).toFixed(1)}min`);
}
console.log(`\n${rallies} rallies, avg ${(totalRallyTime / rallies).toFixed(2)}s, avg contacts ${(totalContacts / rallies).toFixed(2)}, wall ${(Date.now() - t0) / 1000}s`);
const rows = Object.entries(agg).sort((x, y) => y[1] - x[1]);
for (const [k, v] of rows) console.log(k.padEnd(50), v, k.startsWith('end:') ? ((100 * v) / rallies).toFixed(1) + '%' : (v / rallies).toFixed(2) + '/rally');

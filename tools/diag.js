// Diagnostic: print contact sequences + defending plan state for rallies.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const VB = globalThis.VB;
const N = +process.argv[2] || 30;
const g = new VB.Game(VB.randomTeams(process.argv[3] || 'intermediate'), {});
const origPlan = g.planTouch.bind(g);
const lastPlanInfo = [null, null];
g.planTouch = function (t) {
  origPlan(t);
  const pl = t.ai.plan;
  if (pl) lastPlanInfo[t.idx] = { at: g.time.toFixed(2), who: '#' + pl.player.number, t: pl.t.toFixed(2), type: pl.type, purpose: pl.purpose, stand: [pl.stand.x.toFixed(1), pl.stand.z.toFixed(1)], ppos: [pl.player.pos.x.toFixed(1), pl.player.pos.z.toFixed(1)] };
};
let lastPhase = g.phase, count = 0;
while (count < N) {
  g.update(VB.C.DT);
  if (g.phase === 'rally' && lastPhase === 'serve') lastPlanInfo[0] = lastPlanInfo[1] = null;
  if (g.phase === 'dead' && lastPhase === 'rally') {
    count++;
    const seq = g.contacts.map((c) => `${'AB'[c.team.idx]}${c.player.number}:${c.kind}`).join(' ');
    const last = g.log[g.log.length - 1].text;
    console.log(`[${count}] t=${g.time.toFixed(1)} ${seq}\n    => ${last}  ball=(${g.ball.pos.x.toFixed(1)},${g.ball.pos.z.toFixed(1)})`);
    console.log('    plans A:', JSON.stringify(lastPlanInfo[0]), ' B:', JSON.stringify(lastPlanInfo[1]));
  }
  lastPhase = g.phase;
}

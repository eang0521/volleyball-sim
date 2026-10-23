// Prints the top highlights from simulated matches: node tools/highlights-test.js [casual|competitive] [matches]
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['util.js', 'physics.js', 'teams.js', 'game.js', 'highlights.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const VB = globalThis.VB, mode = process.argv[2] || 'casual', n = +process.argv[3] || 1;
VB.MODE = mode;
const all = [];
for (let m = 0; m < n; m++) {
  const g = new VB.Game(VB.randomTeams(mode === 'casual' ? 'casual' : 'intermediate'), mode === 'casual' ? { netHeight: 2.35 } : {}, mode);
  const rec = VB.HL.attach(g, { keep: 8 });
  while (g.phase !== 'over') g.update(VB.C.DT);
  all.push(...rec.list);
  const withReplay = rec.list.filter((h) => h.frames);
  console.log(`match ${m + 1}: ${rec.list.length} points scored, ${withReplay.length} replays kept, replay size ~${Math.round(withReplay.reduce((a, h) => a + h.frames.byteLength, 0) / 1024)} KB`);
}
const sorted = all.slice().sort((a, b) => b.score - a.score);
for (const h of sorted.slice(0, 12)) console.log(`${'🔥'.repeat(VB.HL.flames(h.score))} ${h.score.toFixed(1).padStart(5)}  S${h.set} ${h.before.join('-')}  ${h.title}. ${h.detail}  [${h.tags.join(', ')}]`);
const q = (p) => sorted[Math.floor(sorted.length * p)].score.toFixed(1);
console.log(`score percentiles: top1% ${q(0.01)}, top5% ${q(0.05)}, median ${q(0.5)}; kinds:`, Object.entries(all.reduce((o, h) => ((o[h.kind] = (o[h.kind] || 0) + 1), o), {})).join(' '));
console.log('bottom:', sorted.slice(-2).map((h) => `${h.score} ${h.title}`).join(' | '));

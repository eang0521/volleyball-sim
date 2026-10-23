// Tournament logic: player ratings from a 1-10 rating and position, team division (ported from vball-teams),
// lineups, schedules/brackets, standings and results. No DOM, so it can be tested in Node.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const T = (VB.T = {});
  const rnd = Math.random;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ------------------------------------------------------------ players
  T.POS = [['A', 'All-around'], ['H', 'Hitter'], ['M', 'Middle'], ['L', 'Libero'], ['S', 'Setter']];
  T.POSN = Object.fromEntries(T.POS);
  T.HEIGHT_IN = 68; // everyone is 5'8"
  T.SKIN = '#c68a5e';
  // Ratings are 1-10 like open-gym-teams (old 1-5 star sets convert as 2x - 1).
  T.DEFAULT_RATING = 5;
  T.LEVELS = ['', 'Beginner-', 'Beginner', 'Beginner+', 'Intermediate-', 'Intermediate', 'Intermediate+', 'Advanced', 'Advanced+', 'Expert', 'Expert+'];
  T.clampRating = (v) => Math.min(10, Math.max(1, Math.round(+v) || T.DEFAULT_RATING));
  T.fromStars = (v) => Math.min(10, Math.max(1, 2 * Math.min(5, Math.max(1, Math.round(+v) || 3)) - 1));
  // Position shifts: each sums to zero so every player with the same rating has the same total.
  T.OFFSETS = {
    A: { setting: 2, blocking: -1, jumping: -1 },
    H: { jumping: 2, hitting: 2, blocking: 1, passing: -2, setting: -2, awareness: -1 },
    M: { blocking: 3, jumping: 2, hitting: 1, passing: -2, setting: -1, agility: -1, serving: -1, awareness: -1 },
    L: { passing: 3, reactions: 2, agility: 2, awareness: 1, hitting: -3, blocking: -3, jumping: -2 },
    S: { setting: 3, awareness: 2, passing: 1, hitting: -2, blocking: -2, jumping: -1, serving: -1 },
  };

  // 0-10 skills from a 1-10 rating (the base for every skill) and position.
  // Clamping at 0/10 is rebalanced so totals stay equal.
  T.ratingStats = function (rating, pos) {
    const base = T.clampRating(rating);
    const off = T.OFFSETS[pos] || T.OFFSETS.A;
    const keys = VB.STAT_KEYS, target = base * keys.length;
    const v = {};
    for (const k of keys) v[k] = Math.min(10, Math.max(0, base + (off[k] || 0)));
    let diff = target - keys.reduce((a, k) => a + v[k], 0);
    while (diff !== 0) {
      const up = diff > 0;
      const cands = keys.filter((k) => (up ? v[k] < 10 : v[k] > 0));
      if (!cands.length) break;
      // Add to the stats this position leans toward; take from the ones it leans away from.
      cands.sort((a, b) => (up ? (off[b] || 0) - (off[a] || 0) : (off[a] || 0) - (off[b] || 0)));
      v[cands[0]] += up ? 1 : -1;
      diff += up ? -1 : 1;
    }
    return v;
  };

  // Accepts an open-gym-teams backup (JSON) or lines like "Jamie, 7, setter, F" (tabs/commas/semicolons).
  // Backups marked scale:10 are 1-10; older ones are 1-5 stars and convert as 2x - 1.
  T.parsePlayers = function (text) {
    text = String(text || '').trim();
    const uid = () => Math.random().toString(36).slice(2, 9);
    const norm = (p, conv) => ({
      id: String(p.id || uid()),
      name: String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      skill: (conv || T.clampRating)(p.skill),
      pos: T.POSN[p.pos] ? p.pos : '',
      gender: ['M', 'F'].includes(p.gender) ? p.gender : '',
    });
    if (text.startsWith('{') || text.startsWith('[')) {
      let d;
      try { d = JSON.parse(text); } catch (e) { return { error: 'That looks like JSON but could not be read: ' + e.message }; }
      const arr = Array.isArray(d) ? d : d.players;
      if (!Array.isArray(arr)) return { error: 'No "players" list found in the backup.' };
      const conv = d.scale === 10 ? T.clampRating : T.fromStars;
      const players = arr.filter((p) => p && p.name).map((p) => norm(p, conv));
      const ids = new Set(players.map((p) => p.id));
      const pairs = (Array.isArray(d.pairs) ? d.pairs : []).filter((r) => r && ids.has(r.a) && ids.has(r.b) && (r.type === 'together' || r.type === 'apart'));
      return { players, pairs, converted: d.scale !== 10 };
    }
    const players = [];
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(/\t|,|;/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const o = { name: parts[0], skill: T.DEFAULT_RATING, pos: '', gender: '' };
      for (const raw of parts.slice(1)) {
        const s = raw.toLowerCase();
        if (/^\d/.test(s)) { o.skill = T.clampRating(parseFloat(s)); continue; }
        if (/^[*★]+$/.test(raw)) { o.skill = T.fromStars(raw.length); continue; } // old-style stars
        if (['m', 'male', 'man', 'guy'].includes(s)) { o.gender = 'M'; continue; }
        if (['f', 'female', 'woman', 'girl'].includes(s)) { o.gender = 'F'; continue; }
        if (/^(s|set|setter)$/.test(s)) o.pos = 'S';
        else if (/^(h|hit|hitter|outside|oh|opp|opposite|right|rs|wing)/.test(s)) o.pos = 'H';
        else if (/^(mb|mid|middle|blocker)/.test(s)) o.pos = 'M';
        else if (/^(l|lib|libero|ds|def|dig)/.test(s)) o.pos = 'L';
        else if (/^(a|all|utility|any)/.test(s)) o.pos = 'A';
      }
      players.push(norm(o));
    }
    return { players, pairs: [] };
  };

  // ------------------------------------------------------------ team division (vball-teams engine)
  const W = { skill: 125, range: 62.5, pair: 400, role: 300, short: 0.5 };
  const CS = 0, CH = 1, CA = 2;
  const CW = [0, 0, 0, 4, 4, 3, 3]; // setter, hitter, all-around (role rule only), then male, female, strong, newer
  const NC = CW.length;
  const SIDE = 6;
  const strength = (skillSum, size) => skillSum / size - W.short * Math.max(0, SIDE - size);
  const roleGap = (s, h, a) => Math.max(0, (s ? 0 : 1) + (h ? 0 : 1) - Math.floor(a / 2));

  function buildCtx(players, pairs) {
    const n = players.length;
    const idx = new Map(players.map((p, i) => [p.id, i]));
    const skill = players.map((p) => +p.skill || T.DEFAULT_RATING);
    const cat = players.map((p) => {
      const c = [];
      const pi = { S: CS, H: CH, A: CA }[p.pos];
      if (pi != null) c.push(pi);
      if (p.gender === 'M') c.push(3);
      if (p.gender === 'F') c.push(4);
      if (p.skill >= 7) c.push(5);
      if (p.skill <= 3) c.push(6);
      return c;
    });
    const catTotal = new Float64Array(NC);
    cat.forEach((c) => c.forEach((x) => catTotal[x]++));
    const pen = new Float64Array(n * n);
    for (const r of pairs || []) {
      const a = idx.get(r.a), b = idx.get(r.b);
      if (a == null || b == null) continue;
      const d = r.type === 'together' ? -W.pair : W.pair;
      pen[a * n + b] += d; pen[b * n + a] += d;
    }
    return { ids: players.map((p) => p.id), n, skill, cat, catTotal, pen };
  }

  function statCost(ctx, tSkill, tSize, tCat) {
    const k = tSize.length;
    let c = 0, mx = -Infinity, mn = Infinity, sum = 0, cnt = 0;
    for (let t = 0; t < k; t++) if (tSize[t]) { sum += strength(tSkill[t], tSize[t]); cnt++; }
    const mean = cnt ? sum / cnt : 0;
    for (let t = 0; t < k; t++) {
      if (!tSize[t]) continue;
      const avg = strength(tSkill[t], tSize[t]), d = avg - mean;
      c += W.skill * d * d;
      if (avg > mx) mx = avg;
      if (avg < mn) mn = avg;
      for (let ci = 0; ci < NC; ci++) {
        if (!CW[ci] || !ctx.catTotal[ci]) continue;
        const e = (ctx.catTotal[ci] * tSize[t]) / ctx.n, d2 = tCat[t * NC + ci] - e;
        c += CW[ci] * d2 * d2;
      }
      c += W.role * roleGap(tCat[t * NC + CS], tCat[t * NC + CH], tCat[t * NC + CA]);
    }
    if (mx > -Infinity) c += W.range * (mx - mn) * (mx - mn);
    return c;
  }

  // Simulated annealing with restarts; swaps two players on different teams.
  T.makeTeams = function (players, k, pairs) {
    const ctx = buildCtx(players, pairs);
    const n = ctx.n, pen = ctx.pen;
    const sizes = shuffle(Array.from({ length: k }, (_, t) => Math.floor(n / k) + (t < n % k ? 1 : 0)));
    const restarts = 14, iters = Math.max(2000, n * 150);
    let best = null, bestCost = Infinity;
    for (let r = 0; r < restarts; r++) {
      const order = shuffle([...Array(n).keys()]);
      const team = new Int32Array(n);
      let q = 0;
      sizes.forEach((s, t) => { for (let x = 0; x < s; x++) team[order[q++]] = t; });
      const tSkill = new Float64Array(k), tSize = new Float64Array(k), tCat = new Float64Array(k * NC);
      for (let i = 0; i < n; i++) { const t = team[i]; tSkill[t] += ctx.skill[i]; tSize[t]++; for (const c of ctx.cat[i]) tCat[t * NC + c]++; }
      let pc = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (team[i] === team[j]) pc += pen[i * n + j];
      let sc = statCost(ctx, tSkill, tSize, tCat), cost = pc + sc;
      let lb = cost;
      const lt = team.slice();
      let Tm = 8;
      const cool = Math.pow(0.02 / 8, 1 / iters);
      for (let it = 0; it < iters; it++, Tm *= cool) {
        const a = (rnd() * n) | 0, b = (rnd() * n) | 0;
        const A = team[a], B = team[b];
        if (A === B) continue;
        let dp = 0;
        const ra = a * n, rb = b * n;
        for (let j = 0; j < n; j++) {
          if (j === a || j === b) continue;
          const tj = team[j];
          if (tj === A) dp += pen[rb + j] - pen[ra + j];
          else if (tj === B) dp += pen[ra + j] - pen[rb + j];
        }
        const ds = ctx.skill[b] - ctx.skill[a];
        tSkill[A] += ds; tSkill[B] -= ds;
        for (const c of ctx.cat[a]) { tCat[A * NC + c]--; tCat[B * NC + c]++; }
        for (const c of ctx.cat[b]) { tCat[B * NC + c]--; tCat[A * NC + c]++; }
        const nsc = statCost(ctx, tSkill, tSize, tCat);
        const d = dp + nsc - sc;
        if (d <= 0 || rnd() < Math.exp(-d / Tm)) {
          team[a] = B; team[b] = A; sc = nsc; cost += d;
          if (cost < lb - 1e-9) { lb = cost; lt.set(team); }
        } else {
          tSkill[A] -= ds; tSkill[B] += ds;
          for (const c of ctx.cat[a]) { tCat[A * NC + c]++; tCat[B * NC + c]--; }
          for (const c of ctx.cat[b]) { tCat[B * NC + c]++; tCat[A * NC + c]--; }
        }
      }
      if (lb < bestCost) { bestCost = lb; best = lt; }
    }
    const teams = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) teams[best[i]].push(players[i].id);
    return teams;
  };

  // "First L." names; if two players would match, add letters of the last name until they don't.
  let snCache = { key: '', map: {} };
  T.shortNames = function (players) {
    const key = players.map((p) => p.id + ':' + p.name).join('|');
    if (snCache.key === key) return snCache.map;
    const parts = players.map((p) => { const w = p.name.trim().split(/\s+/); return { id: p.id, first: w[0], last: w.length > 1 ? w.slice(1).join(' ') : '' }; });
    const map = {};
    const fmt = (x, n) => (x.last ? `${x.first} ${x.last.slice(0, n)}${n < x.last.length ? '.' : ''}` : x.first);
    for (const x of parts) {
      let n = 1;
      const clash = (k) => parts.some((y) => y !== x && fmt(y, k) === fmt(x, k));
      while (x.last && n < x.last.length && clash(n)) n++;
      map[x.id] = fmt(x, n);
    }
    snCache = { key, map };
    return map;
  };

  T.teamStrength = (ps) => (ps.length ? ps.reduce((a, p) => a + (+p.skill || T.DEFAULT_RATING), 0) / ps.length : 0);

  // ------------------------------------------------------------ lineups (any roster size)
  // Rotations over a full cycle; with extras, a bench player comes in at serve (see Team.rotate in game.js).
  T.cycleRotations = function (order) {
    let court = order.slice(0, 6), bench = order.slice(6);
    const out = [];
    for (let r = 0; r < order.length; r++) {
      out.push({ front: [court[1], court[2], court[3]], back: [court[0], court[4], court[5]], bench: bench.slice() });
      if (bench.length) { const sub = bench.shift(); bench.push(court[1]); court = [sub, court[2], court[3], court[4], court[5], court[0]]; }
      else court = court.slice(1).concat(court[0]);
    }
    return out;
  };

  function lineupScore(order) {
    const s = T.cycleRotations(order).map((x) => VB.rotationStrength(x.front, x.back));
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
    return Math.min(...s) + 0.25 * mean - 0.5 * sd;
  }

  // Spread setters, hitters, blockers and passers so every rotation is playable.
  T.bestLineup = function (players) {
    const n = players.length;
    let best = players.slice(), bestScore = lineupScore(best);
    if (n <= 8) {
      const perm = (arr, k) => {
        if (k === arr.length) { const sc = lineupScore(arr); if (sc > bestScore + 1e-9) { bestScore = sc; best = arr.slice(); } return; }
        for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
      };
      perm(players.slice(), 0);
    } else {
      for (let r = 0; r < 12; r++) {
        let cur = shuffle(players.slice()), cs = lineupScore(cur);
        for (let it = 0; it < 600; it++) {
          const i = (rnd() * n) | 0, j = (rnd() * n) | 0;
          if (i === j) continue;
          [cur[i], cur[j]] = [cur[j], cur[i]];
          const sc = lineupScore(cur);
          if (sc >= cs) cs = sc; else [cur[i], cur[j]] = [cur[j], cur[i]];
        }
        if (cs > bestScore) { bestScore = cs; best = cur.slice(); }
      }
    }
    return best;
  };

  // ------------------------------------------------------------ team colours
  T.COLORS = [
    ['Red', '#cc0000'], ['Blue', '#0066ff'], ['Green', '#009900'], ['Yellow', '#ffcc00'],
    ['Orange', '#ff6600'], ['Purple', '#9933cc'], ['Pink', '#ff66cc'], ['Cyan', '#00cccc'],
    ['Brown', '#996633'], ['Gray', '#999999'], ['White', '#ffffff'], ['Black', '#333333'],
  ];
  T.teamIdentity = (i) => {
    if (i < T.COLORS.length) return { name: T.COLORS[i][0], color: T.COLORS[i][1] };
    const h = Math.round((i * 137.5) % 360);
    return { name: 'Team ' + (i + 1), color: `hsl(${h} 70% 50%)` };
  };

  // ------------------------------------------------------------ formats
  T.DEFAULT_CONFIG = {
    numTeams: 0, // 0 = as many teams of 6+ as possible
    format: 'pool-playoff', // 'single' | 'double' | 'roundrobin' | 'pool-playoff'
    seeding: 'strength', // 'strength' | 'random'
    pools: 2,
    poolGames: 0, // 0 = full round robin, else games per team
    poolDouble: false, // play each pool opponent twice
    advanceMode: 'perPool', // 'perPool' | 'overall'
    advanceCount: 2, // per pool (perPool) or total (overall)
    playoffType: 'single', // 'single' | 'double'
    thirdPlace: false,
    bracketStyle: 'standard', // 'standard' | 'ladder' (single elimination: top seeds get extra byes)
    ladderByes: '', // e.g. "4, 2"; blank = automatic
    gfReset: true,
    match: {
      pool: { bestOf: 1, playAllSets: false, pointsPerSet: 25, finalSetPoints: 15, winBy2: true, pointCap: 0 },
      playoff: { bestOf: 3, playAllSets: false, pointsPerSet: 25, finalSetPoints: 15, winBy2: true, pointCap: 0 },
      final: { bestOf: 3, playAllSets: false, pointsPerSet: 25, finalSetPoints: 15, winBy2: true, pointCap: 0 },
    },
    rules: { netHeight: 2.35, handlingCalls: 1, frontRowSetter: true, switchSides: true },
  };

  const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
  // Standard bracket order so seed 1 and 2 can only meet in the final.
  function seedOrder(P) {
    let o = [1];
    while (o.length < P) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); }
    return o;
  }
  function roundName(matchesInRound) {
    return matchesInRound === 1 ? 'Final' : matchesInRound === 2 ? 'Semifinals' : matchesInRound === 4 ? 'Quarterfinals' : `Round of ${matchesInRound * 2}`;
  }

  let mid = 0;
  const newMatch = (o) => Object.assign({ id: 'm' + (++mid) + Math.random().toString(36).slice(2, 5), result: null, a: null, b: null }, o);

  // Single elimination. `seeds` is a list of team ids (or sources) in seed order.
  function singleElim(seeds, opts) {
    const N = seeds.length, P = nextPow2(Math.max(2, N)), ord = seedOrder(P);
    const ms = [];
    let prev = [];
    for (let i = 0; i < P / 2; i++) {
      const sa = ord[2 * i], sb = ord[2 * i + 1];
      prev.push(newMatch({
        stage: 'playoff', bracket: 'W', round: 1,
        srcA: sa <= N ? { seed: sa - 1 } : { bye: true }, srcB: sb <= N ? { seed: sb - 1 } : { bye: true },
      }));
    }
    ms.push(...prev);
    let round = 1;
    while (prev.length > 1) {
      round++;
      const next = [];
      for (let i = 0; i < prev.length; i += 2) next.push(newMatch({ stage: 'playoff', bracket: 'W', round, srcA: { winner: prev[i].id }, srcB: { winner: prev[i + 1].id } }));
      ms.push(...next);
      if (next.length === 1 && opts.thirdPlace && prev.length === 2) {
        ms.push(newMatch({ stage: 'playoff', bracket: '3rd', round, label: '3rd place', srcA: { loser: prev[0].id }, srcB: { loser: prev[1].id } }));
      }
      prev = next;
    }
    const rounds = round;
    for (const m of ms) if (m.bracket === 'W') {
      const cnt = ms.filter((x) => x.bracket === 'W' && x.round === m.round).length;
      m.label = m.label || roundName(cnt);
      m.isFinal = m.round === rounds;
    }
    return ms;
  }

  // ---- Stepladder: top seeds get byes into later rounds.
  // `byes` lists how many teams sit out each round (e.g. [4, 2] for 8 teams). Each round, the teams entering
  // and the previous round's winners are ranked by (expected) seed and paired best vs worst.
  T.autoLadderByes = function (N) {
    if (N < 3) return [];
    const out = [];
    if (N % 2 === 0) for (let b = N - 4; b >= 2; b -= 2) out.push(b); // 4 teams start, 2 more join each round
    else for (let b = N - 2; b >= 1; b--) out.push(b); // classic one-at-a-time stepladder
    return out;
  };

  T.parseByes = function (str) {
    return String(str || '').split(/[\s,;]+/).filter(Boolean).map((x) => Math.round(+x));
  };

  // Plan the rounds. Returns {rounds:[{pairs:[[a,b]], ...}]} with slots as {seed} or {from: [roundIdx, pairIdx]}, or {error}.
  T.ladderPlan = function (N, byesIn) {
    if (N < 2) return { error: 'Need at least 2 teams.' };
    let byes = byesIn && byesIn.length ? byesIn.slice() : T.autoLadderByes(N);
    if (byes.some((b) => !Number.isFinite(b) || b < 0 || b >= N)) return { error: `Byes must be between 0 and ${N - 1}.` };
    for (let i = 1; i < byes.length; i++) if (byes[i] >= byes[i - 1]) return { error: 'Byes must go down each round (e.g. 4, 2).' };
    if (byes[byes.length - 1] !== 0) byes.push(0);
    byes = byes.filter((b, i) => b > 0 || i === byes.findIndex((x) => x === 0));
    const rounds = [];
    let winners = []; // {from:[r,i], exp: expected seed, label}
    let entered = N; // seeds >= entered (0-based) are already in
    let r = 0;
    while (true) {
      const b = r < byes.length ? byes[r] : 0;
      const entrants = [];
      for (let s = b; s < entered; s++) entrants.push({ seed: s, exp: s, label: String(s + 1) });
      entered = Math.min(entered, b);
      const pool = entrants.concat(winners).sort((x, y) => x.exp - y.exp);
      if (pool.length === 1 && b === 0) break; // champion decided
      if (pool.length % 2) return { error: `Round ${r + 1} would have ${pool.length} teams — change the byes so every round pairs up evenly.` };
      if (!pool.length) return { error: 'Byes leave a round with no teams.' };
      const pairs = [];
      for (let i = 0; i < pool.length / 2; i++) pairs.push([pool[i], pool[pool.length - 1 - i]]);
      rounds.push({ pairs, byes: b });
      const merge = (a, b) => (a + '/' + b).split('/').map(Number).sort((x, y) => x - y).join('/');
      winners = pairs.map((p, i) => ({ from: [r, i], exp: Math.min(p[0].exp, p[1].exp), label: merge(p[0].label, p[1].label) }));
      r++;
      if (r > 64) return { error: 'Too many rounds.' };
    }
    return { rounds, byes: byes.filter((b) => b > 0) };
  };

  // Human-readable preview, e.g. "Round 1: 5 v 8, 6 v 7".
  T.ladderPreview = function (plan) {
    const n = plan.rounds.length;
    const name = (r) => (r === n - 1 ? 'Final' : r === n - 2 && plan.rounds[r].pairs.length === 2 ? 'Semifinals' : `Round ${r + 1}`);
    return plan.rounds.map((rd, r) => ({ name: name(r), games: rd.pairs.map(([a, b]) => `${a.label} v ${b.label}`) }));
  };

  function ladderElim(seeds, opts) {
    const plan = T.ladderPlan(seeds.length, T.parseByes(opts.ladderByes));
    if (plan.error) return singleElim(seeds, opts); // fall back to a standard bracket
    const ids = plan.rounds.map(() => []);
    const ms = [];
    const n = plan.rounds.length;
    const prev = T.ladderPreview(plan);
    plan.rounds.forEach((rd, r) => {
      rd.pairs.forEach((pair, i) => {
        const src = (x) => (x.seed != null ? { seed: x.seed } : { winner: ids[x.from[0]][x.from[1]] });
        const m = newMatch({ stage: 'playoff', bracket: 'W', round: r + 1, srcA: src(pair[0]), srcB: src(pair[1]), label: prev[r].name, isFinal: r === n - 1 });
        ids[r][i] = m.id;
        ms.push(m);
      });
    });
    if (opts.thirdPlace && n >= 2 && plan.rounds[n - 2].pairs.length === 2) {
      ms.push(newMatch({ stage: 'playoff', bracket: '3rd', round: n, label: '3rd place', srcA: { loser: ids[n - 2][0] }, srcB: { loser: ids[n - 2][1] } }));
    }
    return ms;
  }

  // Double elimination: winners bracket, losers bracket and a grand final (+ optional reset).
  function doubleElim(seeds, opts) {
    const wb = singleElim(seeds, { thirdPlace: false });
    const N = seeds.length, P = nextPow2(Math.max(2, N));
    const wbRounds = Math.round(Math.log2(P));
    const wbR = (r) => wb.filter((m) => m.round === r);
    for (const m of wb) { m.label = 'Winners ' + (m.isFinal ? 'final' : m.label === 'Final' ? 'final' : `R${m.round}`); m.isFinal = false; }
    const lb = [];
    let lbRound = 0;
    let carry = [];
    // LB round 1: losers of WB round 1 paired up.
    const r1 = wbR(1);
    if (r1.length >= 2) {
      lbRound++;
      for (let i = 0; i < r1.length; i += 2) carry.push(newMatch({ stage: 'playoff', bracket: 'L', round: lbRound, srcA: { loser: r1[i].id }, srcB: { loser: r1[i + 1].id } }));
      lb.push(...carry);
    } else carry = r1.map((m) => ({ loserOf: m.id }));
    for (let r = 2; r <= wbRounds; r++) {
      // Drop round: LB survivors meet the losers coming down from WB round r (order flipped to avoid rematches).
      const drops = wbR(r).slice();
      if (r % 2 === 0) drops.reverse();
      lbRound++;
      const dropMatches = drops.map((wm, i) => {
        const c = carry[i];
        const srcA = c.loserOf ? { loser: c.loserOf } : { winner: c.id };
        return newMatch({ stage: 'playoff', bracket: 'L', round: lbRound, srcA, srcB: { loser: wm.id } });
      });
      lb.push(...dropMatches);
      carry = dropMatches;
      if (r < wbRounds && carry.length >= 2) {
        lbRound++;
        const pairs = [];
        for (let i = 0; i < carry.length; i += 2) pairs.push(newMatch({ stage: 'playoff', bracket: 'L', round: lbRound, srcA: { winner: carry[i].id }, srcB: { winner: carry[i + 1].id } }));
        lb.push(...pairs);
        carry = pairs;
      }
    }
    for (const m of lb) m.label = lb.filter((x) => x.round === m.round).length === 1 && m.round === lbRound ? 'Losers final' : `Losers R${m.round}`;
    const wbFinal = wbR(wbRounds)[0];
    const lbChamp = carry[0];
    const gf = newMatch({
      stage: 'playoff', bracket: 'GF', round: 1, label: 'Grand final', isFinal: true,
      srcA: { winner: wbFinal.id }, srcB: lbChamp.loserOf ? { loser: lbChamp.loserOf } : { winner: lbChamp.id },
    });
    const out = wb.concat(lb, [gf]);
    if (opts.gfReset) out.push(newMatch({ stage: 'playoff', bracket: 'GF2', round: 2, label: 'Grand final (reset)', isFinal: true, conditional: true, srcA: { winner: gf.id }, srcB: { loser: gf.id } }));
    return out;
  }

  // Round-robin rounds by the circle method.
  function roundRobin(ids) {
    const list = ids.slice();
    if (list.length % 2) list.push(null);
    const n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const games = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i], b = list[n - 1 - i];
        if (a != null && b != null) games.push(r % 2 ? [b, a] : [a, b]);
      }
      rounds.push(games);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  function poolMatches(poolIds, poolIdx, games, double) {
    let rounds = roundRobin(poolIds);
    if (double) rounds = rounds.concat(rounds.map((g) => g.map(([a, b]) => [b, a])));
    const target = games > 0 ? games : Infinity;
    const played = new Map(poolIds.map((id) => [id, 0]));
    const ms = [];
    rounds.forEach((g, ri) => {
      for (const [a, b] of g) {
        if (played.get(a) >= target || played.get(b) >= target) continue;
        played.set(a, played.get(a) + 1); played.set(b, played.get(b) + 1);
        ms.push(newMatch({ stage: 'pool', pool: poolIdx, round: ri + 1, a, b, label: `Pool ${String.fromCharCode(65 + poolIdx)} · R${ri + 1}` }));
      }
    });
    return ms;
  }

  // Seeds teams by strength (stronger first) or randomly.
  T.seedTeams = function (tour) {
    const ids = tour.teams.map((t) => t.id);
    if (tour.config.seeding === 'random') return shuffle(ids);
    const st = (id) => T.teamStrength(tour.teams.find((t) => t.id === id).playerIds.map((pid) => tour.playerMap[pid]));
    return ids.sort((a, b) => st(b) - st(a));
  };

  // Build the opening stage of a tournament.
  T.start = function (tour) {
    const c = tour.config;
    const seeds = T.seedTeams(tour);
    tour.seeds = seeds;
    tour.matches = [];
    tour.stage = 'pool';
    if (c.format === 'single' || c.format === 'double') {
      T.buildPlayoff(tour, seeds);
    } else {
      const pools = c.format === 'roundrobin' ? 1 : Math.max(1, Math.min(c.pools, Math.floor(seeds.length / 2)));
      tour.pools = Array.from({ length: pools }, () => []);
      // Snake draft by seed so pools are even.
      seeds.forEach((id, i) => {
        const r = Math.floor(i / pools), j = i % pools;
        tour.pools[r % 2 ? pools - 1 - j : j].push(id);
      });
      tour.pools.forEach((p, i) => tour.matches.push(...poolMatches(p, i, c.poolGames, c.poolDouble)));
    }
    T.resolve(tour);
    return tour;
  };

  T.buildPlayoff = function (tour, seeds) {
    const c = tour.config;
    tour.stage = 'playoff';
    tour.playoffSeeds = seeds;
    const type = c.format === 'double' || (c.format === 'pool-playoff' && c.playoffType === 'double') ? 'double' : 'single';
    const ms = type === 'double' ? doubleElim(seeds, c) : c.bracketStyle === 'ladder' ? ladderElim(seeds, c) : singleElim(seeds, c);
    for (const m of ms) {
      m.srcA = m.srcA.seed != null ? { team: seeds[m.srcA.seed] } : m.srcA;
      m.srcB = m.srcB.seed != null ? { team: seeds[m.srcB.seed] } : m.srcB;
    }
    tour.matches.push(...ms);
  };

  // ------------------------------------------------------------ results & standings
  const byId = (tour, id) => tour.matches.find((m) => m.id === id);
  const winnerOf = (m) => (m.result ? (m.result.winner === 'A' ? m.a : m.result.winner === 'B' ? m.b : null) : null);
  const loserOf = (m) => (m.result ? (m.result.winner === 'A' ? m.b : m.result.winner === 'B' ? m.a : null) : null);
  const BYE = '__bye';

  // Fill in teams from finished matches, and auto-advance byes. Returns true if anything changed.
  T.resolve = function (tour) {
    let changed = true, any = false;
    while (changed) {
      changed = false;
      for (const m of tour.matches) {
        if (m.stage !== 'playoff') continue;
        for (const side of ['A', 'B']) {
          const key = side === 'A' ? 'a' : 'b', src = m['src' + side];
          if (m[key]) continue;
          let v = null;
          if (src.team) v = src.team;
          else if (src.bye) v = BYE;
          else if (src.winner) { const s = byId(tour, src.winner); if (s && s.result) v = winnerOf(s); }
          else if (src.loser) { const s = byId(tour, src.loser); if (s && s.result) v = loserOf(s); }
          if (v) { m[key] = v; changed = any = true; }
        }
        if (!m.result && m.a && m.b && (m.a === BYE || m.b === BYE)) {
          m.result = { winner: m.a === BYE ? 'B' : 'A', bye: true, sets: [0, 0], setScores: [[], []] };
          if (m.a === BYE && m.b === BYE) m.result.winner = 'A';
          changed = any = true;
        }
      }
    }
    // Grand-final reset is only played if the losers-bracket team wins the first final.
    for (const m of tour.matches) {
      if (m.bracket !== 'GF2' || m.result) continue;
      const gf = byId(tour, m.srcA.winner);
      if (gf && gf.result) {
        if (gf.result.winner === 'A') { m.result = { winner: 'A', skipped: true, sets: [0, 0], setScores: [[], []] }; m.a = gf.a; m.b = gf.b; any = true; }
      }
    }
    return any;
  };

  T.isPlayable = (m) => !m.result && m.a && m.b && m.a !== BYE && m.b !== BYE;
  T.BYE = BYE;

  // Pool standings: 2 pts per win, 1 per tied match, then set %, then point difference.
  T.standings = function (tour, poolIdx) {
    const ids = poolIdx == null ? tour.teams.map((t) => t.id) : tour.pools[poolIdx];
    const rows = new Map(ids.map((id) => [id, { id, p: 0, w: 0, l: 0, t: 0, sw: 0, sl: 0, pf: 0, pa: 0 }]));
    for (const m of tour.matches) {
      if (m.stage !== 'pool' || !m.result || (poolIdx != null && m.pool !== poolIdx)) continue;
      const A = rows.get(m.a), B = rows.get(m.b);
      if (!A || !B) continue;
      A.p++; B.p++;
      if (m.result.winner === 'A') { A.w++; B.l++; } else if (m.result.winner === 'B') { B.w++; A.l++; } else { A.t++; B.t++; }
      A.sw += m.result.sets[0]; A.sl += m.result.sets[1]; B.sw += m.result.sets[1]; B.sl += m.result.sets[0];
      const pa = m.result.setScores[0].reduce((x, y) => x + y, 0), pb = m.result.setScores[1].reduce((x, y) => x + y, 0);
      A.pf += pa; A.pa += pb; B.pf += pb; B.pa += pa;
    }
    const seedRank = new Map((tour.seeds || []).map((id, i) => [id, i]));
    return [...rows.values()].sort((a, b) =>
      (b.w * 2 + b.t) - (a.w * 2 + a.t) ||
      (b.sw / Math.max(1, b.sw + b.sl)) - (a.sw / Math.max(1, a.sw + a.sl)) ||
      (b.pf - b.pa) - (a.pf - a.pa) ||
      (seedRank.get(a.id) ?? 0) - (seedRank.get(b.id) ?? 0));
  };

  const poolsDone = (tour) => tour.matches.filter((m) => m.stage === 'pool').every((m) => m.result);

  // Who advances from pools, in playoff seed order.
  T.qualifiers = function (tour) {
    const c = tour.config;
    const tables = tour.pools.map((_, i) => T.standings(tour, i));
    const key = (r) => [r.w * 2 + r.t, r.sw / Math.max(1, r.sw + r.sl), r.pf - r.pa];
    const cmp = (a, b) => { const x = key(a), y = key(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };
    if (c.advanceMode === 'overall') {
      // Pool winners first, then everyone else by record.
      const winners = tables.map((t) => t[0]).sort(cmp);
      const rest = tables.flatMap((t) => t.slice(1)).sort(cmp);
      return winners.concat(rest).slice(0, Math.max(2, c.advanceCount)).map((r) => r.id);
    }
    const per = Math.max(1, c.advanceCount);
    const out = [];
    for (let place = 0; place < per; place++) out.push(...tables.map((t) => t[place]).filter(Boolean).sort(cmp));
    return out.map((r) => r.id);
  };

  // Record a finished match and advance the tournament.
  T.applyResult = function (tour, matchId, result) {
    const m = byId(tour, matchId);
    if (!m || m.result) return;
    m.result = result;
    T.resolve(tour);
    if (tour.stage === 'pool' && poolsDone(tour)) {
      if (tour.config.format === 'roundrobin') { tour.stage = 'done'; tour.champion = T.standings(tour, 0)[0].id; return; }
      const q = T.qualifiers(tour);
      if (q.length < 2) { tour.stage = 'done'; tour.champion = q[0]; return; }
      T.buildPlayoff(tour, q);
      T.resolve(tour);
    }
    T.checkDone(tour);
  };

  T.checkDone = function (tour) {
    if (tour.stage !== 'playoff') return;
    const ms = tour.matches.filter((m) => m.stage === 'playoff');
    if (!ms.every((m) => m.result)) return;
    tour.stage = 'done';
    const gf2 = ms.find((m) => m.bracket === 'GF2');
    const gf = ms.find((m) => m.bracket === 'GF');
    const fin = gf2 && !gf2.result.skipped ? gf2 : gf || ms.find((m) => m.isFinal && m.bracket === 'W');
    tour.champion = winnerOf(fin);
    tour.runnerUp = loserOf(fin);
  };

  // Which match format applies to a match.
  T.formatFor = function (tour, m) {
    const c = tour.config;
    if (m.stage === 'pool') return c.match.pool;
    if (m.isFinal) return c.match.final;
    return c.match.playoff;
  };

  T.nextPlayable = (tour) => tour.matches.find((m) => T.isPlayable(m));

  // ------------------------------------------------------------ highlight round weights
  // Highlights from later playoff rounds score higher.
  T.ROUND_WEIGHTS = { pool: 1, early: 7 / 6, quarter: 6 / 5, semi: 5 / 4, winnersFinal: 4 / 3, final: 3 / 2 };
  T.TIER_LABELS = { pool: 'Pool play', early: 'Early rounds (R16 and before)', quarter: 'Quarterfinals', semi: 'Semifinals / 3rd place', winnersFinal: "Winners' final (double elim)", final: 'Final / grand final' };
  T.stageTier = function (tour, m) {
    if (m.stage !== 'playoff') return 'pool';
    if (m.isFinal || m.bracket === 'GF' || m.bracket === 'GF2') return 'final';
    if (m.bracket === '3rd') return 'semi';
    const rounds = (b) => tour.matches.filter((x) => x.stage === 'playoff' && x.bracket === b).map((x) => x.round);
    const wMax = Math.max(1, ...rounds('W'));
    // Rounds left before the final; the losers bracket sits one tier below the matching winners round.
    const toGo = m.bracket === 'L' ? (Math.max(...rounds('L')) - m.round) / 2 + 2 : wMax - m.round;
    return toGo <= 0 ? 'winnersFinal' : toGo <= 1 ? 'semi' : toGo <= 2 ? 'quarter' : 'early';
  };
  T.stageWeight = (tour, m) => T.ROUND_WEIGHTS[T.stageTier(tour, m)];

  // ------------------------------------------------------------ simulation glue
  // Team data in the format VB.Game expects (lineup order = rotation order).
  T.gameTeam = function (tour, teamId) {
    const t = tour.teams.find((x) => x.id === teamId);
    return {
      name: t.name, color: t.color,
      players: t.playerIds.map((pid, i) => {
        const p = tour.playerMap[pid];
        return { id: pid, name: p.name, display: T.shortNames(Object.values(tour.playerMap))[pid], number: t.numbers ? t.numbers[pid] : i + 1, height: T.HEIGHT_IN, skin: T.SKIN, stats: T.ratingStats(p.skill, p.pos) };
      }),
    };
  };

  T.gameSettings = function (tour, m, fast) {
    const s = Object.assign({}, VB.DEFAULT_SETTINGS, tour.config.rules, T.formatFor(tour, m));
    if (fast) Object.assign(s, { pointDelay: 0.2, serveDelay: 0.2, setBreak: 0.2 });
    return s;
  };

  // Pull the result out of a finished Game.
  T.gameResult = function (g, teamsData) {
    const [a, b] = g.teams;
    const box = {};
    g.teams.forEach((t, ti) => t.roster.forEach((p, i) => { box[teamsData[ti].players[i].id] = Object.assign({}, p.box); }));
    return {
      winner: g.winner ? (g.winner === a ? 'A' : 'B') : null,
      sets: [a.sets, b.sets],
      setScores: [a.setScores.slice(), b.setScores.slice()],
      box,
    };
  };

  // Run a whole match without rendering.
  T.simMatch = function (teamsData, settings, opts = {}) {
    const g = new VB.Game(teamsData, settings, 'tournament');
    const rec = opts.highlights && VB.HL ? VB.HL.attach(g, { keep: opts.highlights }) : null;
    const DT = VB.C.DT, maxSteps = 240 * 60 * 180;
    let steps = 0;
    while (g.phase !== 'over' && steps < maxSteps) { g.update(DT); steps++; }
    const res = T.gameResult(g, teamsData);
    if (rec) res.highlights = rec.best(opts.highlights);
    return res;
  };
})();

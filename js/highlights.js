// Highlights: records each rally as a light replay, scores how exciting each point was,
// writes a caption, and plays highlights back through the normal 3D renderer.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const HL = (VB.HL = {});
  const { clamp } = VB;
  const FPS = 20;
  const POSES = ['idle', 'ready', 'bump', 'set', 'approach', 'spikeWind', 'spike', 'block', 'toss', 'serveHit', 'dive', 'celebrate'];
  const POSE_IDX = Object.fromEntries(POSES.map((p, i) => [p, i]));
  const MPH = 2.23694;
  let nextId = 1;
  const newId = () => 'h' + Date.now().toString(36) + (nextId++).toString(36) + Math.random().toString(36).slice(2, 5);

  // ------------------------------------------------------------ recorder
  // Attached to a Game; samples ball + every rostered player 20 times a second from the serve toss
  // until ~1.3 s after the point, then keeps the replay if the point ranks among the best.
  class Recorder {
    constructor(game, opts = {}) {
      this.g = game;
      this.keep = opts.keep || 8; // replays kept per match (all points keep their score/caption)
      this.list = [];
      this.version = 0;
      this.buf = null;
      this.deficit = [[0, 0]]; // per set: biggest deficit each team faced
      this.players = game.allPlayers;
      this.label = opts.label || '';
    }
    tick(g) {
      const ph = g.phase;
      if (ph === 'serve' && !this.buf) this.start(g);
      if (!this.buf) return;
      if (ph === 'serve' || ph === 'rally' || ph === 'dead') {
        if (g.time - this.lastSample >= 1 / FPS - 1e-6) this.sample(g);
      }
      if ((ph === 'dead' && g.time - g.phaseStart > 1.3) || ph === 'preserve' || ph === 'setbreak' || ph === 'over') this.finish(g);
    }
    start(g) {
      this.buf = [];
      this.t0 = g.time;
      this.lastSample = -1;
      this.pending = null;
      this.meta = { set: g.setNo, serving: g.serving, sgn: g.teams.map((t) => t.sgn) };
    }
    sample(g) {
      this.lastSample = g.time;
      const b = g.ball.pos, f = this.buf;
      f.push(b.x * 100, b.y * 100, b.z * 100);
      for (const p of this.players) f.push(p.pos.x * 100, p.pos.y * 100, p.pos.z * 100, p.facing * 1000, POSE_IDX[p.pose] ?? 1);
    }
    // Called by Game.pointTo with the situation before/after the point.
    onPoint(g, ctx) {
      if (!this.buf) return;
      const s = ctx.setNo;
      const d = this.deficit[s] || (this.deficit[s] = [0, 0]);
      const before = ctx.before;
      for (let t = 0; t < 2; t++) d[t] = Math.max(d[t], before[1 - t] - before[t]);
      this.pending = { ctx, pointT: g.time - this.t0, contacts: g.contacts.slice(), crossings: g.rallyCrossings || 0, comebackFrom: d[ctx.winner] };
      // One more sample right at the point so the replay has the exact moment.
      this.sample(g);
    }
    finish(g) {
      const pend = this.pending, buf = this.buf;
      this.buf = null;
      this.pending = null;
      if (!pend || buf.length < 10) return;
      const h = HL.build(g, pend, this.label);
      h.frames = Int16Array.from(buf, (v) => clamp(Math.round(v), -32767, 32767));
      h.stride = 3 + this.players.length * 5;
      h.netTop = VB.C.netTop;
      h.sgn = this.meta.sgn;
      h.players = this.players.map((p) => ({ team: p.team.idx, name: p.name, display: p.display, number: p.number, H: p.H, skin: p.skin }));
      this.list.push(h);
      // Keep replays only for the best few to save memory.
      const ranked = this.list.slice().sort((a, b) => b.score - a.score);
      ranked.forEach((x, i) => { if (i >= this.keep && x.frames) { x.frames = null; x.players = null; } });
      this.version++;
    }
    top(n) { return this.list.slice().sort((a, b) => b.score - a.score).slice(0, n); }
  }
  HL.Recorder = Recorder;
  HL.attach = (game, opts) => (game.recorder = new Recorder(game, opts));

  // ------------------------------------------------------------ scoring & captions
  const nameOf = (p) => (p ? p.display || p.name.split(' ').slice(-1)[0] : '');
  const and = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

  HL.build = function (g, pend, label) {
    const { ctx, contacts: cs, crossings } = pend;
    const W = g.teams[ctx.winner], L = g.teams[1 - ctx.winner];
    const a = ctx.before[ctx.winner], b = ctx.before[1 - ctx.winner], T = ctx.target;
    const winBy2 = g.settings.winBy2;
    const tags = [];
    let s = 0;

    // --- the rally itself
    const exchanges = Math.max(0, crossings);
    if (exchanges >= 3) s += 1.1 * Math.pow(exchanges - 2, 1.25);
    const hardDigs = cs.filter((c) => (c.kind === 'dig' || c.kind === 'pass') && !c.shank && c.vin >= 13 && !c.save);
    const diveDigs = cs.filter((c) => c.dive && !c.shank);
    const saves = cs.filter((c) => c.save);
    const blockTouches = cs.filter((c) => c.kind === 'block');
    s += hardDigs.length * 1.6 + diveDigs.length * 1.2 + saves.length * 1.4 + Math.max(0, blockTouches.length - 1) * 0.6;
    if (exchanges >= 6) tags.push('Long rally');
    if (hardDigs.length + diveDigs.length >= 1) tags.push('Big dig');
    if (saves.length) tags.push('Save');

    // --- how it ended
    const lastW = [...cs].reverse().find((c) => c.team.idx === ctx.winner);
    const lastL = [...cs].reverse().find((c) => c.team.idx !== ctx.winner);
    const lastAny = cs[cs.length - 1];
    const lossesContacts = cs.filter((c) => c.team.idx !== ctx.winner).length;
    let finish = '', finisher = null, kind = 'other';
    // Did the winners earn it? Either the ball died on the losers' side, or the losers touched it last
    // while trying to keep it alive (a dig, pass or block they couldn't control).
    const loserFailedPlay = lastAny && lastAny.team.idx !== ctx.winner && ['dig', 'pass', 'reception', 'body', 'block', 'set', 'free'].includes(lastAny.kind);
    const earned = (ctx.reason === 'in' && (!lastAny || lastAny.team.idx === ctx.winner || loserFailedPlay)) || (ctx.reason !== 'in' && loserFailedPlay);
    if (ctx.netFault || ctx.reason === 'serveError' || ctx.reason === 'handling' || !earned) kind = 'error';
    else if (lastW && lastW.kind === 'attack') {
      kind = 'kill';
      finisher = lastW.player;
      const mph = Math.round((lastW.speed || 0) * MPH);
      const hard = clamp(((lastW.speed || 0) - 13) / 5, 0, 2.5);
      s += 1.5 + hard;
      const offBlock = lastAny && lastAny.kind === 'block' && lastAny.team.idx !== ctx.winner;
      let verb = hard > 1.5 ? 'hammers' : hard > 0.6 ? 'rips' : 'puts away';
      let what = lastW.shot === 'down' ? 'a down ball' : `a ${mph} mph kill`;
      if (lastW.dump) { s += 1.5; what = 'a setter dump on two'; verb = 'sneaks in'; tags.push('Setter dump'); }
      else if (lastW.shot === 'tip') { s += 0.8; what = 'a tip into the open court'; verb = 'drops'; tags.push('Tip'); }
      else if (lastW.shot === 'roll') { s += 0.4; what = 'a roll shot'; verb = 'places'; }
      else if (lastW.back) { s += 1.2; what = `a ${mph} mph back-row kill`; tags.push('Back-row kill'); }
      if (offBlock) { s += 0.8; what += ' off the block'; tags.push('Off the block'); }
      const dugFirst = cs.some((c, i) => c.team.idx === ctx.winner && c.kind === 'dig' && !c.shank && i > 0 && cs[i - 1].kind === 'attack');
      if (dugFirst) { s += 1.2; tags.push('Transition'); }
      finish = `${nameOf(finisher)} (${W.name}) ${verb} ${what}`;
      tags.push('Kill');
    } else if (lastW && lastW.kind === 'block' && lastW.outcome === 'stuff') {
      kind = 'block';
      finisher = lastW.player;
      const atk = [...cs].reverse().find((c) => c.kind === 'attack' && c.team.idx !== ctx.winner);
      s += 2.6 + clamp((((atk && atk.speed) || 0) - 14) / 6, 0, 1.5);
      const blockers = g.lastBlock && g.lastBlock.players ? g.lastBlock.players.map(nameOf) : [nameOf(finisher)];
      finish = `${and(blockers)} ${blockers.length > 1 ? 'put up a wall to roof' : 'roofs'} ${atk ? nameOf(atk.player) : 'the hitter'}${atk && atk.speed > 15 ? ` (a ${Math.round(atk.speed * MPH)} mph swing)` : ''}`;
      tags.push('Block');
    } else if (lastW && lastW.kind === 'serve' && lossesContacts <= 1) {
      kind = 'ace';
      finisher = lastW.player;
      const mph = Math.round((lastW.speed || 0) * MPH);
      s += 1.2 + clamp(((lastW.speed || 0) - 14) / 6, 0, 1.5);
      const st = lastW.serveType === 'topspin' ? 'jump-serve' : lastW.serveType === 'jumpfloat' ? 'jump-float' : lastW.serveType === 'underhand' ? 'underhand' : 'float';
      if (lastW.tape) { s += 2; finish = `${nameOf(finisher)} (${W.name}) trickles a net-cord ace over`; tags.push('Net-cord ace'); }
      else finish = `${nameOf(finisher)} (${W.name}) fires a ${mph} mph ${st} ace`;
      tags.push('Ace');
    }
    if (kind === 'error') {
      s = Math.max(0, s * 0.6 - 0.5);
      finish = ctx.desc.replace(/\s+→.*$/, '');
    } else if (!finish) {
      finish = exchanges >= 3 ? `${W.name} outlast ${L.name} as the ball drops in` : `${W.name} win it as the ball drops in`;
    }

    // --- clutch / situation
    const sets = ctx.setsBefore;
    const maxS = Math.max(a, b), margin = Math.abs(a - b);
    const late = clamp((maxS - (T - 8)) / 8, 0, 1);
    const close = margin <= 1 ? 1 : margin <= 2 ? 0.8 : margin <= 3 ? 0.5 : margin <= 5 ? 0.2 : 0;
    const clutch = late * close;
    const atSetPoint = (x, y) => x + 1 >= T && (!winBy2 || x + 1 - y >= 2);
    const loserHadSetPoint = atSetPoint(b, a);
    const matchPointSaved = loserHadSetPoint && sets[1 - ctx.winner] === ctx.setsToWin - 1;
    const deuce = a >= T - 1 && b >= T - 1;
    // Only the point that ties it or takes the lead counts as the comeback moment.
    const comeback = pend.comebackFrom >= 5 && (a + 1 === b || a === b) && maxS >= T - 8;
    let m = 1 + 1.6 * clutch;
    let situation = '';
    if (ctx.matchWon) { m += 1.5; situation = 'Match point!'; tags.unshift('Match winner'); }
    else if (ctx.setWon) { m += 0.8; situation = 'Set point!'; tags.unshift('Set winner'); }
    if (matchPointSaved) { m += 1.7; situation = 'Match point saved!'; tags.unshift('Saved match point'); }
    else if (loserHadSetPoint) { m += 0.9; situation = situation || 'Set point saved!'; tags.unshift('Saved set point'); }
    if (deuce && !situation) { m += 0.4; situation = 'Deuce.'; }
    if (comeback) { m += 0.5; tags.push('Comeback'); if (!situation) situation = `Comeback from ${pend.comebackFrom} down!`; }
    if (ctx.deciding) m *= 1.2;
    if (kind === 'error') m = 1 + (m - 1) * 0.35; // a clutch error is still mostly an error
    if (clutch >= 0.6 && !situation) situation = 'Crunch time.';
    if (clutch >= 0.6) tags.push('Clutch');
    const score = +((s + 0.4) * m).toFixed(2);

    // --- caption
    const extras = [];
    if (exchanges >= 4) extras.push(`${[8, 11, 18].includes(exchanges) || String(exchanges).startsWith('8') ? 'an' : 'a'} ${exchanges}-exchange rally`);
    const digNames = [...new Set(diveDigs.concat(hardDigs).map((c) => nameOf(c.player)))];
    if (diveDigs.length) extras.push(`${diveDigs.length > 1 ? diveDigs.length + ' diving digs' : 'a diving dig'} (${and([...new Set(diveDigs.map((c) => nameOf(c.player)))])})`);
    else if (hardDigs.length) extras.push(`${hardDigs.length > 1 ? hardDigs.length + ' big digs' : 'a big dig'} by ${and(digNames)}`);
    if (saves.length) extras.push(`a chase-down save by ${and([...new Set(saves.map((c) => nameOf(c.player)))])}`);
    const title = finish;
    const sentence = (x) => (/[.!?]$/.test(x) ? x : x + '.');
    const detail = [situation, extras.length ? sentence('After ' + and(extras)) : ''].filter(Boolean).join(' ');
    const after = ctx.before.slice();
    after[ctx.winner]++;
    return {
      id: newId(), score, title, detail, tags: [...new Set(tags)], kind, label,
      set: ctx.setNo, before: ctx.before.slice(), after, sets: ctx.setsBefore.slice(), winner: ctx.winner,
      teams: g.teams.map((t) => ({ name: t.name, color: t.color })), pointT: pend.pointT, exchanges,
    };
  };

  // 1-5 flames for display.
  HL.flames = (score) => (score >= 14 ? 5 : score >= 9 ? 4 : score >= 6 ? 3 : score >= 3.5 ? 2 : 1);

  // Metadata without the heavy replay data (for saving alongside results).
  HL.meta = (h) => { const o = Object.assign({}, h); delete o.frames; delete o.players; o.hasReplay = !!h.frames; return o; };

  // ------------------------------------------------------------ replay
  // A stand-in for Game that the Renderer can draw, driven by recorded frames.
  class Replay {
    constructor(h) {
      this.h = h;
      const teams = h.teams.map((t, i) => ({ idx: i, name: t.name, color: t.color, sgn: h.sgn ? h.sgn[i] : i ? 1 : -1, ai: {}, score: h.before[i], sets: h.sets[i] }));
      this.teams = teams;
      this.allPlayers = h.players.map((p) => ({
        team: teams[p.team], name: p.name, display: p.display, number: p.number, H: p.H, skin: p.skin,
        pos: new VB.V3(), vel: new VB.V3(), facing: 0, pose: 'ready',
      }));
      this.ball = { pos: new VB.V3(), vel: new VB.V3(), spin: new VB.V3() };
      this.phase = 'replay';
      this.path = null;
      this.n = Math.floor(h.frames.length / h.stride);
      this.duration = (this.n - 1) / FPS;
      this.t = 0;
      this.apply(0);
    }
    // Slow motion for the decisive moment.
    rate() { const pt = this.h.pointT; return this.t > pt - 1.3 && this.t < pt + 0.2 ? 0.4 : 1; }
    advance(dt) { this.t = Math.min(this.duration, this.t + dt * this.rate()); this.apply(this.t); return this.t >= this.duration; }
    apply(t) {
      const h = this.h, F = h.frames, st = h.stride;
      const x = clamp(t * FPS, 0, this.n - 1), i = Math.floor(x), j = Math.min(this.n - 1, i + 1), a = x - i;
      const o1 = i * st, o2 = j * st;
      const L = (k) => (F[o1 + k] + (F[o2 + k] - F[o1 + k]) * a) / 100;
      const prev = this.ball.pos.clone();
      this.ball.pos.set(L(0), L(1), L(2));
      // Fake a little spin from the ball's travel so it rolls through the air.
      const dx = this.ball.pos.x - prev.x, dz = this.ball.pos.z - prev.z;
      this.ball.spin.set(dz * 40, 0, -dx * 40);
      this.allPlayers.forEach((p, k) => {
        const b = 3 + k * 5;
        p.pos.set(L(b), L(b + 1), L(b + 2));
        let f1 = F[o1 + b + 3] / 1000, f2 = F[o2 + b + 3] / 1000;
        let df = f2 - f1;
        if (df > Math.PI) df -= 2 * Math.PI; else if (df < -Math.PI) df += 2 * Math.PI;
        p.facing = f1 + df * a;
        p.pose = POSES[F[(a < 0.5 ? o1 : o2) + b + 4]] || 'ready';
      });
    }
  }
  HL.Replay = Replay;

  // ------------------------------------------------------------ storage (IndexedDB) for tournament replays
  const DB = 'vb-highlights', STORE = 'replays';
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
    return dbp;
  }
  const mem = new Map();
  HL.store = {
    async put(h) {
      if (!h.frames) return;
      mem.set(h.id, h);
      const d = await db();
      if (!d) return;
      try { d.transaction(STORE, 'readwrite').objectStore(STORE).put({ frames: h.frames, players: h.players, stride: h.stride, netTop: h.netTop, sgn: h.sgn }, h.id); } catch (e) { /* storage full */ }
    },
    async get(meta) {
      if (mem.has(meta.id)) return mem.get(meta.id);
      const d = await db();
      if (!d) return null;
      const rec = await new Promise((res) => {
        try {
          const q = d.transaction(STORE).objectStore(STORE).get(meta.id);
          q.onsuccess = () => res(q.result || null);
          q.onerror = () => res(null);
        } catch (e) { res(null); }
      });
      if (!rec) return null;
      const h = Object.assign({}, meta, rec);
      mem.set(meta.id, h);
      return h;
    },
    async clear() {
      mem.clear();
      const d = await db();
      if (d) try { d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch (e) { /* ignore */ }
    },
  };
})();

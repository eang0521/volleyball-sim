// The match engine: players, teams, rules, scoring and the team AI.
// Runs without any rendering so it can be tested headless in Node (see tools/headless.js).
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const { V3, gauss, clamp, rand, randRange, wrapAngle } = VB;
  const C = VB.C, PH = VB.Physics;
  const DT = C.DT, G = C.G, R = C.R;

  const newBox = () => ({ k: 0, e: 0, ta: 0, a: 0, sa: 0, se: 0, ra: 0, re: 0, dig: 0, bs: 0, ba: 0, bhe: 0 });

  // ------------------------------------------------------------------ Player
  class Player {
    constructor(data, team, idx) {
      this.data = data;
      this.team = team;
      this.idx = idx;
      this.id = team.idx * 6 + idx;
      this.name = data.name;
      this.number = data.number;
      this.skin = data.skin || '#e0ac85';
      const prof = team.profile;
      this.H = prof.heightUnit === 'in' ? data.height * 0.0254 : data.height / 100;
      // raw = rating as a 0..1 fraction of the mode's scale; s = effective ability used by the engine.
      const s = (this.s = {}), raw = (this.raw = {});
      for (const k of VB.STAT_KEYS) {
        raw[k] = clamp((data.stats[k] ?? prof.statMax / 2) / prof.statMax, 0, 1);
        const m = prof.map && prof.map[k];
        s[k] = clamp(m ? m[0] + m[1] * raw[k] : raw[k], 0.01, 0.99);
      }
      this.reach = 1.31 * this.H; // standing reach
      this.jumpH = 0.33 + 0.62 * s.jumping;
      this.tPeak = Math.sqrt((2 * this.jumpH) / G);
      this.speed = 3.3 + 3.2 * s.agility;
      this.acc = 8 + 8 * s.agility;
      this.reactT = 0.36 - 0.24 * s.reactions;
      this.box = newBox();
      this.reset();
    }
    reset() {
      this.pos = new V3();
      this.vel = new V3();
      this.facing = 0;
      this.target = { x: 0, z: 0 };
      this.arriveT = null;
      this.look = null; // world point to face
      this.air = false;
      this.jumpKind = null;
      this.pose = 'ready';
      this.poseUntil = 0;
      this.downUntil = 0;
      this.diveDir = null;
      this.reactAt = 0;
      this.perc = { id: -1, ex: 0, ez: 0 };
    }
    get fwd() { return { x: Math.sin(this.facing), z: Math.cos(this.facing) }; }
    get right() { const f = this.fwd; return { x: -f.z, z: f.x }; }
    get zone() { return this.team.order.indexOf(this) + 1; }
    get front() { const z = this.zone; return z >= 2 && z <= 4; }
    setPose(p, dur = 0.4, now = 0) { this.pose = p; this.poseUntil = now + dur; }
    handPoint() {
      const f = this.fwd, r = this.right;
      return new V3(this.pos.x + f.x * 0.3 + r.x * 0.2, this.pos.y + this.reach, this.pos.z + f.z * 0.3 + r.z * 0.2);
    }
  }

  // ------------------------------------------------------------------ Team
  class Team {
    constructor(data, idx, profile) {
      this.idx = idx;
      this.profile = profile;
      this.name = data.name;
      this.color = data.color;
      this.players = data.players.map((pd, i) => new Player(pd, this, i));
      // How well the team knows who should set and hit (casual mode); 1 = always knows.
      const aw = this.players.reduce((a, p) => a + p.raw.awareness, 0) / 6;
      this.knowledge = profile.fixedRoles ? 1 : clamp(0.1 + 0.9 * aw, 0, 1);
      this.fixedSetter = null;
      this.order = this.players.slice();
      this.sgn = idx === 0 ? -1 : 1;
      this.score = 0;
      this.sets = 0;
      this.setScores = [];
      this.ai = {};
    }
    at(zone) { return this.order[zone - 1]; }
    rotate() { this.order.push(this.order.shift()); }
    toWorld(d, l) { return { x: this.sgn * d, z: -this.sgn * l }; }
    toLocal(x, z) { return { d: x * this.sgn, l: -z * this.sgn }; }
    get fwdX() { return -this.sgn; }
    setter() { return this.fixedSetter || this.at(2); }
  }

  function moveTime(d, p) {
    if (d < 0.05) return 0;
    const tAcc = p.speed / p.acc, dAcc = 0.5 * p.acc * tAcc * tAcc;
    return d <= dAcc ? Math.sqrt((2 * d) / p.acc) : tAcc + (d - dAcc) / p.speed;
  }

  // Rotate a velocity by yaw (around y) and pitch (in its vertical plane).
  function perturb(v, yaw, pitch, speedMul) {
    const h = Math.hypot(v.x, v.z), sp = v.len() * speedMul;
    let ang = Math.atan2(v.z, v.x) + yaw;
    let el = Math.atan2(v.y, h) + pitch;
    return new V3(Math.cos(ang) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(ang) * Math.cos(el) * sp);
  }

  function topspin(dir, rate) {
    const h = Math.hypot(dir.x, dir.z) || 1;
    return new V3((dir.z / h) * rate, 0, (-dir.x / h) * rate);
  }

  // ------------------------------------------------------------------ Game
  class Game {
    constructor(teamsData, settings, mode) {
      this.settings = Object.assign({}, VB.DEFAULT_SETTINGS, settings || {});
      this.mode = VB.PROFILES[mode] ? mode : 'competitive';
      this.profile = VB.PROFILES[this.mode];
      this.teams = [new Team(teamsData[0], 0, this.profile), new Team(teamsData[1], 1, this.profile)];
      this.ball = { pos: new V3(0, 1, 0), vel: new V3(), spin: new V3(), float: null, held: null, live: false };
      this.log = [];
      this.logVersion = 0;
      this.statsVersion = 0;
      this.time = 0;
      this.newMatch();
    }

    other(t) { return this.teams[1 - t.idx]; }
    teamOnSide(x) { return this.teams.find((t) => Math.sign(x) === t.sgn) || this.teams[0]; }
    get allPlayers() { return this.teams[0].players.concat(this.teams[1].players); }

    addLog(text, team = null, kind = '') {
      this.log.push({ text, team: team ? team.idx : null, kind, score: [this.teams[0].score, this.teams[1].score], set: this.setNo });
      if (this.log.length > 600) this.log.shift();
      this.logVersion++;
    }

    // ---------------------------------------------------------- match flow
    newMatch() {
      C.netTop = this.settings.netHeight;
      for (const t of this.teams) {
        t.sets = 0; t.setScores = [];
        for (const p of t.players) p.box = newBox();
      }
      this.teams[0].sgn = -1; this.teams[1].sgn = 1;
      this.setNo = 1;
      this.firstServer = rand() < 0.5 ? 0 : 1;
      this.winner = null;
      this.log = [];
      this.rallies = 0;
      this.addLog(`Match start — ${this.teams[0].name} vs ${this.teams[1].name}`, null, 'header');
      this.startSet();
    }

    get setsToWin() { return Math.ceil(this.settings.bestOf / 2); }
    get isDecidingSet() { return this.teams[0].sets === this.setsToWin - 1 && this.teams[1].sets === this.setsToWin - 1 && this.settings.bestOf > 1; }
    get setTarget() { return this.isDecidingSet ? this.settings.finalSetPoints : this.settings.pointsPerSet; }

    startSet() {
      for (const t of this.teams) {
        t.score = 0;
        t.order = t.players.slice();
        this.pickSetter(t);
      }
      if (this.settings.switchSides && this.setNo > 1) {
        const s = this.setNo % 2 === 1 ? -1 : 1;
        this.teams[0].sgn = s; this.teams[1].sgn = -s;
      }
      this.serving = this.isDecidingSet ? (rand() < 0.5 ? 0 : 1) : (this.firstServer + this.setNo - 1) % 2;
      this.addLog(`Set ${this.setNo} — ${this.teams[this.serving].name} serves first (to ${this.setTarget})`, null, 'header');
      // Place players at formation instantly.
      this.preServe(true);
    }

    preServe(teleport = false) {
      this.phase = 'preserve';
      this.phaseStart = this.time;
      this.touches = [0, 0];
      this.lastTouch = null;
      this.contacts = [];
      this.pendingDig = null;
      this.pendingIllegal = null;
      this.lastBlock = null;
      this.rallyStart = this.time;
      this.path = null;
      this.pathId = (this.pathId || 0) + 1;
      for (const t of this.teams) {
        t.ai = { plan: null, hit: null, setInfo: null, blockers: [], blockRead: false, nextPlan: 0 };
        for (const p of t.players) {
          const e = (1 - p.s.awareness) * (t.profile.fixedRoles ? 0.6 : 0.4);
          p.formJit = { d: gauss() * e, l: gauss() * e, serveL: 2.4 - rand() * 1.5 };
        }
        // Casual teams occasionally mix up who stands where (a likely overlap).
        t.swapMistake = !t.profile.fixedRoles && rand() < (1 - t.knowledge) * 0.02 ? 1 + Math.floor(rand() * 5) : 0;
      }
      const server = this.teams[this.serving].at(1);
      this.serve = { player: server, type: this.chooseServeType(server), stage: 'walk' };
      const b = this.ball;
      b.held = server; b.live = false; b.float = null; b.vel.set(0, 0, 0); b.spin.set(0, 0, 0);
      for (const t of this.teams) {
        for (const p of t.players) {
          p.air = false; p.pos.y = 0; p.vel.set(0, 0, 0); p.downUntil = 0; p.arriveT = null; p.jumpKind = null;
          p.pose = 'idle';
        }
        this.formation(t);
        if (teleport) {
          for (const p of t.players) {
            p.pos.x = p.target.x; p.pos.z = p.target.z;
            p.facing = t.fwdX > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
        }
      }
      this.updateHeldBall();
    }

    // Casual teams decide who sets each rotation; whether they pick their real best setter depends on awareness.
    pickSetter(t) {
      if (t.profile.fixedRoles) { t.fixedSetter = null; return; }
      const score = (p) => p.raw.setting * 1.5 + p.raw.awareness * 0.4;
      const r = rand();
      if (this.settings.frontRowSetter) {
        // Setter always comes from the front row, usually middle front or right front.
        const front = [t.at(2), t.at(3), t.at(4)];
        const habit = [0.5, 0.35, 0.15]; // RF, MF, LF
        if (r < t.knowledge) {
          // Aware teams pick the best setter up front (with a slight lean away from left front).
          t.fixedSetter = front.reduce((a, p, i) => (score(p) - (i === 2 ? 0.1 : 0) > score(a) - (front.indexOf(a) === 2 ? 0.1 : 0) ? p : a));
        } else {
          let x = rand(), i = 0;
          while (i < 2 && x > habit[i]) x -= habit[i++];
          t.fixedSetter = front[i];
        }
        return;
      }
      const best = t.players.reduce((a, p) => (score(p) > score(a) ? p : a));
      if (r < t.knowledge) t.fixedSetter = best;
      else if (r < t.knowledge + (1 - t.knowledge) * 0.6) t.fixedSetter = t.at(2); // habit: right front sets
      else t.fixedSetter = t.players[Math.floor(rand() * 6)];
    }

    chooseServeType(p) {
      if (!p.team.profile.fixedRoles && p.raw.serving <= 0.35 && rand() < 0.85 - p.raw.serving) return 'underhand';
      const s = p.s.serving;
      const r = rand();
      if (s > 0.55 && r < (s - 0.45) * 1.3) return 'topspin';
      const casual = !p.team.profile.fixedRoles;
      if (casual ? p.raw.serving >= 0.75 && r < 0.4 : s > 0.35 && r < 0.75) return 'jumpfloat';
      return 'float';
    }

    // Serve-time formation (serving team spread out, receiving team in a W).
    formation(t) {
      const serving = t.idx === this.serving;
      const spots = serving
        ? { 1: null, 2: [1.3, 2.6], 3: [1.3, 0], 4: [1.3, -2.6], 5: [5.2, -3.0], 6: [5.4, -0.8] }
        : { 1: [6.8, 2.4], 2: [1.1, 2.0], 3: [4.2, 0.3], 4: [4.6, -2.8], 5: [6.8, -2.4], 6: [7.6, 0] };
      // Casual front-row setter waits at the net on serve receive; right front passes instead if not setting.
      const sz = t.fixedSetter ? t.fixedSetter.zone : 0;
      if (!serving && sz >= 3 && sz <= 4) {
        spots[2] = [4.4, 2.6];
        spots[sz] = [1.1, sz === 3 ? 0.6 : -1.8];
      }
      if (t.swapMistake && this.phase !== 'rally') {
        // Two neighbouring players stand in each other's spots.
        const a = t.swapMistake, b = a === 5 ? 6 : a + 1;
        if (spots[a] && spots[b]) [spots[a], spots[b]] = [spots[b], spots[a]];
      }
      for (let z = 1; z <= 6; z++) {
        const p = t.at(z);
        const sp = spots[z];
        const j = p.formJit || { d: 0, l: 0, serveL: 1.8 };
        if (!sp) {
          const d = this.serve.type === 'topspin' ? 11.4 : this.serve.type === 'jumpfloat' ? 10.4 : this.serve.type === 'underhand' ? 9.4 : 9.7;
          p.target = t.toWorld(d, j.serveL);
        } else p.target = t.toWorld(sp[0] + j.d, sp[1] + j.l);
        p.arriveT = null;
      }
    }

    // ---------------------------------------------------------- main update
    update(dt) {
      this.time += dt;
      const ph = this.phase;
      if (ph === 'preserve') this.updatePreServe();
      else if (ph === 'serve') this.updateServe();
      else if (ph === 'rally') this.updateRally();
      else if (ph === 'dead') this.updateDead();
      else if (ph === 'setbreak') {
        if (this.time > this.phaseStart + this.settings.setBreak) { this.setNo++; this.startSet(); }
        this.moveAll();
      } else if (ph === 'over') this.moveAll();

      if (ph !== 'rally' && ph !== 'serve') this.stepBallLoose();
      for (const p of this.allPlayers) this.animatePose(p);
    }

    updateHeldBall() {
      const b = this.ball, p = b.held;
      if (!p) return;
      const f = p.fwd;
      b.pos.set(p.pos.x + f.x * 0.25, p.pos.y + p.H * 0.62, p.pos.z + f.z * 0.25);
      b.vel.set(0, 0, 0);
    }

    updatePreServe() {
      for (const t of this.teams) for (const p of t.players) {
        p.look = { x: 0, z: p.pos.z * 0.5 };
        if (p === this.serve.player) p.look = { x: 0, z: p.pos.z };
      }
      this.moveAll();
      this.updateHeldBall();
      const sv = this.serve.player;
      const ready = sv.pos.distXZ(new V3(sv.target.x, 0, sv.target.z)) < 0.15;
      const el = this.time - this.phaseStart;
      if ((ready && el > this.settings.serveDelay) || el > this.settings.serveDelay + 3) this.tossServe();
    }

    tossServe() {
      const sv = this.serve.player, t = sv.team, b = this.ball;
      const type = this.serve.type;
      b.held = null; b.live = true;
      this.phase = 'serve';
      this.phaseStart = this.time;
      const fx = t.fwdX;
      sv.facing = fx > 0 ? Math.PI / 2 : -Math.PI / 2;
      const f = sv.fwd;
      b.pos.set(sv.pos.x + f.x * 0.3, sv.H * 0.8, sv.pos.z + f.z * 0.3);
      b.spin.set(gauss() * 2, gauss() * 2, gauss() * 2);
      sv.setPose(type === 'underhand' ? 'ready' : 'toss', 0.6, this.time);
      if (type === 'underhand') {
        b.pos.set(sv.pos.x + f.x * 0.4, sv.H * 0.5, sv.pos.z + f.z * 0.4);
        b.vel.set(fx * 0.1, 1.3, 0);
        this.serve.contactH = sv.H * 0.42;
        this.serve.stage = 'float';
      } else if (type === 'float') {
        b.vel.set(fx * 0.25, 4.0, 0);
        this.serve.contactH = sv.reach * 0.98;
        this.serve.stage = 'float';
      } else {
        const fwdV = type === 'topspin' ? 1.3 : 0.8;
        const up = type === 'topspin' ? 6.3 : 5.3;
        b.vel.set(fx * fwdV, up, 0);
        const drift = type === 'topspin' ? 1.2 : 0.6;
        const ch = sv.reach + sv.jumpH * 0.9;
        const path = PH.predict(b.pos, b.vel, b.spin, this.time, 3);
        let ic = -1;
        for (let i = 1; i < path.n; i++) if (path.vy[i] < 0 && path.y[i] <= ch) { ic = i; break; }
        if (ic < 0) ic = path.n - 1;
        const tc = this.time + ic * DT;
        const r = sv.right;
        const bx = path.x[ic], bz = path.z[ic];
        const take = {
          x: bx - fx * (0.3 + drift * sv.tPeak) - r.x * 0.2,
          z: bz - r.z * 0.2,
        };
        // Keep take-off behind the end line.
        if (Math.abs(take.x) < 9.05) take.x = Math.sign(take.x) * 9.05;
        this.serve.stage = 'jump';
        this.serve.take = take;
        this.serve.takeT = tc - sv.tPeak + gauss() * (1.05 - sv.s.serving) * 0.04;
        this.serve.drift = drift;
        this.serve.contactH = ch;
        sv.target = { x: take.x, z: take.z };
        sv.arriveT = this.serve.takeT;
      }
    }

    updateServe() {
      const sv = this.serve.player, b = this.ball;
      for (const t of this.teams) for (const p of t.players) if (p !== sv) p.look = { x: b.pos.x, z: b.pos.z };
      if (this.serve.stage === 'jump' && !sv.air && this.time >= this.serve.takeT) {
        this.jump(sv, this.serve.drift, 'serve');
      }
      this.moveAll();
      this.stepBallRaw();
      // Contact check
      let hit = false;
      if (this.serve.stage === 'float') {
        const hp = sv.handPoint();
        hp.y = sv.pos.y + this.serve.contactH;
        if (b.vel.y < 0 && b.pos.y <= hp.y + 0.05 && b.pos.distXZ(hp) < 0.6) hit = true;
      } else if (sv.air) {
        const hp = sv.handPoint();
        if (b.pos.distXZ(hp) < 0.6 && b.pos.y <= hp.y + 0.1 && b.pos.y >= hp.y - 0.6) hit = true;
      }
      if (hit) {
        if (this.callOverlaps()) return;
        this.doServe(sv);
        return;
      }
      if (b.pos.y < 0.5 || this.time - this.phaseStart > 3) {
        // Dropped toss — counts as a service error.
        this.pointTo(this.other(sv.team), 'serveError', sv, `${this.pn(sv)} mishandles the toss`);
      }
    }

    // Rotational order at the moment of the serve (judged by feet; the server is exempt).
    findOverlap(t) {
      const serving = t.idx === this.serving;
      const L = (z) => { const p = t.at(z); return t.toLocal(p.pos.x, p.pos.z); };
      for (const [f, b] of [[4, 5], [3, 6], [2, 1]]) {
        if (serving && b === 1) continue;
        if (L(f).d >= L(b).d) return [f, b];
      }
      for (const [a, b] of [[4, 3], [3, 2], [5, 6], [6, 1]]) {
        if (serving && (a === 1 || b === 1)) continue;
        if (L(a).l >= L(b).l) return [a, b];
      }
      return null;
    }

    callOverlaps() {
      if (!this.profile.fixedRoles) return false; // casual games don't call overlap
      const faults = this.teams.map((t) => this.findOverlap(t));
      if (!faults[0] && !faults[1]) return false;
      if (faults[0] && faults[1]) {
        this.addLog('Both teams out of rotation — replay', null, 'info');
        this.phase = 'dead'; this.phaseStart = this.time; this.replay = true; this.ball.live = false;
        return true;
      }
      const t = this.teams[faults[0] ? 0 : 1], [a, b] = faults[t.idx];
      const pa = t.at(a), pb = t.at(b);
      this.pointTo(this.other(t), 'fault', null, `Overlap — ${t.name} out of rotation (${this.pn(pa)} / ${this.pn(pb)})`);
      return true;
    }

    // Solid bodies: a ball that hits someone who isn't playing it deflects and counts as a touch.
    collideBodies() {
      const b = this.ball, now = this.time, lt = this.lastTouch;
      for (const t of this.teams) for (const p of t.players) {
        if (lt && lt.player === p && now - lt.time < 0.3) continue;
        const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
        if (Math.abs(dx) > 0.8 || Math.abs(dz) > 0.8) continue;
        const ly = b.pos.y - p.pos.y;
        if (ly > p.H + R || ly < -R) continue;
        const cf = Math.cos(p.facing), sf = Math.sin(p.facing);
        const lx = dx * cf - dz * sf, lz = dx * sf + dz * cf; // player's local frame (z = forward)
        const hx = 0.125 * p.H, hz = 0.07 * p.H, top = 0.82 * p.H;
        let cx = clamp(lx, -hx, hx), cy = clamp(ly, 0, top), cz = clamp(lz, -hz, hz);
        let nx = lx - cx, ny = ly - cy, nz = lz - cz, d = Math.hypot(nx, ny, nz);
        let hit = d < R;
        if (!hit) {
          // Head
          const hr = 0.065 * p.H, hy = top + 0.03 * p.H + hr;
          nx = lx; ny = ly - hy; nz = lz; d = Math.hypot(nx, ny, nz);
          if (d < R + hr) { hit = true; cx = 0; cy = hy; cz = 0; const k = hr / (d || 1); cx = nx * k; cy = hy + ny * k; cz = nz * k; nx = lx - cx; ny = ly - cy; nz = lz - cz; d = Math.hypot(nx, ny, nz); }
        }
        if (!hit) continue;
        if (d < 1e-6) { nx = -lx || 0; ny = 0.5; nz = -lz || 1; d = Math.hypot(nx, ny, nz); }
        nx /= d; ny /= d; nz /= d;
        // Back to world
        const wx = nx * cf + nz * sf, wz = -nx * sf + nz * cf, wy = ny;
        const rvx = b.vel.x - p.vel.x, rvy = b.vel.y - p.vel.y, rvz = b.vel.z - p.vel.z;
        const vn = rvx * wx + rvy * wy + rvz * wz;
        if (vn >= 0) continue;
        b.vel.x -= 1.35 * vn * wx; b.vel.y -= 1.35 * vn * wy; b.vel.z -= 1.35 * vn * wz;
        b.vel.scale(0.8);
        const wcx = p.pos.x + cx * cf + cz * sf, wcz = p.pos.z - cx * sf + cz * cf;
        b.pos.set(wcx + wx * (R + 0.01), p.pos.y + cy + wy * (R + 0.01), wcz + wz * (R + 0.01));
        b.spin.set(gauss() * 6, gauss() * 6, gauss() * 6);
        b.float = null;
        this.bodyTouch(p);
        return true;
      }
      return false;
    }

    bodyTouch(p) {
      const t = p.team, lt = this.lastTouch;
      if (lt && lt.kind === 'serve' && lt.team === t) return this.fault(lt, 'fault', `serve hits teammate ${this.pn(p)}`);
      if (lt && lt.player === p && lt.kind !== 'block') return this.pointTo(this.other(t), 'handling', p, `Double contact — ball hits ${this.pn(p)} again`);
      const touchesAfter = (lt && lt.team === t ? this.touches[t.idx] : 0) + 1;
      if (touchesAfter > 3) return this.pointTo(this.other(t), 'handling', p, `Four hits — ball touches ${this.pn(p)}`);
      this.addLog(`Ball deflects off ${this.pn(p)}`, t, 'info');
      this.registerContact(p, 'body');
      this.onBallEvent(0.1);
    }

    // Referee's call on an overhead contact: lift (carry) or double contact.
    handlingFault(p, info, touchNo, ballY) {
      const strict = this.settings.handlingCalls;
      if (!strict) return null;
      const miss = (1.05 - p.s.setting) ** 2;
      const low = ballY < p.H * 0.95;
      const diff = 1 + Math.max(0, info.vin - 6) * 0.1 + info.reach * 0.8 + (info.dive ? 1 : 0) + (low ? 0.4 : 0);
      const casual = !p.team.profile.fixedRoles; // casual games don't call lifts
      const pLift = casual ? 0 : 0.012 * miss * diff * (info.reach > 0.6 || low ? 2 : 1) * strict;
      const pDouble = touchNo === 1 ? 0 : 0.03 * miss * diff * strict; // doubles are legal on the first team contact
      const r = rand();
      if (r < pLift) return 'lift';
      if (r < pLift + pDouble) return 'double';
      return null;
    }

    updateRally() {
      const now = this.time;
      for (const t of this.teams) this.updateAI(t);
      this.moveAll();
      this.stepBall();
      if (this.phase !== 'rally') return;
      for (const t of this.teams) {
        if (this.checkBlock(t)) break;
        if (this.checkHit(t)) break;
        if (this.checkPlanContact(t)) break;
      }
      if (this.phase !== 'rally') return;
      this.collideBodies();
      if (this.phase !== 'rally') return;
      this.checkPlayerFaults();
      if (now - this.rallyStart > 90 && this.phase === 'rally') {
        this.addLog('Rally stopped — replay', null, 'info');
        this.phase = 'dead'; this.phaseStart = now; this.replay = true; this.ball.live = false;
      }
    }

    updateDead() {
      for (const t of this.teams) for (const p of t.players) {
        if (p.air) continue;
        p.look = { x: this.ball.pos.x, z: this.ball.pos.z };
        if (this.time > this.phaseStart + 0.6 && !p.airborneFaultHold) {
          // Drift back toward base spots casually.
          p.arriveT = null;
        }
      }
      if (this.time > this.phaseStart + 0.8) {
        for (const t of this.teams) this.formation(t);
      }
      this.moveAll();
      if (this.time > this.phaseStart + this.settings.pointDelay) {
        if (this.pendingSetEnd) {
          const done = this.pendingSetEnd;
          this.pendingSetEnd = null;
          if (done === 'match') { this.phase = 'over'; this.phaseStart = this.time; return; }
          this.phase = 'setbreak'; this.phaseStart = this.time;
          return;
        }
        this.replay = false;
        this.preServe();
      }
    }

    // ---------------------------------------------------------- ball
    stepBallRaw() {
      const b = this.ball;
      const s = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z];
      let ax = 0, ay = 0, az = 0;
      if (b.float) {
        const sp = b.vel.len();
        const f = b.float, k = clamp((sp - 6) / 8, 0, 1) * f.amp;
        const tt = this.time - f.t0;
        ax = k * 0.3 * Math.sin(f.w2 * tt + f.p2);
        ay = k * 0.5 * Math.sin(f.w2 * tt + f.p1);
        az = k * Math.sin(f.w1 * tt + f.p1);
      }
      PH.stepArr(s, b.spin, DT, ax, ay, az);
      b.pos.set(s[0], s[1], s[2]);
      b.vel.set(s[3], s[4], s[5]);
    }

    // Ball after the rally is over: bounce around the gym.
    stepBallLoose() {
      const b = this.ball;
      if (b.held) { this.updateHeldBall(); return; }
      const prevX = b.pos.x;
      this.stepBallRaw();
      PH.collideNet(b, prevX);
      if (b.pos.y < R) {
        b.pos.y = R;
        if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.55;
        b.vel.x *= 0.985; b.vel.z *= 0.985;
        b.spin.scale(0.98);
        if (Math.abs(b.vel.y) < 0.3) b.vel.y = 0;
      }
      if (Math.abs(b.pos.x) > 16) { b.pos.x = Math.sign(b.pos.x) * 16; b.vel.x *= -0.4; }
      if (Math.abs(b.pos.z) > 11) { b.pos.z = Math.sign(b.pos.z) * 11; b.vel.z *= -0.4; }
    }

    stepBall() {
      const b = this.ball;
      const prevX = b.pos.x, prevY = b.pos.y, prevZ = b.pos.z;
      this.stepBallRaw();
      const ev = PH.collideNet(b, prevX);
      const lt = this.lastTouch;
      if (ev === 'antenna') {
        return this.fault(lt, 'antenna', `ball hits the antenna`);
      }
      if (ev === 'netOutside') {
        return this.fault(lt, 'out', `ball hits the net outside the antenna`);
      }
      if (ev === 'net' || ev === 'tape') {
        if (lt && lt.kind === 'serve' && ev === 'net' && !this.netHitLogged) {
          this.netHitLogged = true;
        }
        this.onBallEvent(0.08);
      }
      // Crossing the net plane
      if (!ev && Math.sign(prevX) !== Math.sign(b.pos.x) && prevX !== 0) {
        const f = prevX / (prevX - b.pos.x);
        const cy = prevY + (b.pos.y - prevY) * f;
        const cz = prevZ + (b.pos.z - prevZ) * f;
        if (Math.abs(cz) > C.ANTENNA_Z) return this.fault(lt, 'out', `ball crosses outside the antenna`);
        if (cy < C.netTop - C.NET_DEPTH) return this.fault(lt, 'out', `ball passes under the net`);
        if (cy > C.netTop + C.ANTENNA_H + 0.5 && Math.abs(cz) > C.HALF_W - 0.3) {
          // Over the antenna extension – outside crossing space.
          return this.fault(lt, 'out', `ball crosses above the antenna`);
        }
        if (this.pendingIllegal) return this.callIllegalAttack();
        for (const t of this.teams) t.ai.nextPlan = 0;
      }
      // Floor
      if (b.pos.y <= R) {
        b.pos.y = R;
        const x = b.pos.x, z = b.pos.z;
        const tol = R * 0.5;
        const inCourt = Math.abs(x) <= C.HALF_L + tol && Math.abs(z) <= C.HALF_W + tol;
        b.vel.y = -b.vel.y * 0.55; b.vel.x *= 0.8; b.vel.z *= 0.8;
        if (inCourt) {
          const loser = this.teamOnSide(x);
          this.pointTo(this.other(loser), 'in', null, null, { x, z });
        } else {
          if (!lt) return this.pointTo(this.teams[1 - this.serving], 'out');
          this.fault(lt, 'out', 'out', { x, z });
        }
      }
    }

    // Recompute the predicted ball path after any event and schedule replans.
    onBallEvent(extraReact = 0) {
      const b = this.ball;
      this.path = PH.predict(b.pos, b.vel, b.spin, this.time, 6);
      this.pathId++;
      for (const t of this.teams) {
        t.ai.nextPlan = 0;
        if (extraReact) for (const p of t.players) p.reactAt = Math.max(p.reactAt, this.time + extraReact + p.reactT * 0.5);
      }
    }

    // ---------------------------------------------------------- movement
    moveAll() {
      const now = this.time;
      for (const t of this.teams) for (const p of t.players) this.movePlayer(p, now);
      // Separation between players of the same team.
      for (const t of this.teams) {
        const ps = t.players;
        for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
          const a = ps[i], c = ps[j];
          if (a.air || c.air) continue;
          const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.5 && d > 1e-4) {
            const push = (0.5 - d) * 0.5;
            a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
            c.pos.x += (dx / d) * push; c.pos.z += (dz / d) * push;
          }
        }
      }
    }

    movePlayer(p, now) {
      const t = p.team;
      if (p.air) {
        p.vel.y -= G * DT;
        p.pos.addScaled(p.vel, DT);
        if (p.pos.y <= 0 && p.vel.y < 0) this.land(p);
        return;
      }
      if (now < p.downUntil) {
        p.vel.scale(0.9);
        p.pos.addScaled(p.vel, DT);
        return;
      }
      const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      let sp = 0;
      if (d > 0.02) {
        if (p.arriveT != null) sp = Math.min(p.speed, d / Math.max(p.arriveT - now, 0.04));
        else sp = Math.min(p.speed, Math.sqrt(2 * p.acc * 0.8 * d));
      }
      const wx = d > 0.02 ? (dx / d) * sp : 0, wz = d > 0.02 ? (dz / d) * sp : 0;
      let ex = wx - p.vel.x, ez = wz - p.vel.z;
      const el = Math.hypot(ex, ez), maxDv = p.acc * DT;
      if (el > maxDv) { ex *= maxDv / el; ez *= maxDv / el; }
      p.vel.x += ex; p.vel.z += ez; p.vel.y = 0;
      p.pos.x += p.vel.x * DT; p.pos.z += p.vel.z * DT;
      // Stay on own side of the centre line and inside the gym.
      if (p.pos.x * t.sgn < 0.15) p.pos.x = t.sgn * 0.15;
      p.pos.x = clamp(p.pos.x, -15, 15);
      p.pos.z = clamp(p.pos.z, -9.5, 9.5);
      // Facing
      let want = p.facing;
      if (p.look) want = Math.atan2(p.look.x - p.pos.x, p.look.z - p.pos.z);
      const da = wrapAngle(want - p.facing);
      p.facing = wrapAngle(p.facing + clamp(da, -9 * DT, 9 * DT));
    }

    jump(p, drift, kind) {
      p.air = true;
      p.jumpKind = kind;
      p.jumpT = this.time;
      p.takeoff = { x: p.pos.x, z: p.pos.z };
      const f = p.fwd;
      // Block jumps are standing jumps (lower than an approach jump).
      const h = kind === 'block' ? p.jumpH * VB.BLOCK_JUMP : p.jumpH;
      p.vel.set(f.x * drift, Math.sqrt(2 * G * h), f.z * drift);
      p.setPose(kind === 'block' ? 'block' : 'spikeWind', 2, this.time);
    }

    land(p) {
      p.pos.y = 0;
      p.vel.x *= 0.3; p.vel.z *= 0.3; p.vel.y = 0;
      p.air = false;
      p.jumpKind = null;
      if (p.pose === 'block' || p.pose === 'spikeWind' || p.pose === 'spike') p.setPose('ready', 0.1, this.time);
      p.downUntil = Math.max(p.downUntil, this.time + 0.2);
      const t = p.team;
      if ((this.phase === 'rally' || this.phase === 'serve') && p.pos.x * t.sgn < -0.1) {
        this.pointTo(this.other(t), 'fault', p, `${this.pn(p)} crosses the centre line`, null, p);
      }
      if (p.pos.x * t.sgn < 0.15) p.pos.x = t.sgn * 0.15;
    }

    animatePose(p) {
      if (this.time > p.poseUntil && !p.air) {
        const live = this.phase === 'rally' || this.phase === 'serve';
        if (this.time < p.downUntil && p.pose === 'dive') return;
        p.pose = live ? 'ready' : this.phase === 'dead' && this.lastWinner === p.team && !this.replay ? 'celebrate' : 'idle';
      }
    }

    // ---------------------------------------------------------- AI
    updateAI(t) {
      const now = this.time, ai = t.ai;
      if (now >= ai.nextPlan) {
        ai.nextPlan = now + 0.05;
        this.planTouch(t);
      }
      this.positionTeam(t);
      // Hitter approach & jump
      const h = ai.hit;
      if (h && !h.jumped && now >= h.takeT && !h.player.air) {
        h.jumped = true;
        this.jump(h.player, h.drift, 'hit');
        this.onHitterJump(t, h);
      }
      // Blockers jump
      for (const bl of ai.blockers) {
        if (bl.jumpAt != null && !bl.jumped && now >= bl.jumpAt && !bl.player.air && now >= bl.player.downUntil - 0.15) {
          bl.jumped = true;
          bl.player.facing = t.fwdX > 0 ? Math.PI / 2 : -Math.PI / 2;
          this.jump(bl.player, 0, 'block');
        }
      }
    }

    canTeamPlay(t) {
      if (!this.ball.live) return false;
      const lt = this.lastTouch;
      if (!lt) return false;
      if (lt.team === t) {
        if (lt.kind === 'serve') return false;
        if (lt.kind === 'block') return true;
        return this.touches[t.idx] < 3;
      }
      return true;
    }

    touchNo(t) {
      const lt = this.lastTouch;
      return lt && lt.team === t ? this.touches[t.idx] + 1 : 1;
    }

    planTouch(t) {
      const ai = t.ai, now = this.time;
      if (!this.canTeamPlay(t) || !this.path) { ai.plan = null; return; }
      const path = this.path;
      // Is the ball going to be on our side at some point?
      let onOurSide = false;
      const i0 = Math.max(0, Math.floor((now - path.t0) / DT));
      for (let i = i0; i < path.n; i += 4) if (path.x[i] * t.sgn > 0.15) { onOurSide = true; break; }
      if (!onOurSide) { ai.plan = null; return; }
      const touchNo = this.touchNo(t);

      // Attack plan after our set.
      if (touchNo === 3 && ai.setInfo) {
        if (!ai.hit || ai.hit.pathId !== this.pathId) {
          const h = this.planHit(t, ai.setInfo.hitter);
          if (h) { ai.hit = h; ai.plan = null; return; }
          if (ai.hit && ai.hit.jumped) { ai.plan = null; return; }
          ai.hit = null;
          ai.setInfo = null;
        } else { ai.plan = null; return; }
      }

      // Committed: don't second-guess a plan that is about to happen.
      if (ai.plan && ai.plan.pathId === this.pathId && ai.plan.t - now < 0.3 && ai.plan.touchNo === touchNo) return;
      const purpose = touchNo === 1 ? 'pass' : touchNo === 2 ? 'set' : 'free';
      const lt = this.lastTouch;
      const fromOpp = lt && lt.team !== t;
      let best = null, cur = null;
      for (const p of t.players) {
        if (p.air || now < p.downUntil - 0.1) continue;
        if (lt && lt.player === p && lt.kind !== 'block') continue; // no double contact
        if (now < p.reactAt) {
          // Still reacting: can only keep an existing assignment.
          if (!(ai.plan && ai.plan.player === p)) continue;
        }
        // Judge balls heading out: let them go.
        if (fromOpp && path.land) {
          if (p.perc.id !== this.pathId) {
            const e = (1 - p.s.awareness) * 0.9;
            p.perc = { id: this.pathId, ex: gauss() * e, ez: gauss() * e };
          }
          const lx = path.land.x + p.perc.ex, lz = path.land.z + p.perc.ez;
          const out = Math.abs(lx) > C.HALF_L + 0.05 || Math.abs(lz) > C.HALF_W + 0.05;
          const trulyOutOnOurSide = path.land.x * t.sgn > 0;
          if (out && trulyOutOnOurSide) continue;
        }
        const opt = this.findIntercept(p, t, purpose, path);
        if (!opt) continue;
        let sc = opt.score;
        const s = p.s;
        if (purpose === 'pass') {
          sc += s.passing * 1.0;
          if (p === t.setter() && touchNo === 1) sc -= 0.9;
        } else if (purpose === 'set') {
          sc += s.setting * 1.2;
          if (p === t.setter()) sc += 1.6;
        } else sc += (s.passing + s.setting) * 0.5;
        opt.score = sc;
        opt.player = p;
        if (ai.plan && ai.plan.player === p) cur = opt;
        if (!best || sc > best.score) best = opt;
      }
      if (!best) { ai.plan = null; return; }
      if (cur && cur.score > best.score - 0.6) best = cur;
      best.purpose = purpose;
      best.touchNo = touchNo;
      best.pathId = this.pathId;
      ai.plan = best;
    }

    // Best contact option for player p on the current path.
    findIntercept(p, t, purpose, path) {
      const now = this.time, sg = t.sgn, H = p.H;
      const overLo = H * 0.98, overHi = H * 1.18, overT = H * 1.06;
      const bumpLo = 0.4, bumpHi = 1.25, bumpT = 0.85;
      const react = Math.max(0, p.reactAt - now);
      let best = null;
      const i0 = Math.max(0, Math.ceil((now + 0.05 - path.t0) / DT));
      for (let i = i0; i < path.n; i += 2) {
        const x = path.x[i];
        if (x * sg < 0.2) continue;
        const y = path.y[i];
        let type = null;
        if (y >= overLo && y <= overHi) type = 'over';
        else if (y >= bumpLo && y <= bumpHi) type = 'bump';
        else if (y >= 0.08 && y < bumpLo) type = 'low';
        else continue;
        const tt = path.t0 + i * DT;
        const vx = path.vx[i], vz = path.vz[i], hv = Math.hypot(vx, vz);
        const off = type === 'over' ? 0.12 : 0.4;
        let sx, sz;
        if (hv > 1.5) { sx = path.x[i] + (vx / hv) * off; sz = path.z[i] + (vz / hv) * off; }
        else { sx = path.x[i] + sg * off; sz = path.z[i]; }
        if (sx * sg < 0.3) sx = sg * 0.3;
        const dist = Math.hypot(sx - p.pos.x, sz - p.pos.z);
        const tAvail = tt - now - react;
        const need = moveTime(dist, p) + 0.06;
        let slack = tAvail - need;
        let dive = false;
        if (slack < 0 || type === 'low') {
          if (type === 'over') continue;
          const needDive = moveTime(Math.max(0, dist - t.profile.diveReach), p) + 0.1;
          if (tAvail - needDive < 0) continue;
          dive = true;
          slack = tAvail - needDive;
        }
        const speed = Math.hypot(vx, path.vy[i], vz);
        let sc = Math.min(slack, 0.6) * 1.2;
        if (type === 'over') {
          sc -= Math.abs(y - overT) * 1.2;
          if (purpose === 'set') sc += t.profile.fixedRoles ? 1.0 : 1.8 * p.s.setting - 0.1;
          else if (purpose === 'free') sc += 0.2;
          else if (speed < 9) sc += 0.3;
          else sc -= 0.6;
        } else {
          sc -= Math.abs(y - bumpT) * 1.0;
          if (purpose === 'pass' && speed >= 9) sc += 0.3;
        }
        if (dive) sc -= 1.4;
        if (!best || sc > best.score) {
          best = { i, t: tt, type: dive ? 'dive' : type, dive, stand: { x: sx, z: sz }, score: sc, y };
        }
      }
      return best;
    }

    // Plan the hitter's approach and jump for the ball currently set.
    planHit(t, hitter) {
      if (!hitter || hitter.air && this.ai_hitJumped(t)) return t.ai.hit;
      const now = this.time, path = this.path, sg = t.sgn;
      if (now < hitter.downUntil - 0.2) return null;
      const hc = hitter.reach + hitter.jumpH * 0.95;
      const tpk = hitter.tPeak;
      const fx = t.fwdX;
      const r = { x: 0, z: -sg }; // right-hand direction when facing the net
      const drift0 = 0.9;
      const timingErr = gauss() * (1.08 - (hitter.s.hitting + hitter.s.awareness) / 2) * 0.07;
      const minTake = hitter.front ? 0.2 : rand() < 0.7 + 0.3 * hitter.s.awareness ? C.ATTACK_LINE + 0.1 : 2.2;
      let best = null;
      const i0 = Math.max(0, Math.ceil((now + 0.05 - path.t0) / DT));
      for (let i = i0; i < path.n; i += 2) {
        const y = path.y[i];
        if (path.vy[i] > 0.5) continue;
        if (y > hc + 0.03 || y < hc - 0.7) continue;
        const bx = path.x[i], bz = path.z[i];
        if (bx * sg < 0.2) continue;
        const tt = path.t0 + i * DT;
        const bodyX = bx - fx * 0.3, bodyZ = bz - r.z * 0.2;
        let drift = drift0;
        // Keep landing away from the net if the hitter is aware of it.
        const distNet = Math.abs(bodyX);
        const safe = (distNet - 0.4) / tpk; // drift so that landing stays ~0.4m off the net
        if (rand() < 0.4 + hitter.s.awareness * 0.6) drift = clamp(Math.min(drift, safe), 0, drift0);
        const take = { x: bodyX - fx * drift * tpk, z: bodyZ };
        if (take.x * sg < minTake) continue;
        const takeT = tt - tpk + timingErr;
        const dist = Math.hypot(take.x - hitter.pos.x, take.z - hitter.pos.z);
        const need = moveTime(dist, hitter) * 0.92;
        if (takeT - now < need) continue;
        const sc = y - Math.abs(tt - now - 0.9) * 0.05;
        if (!best || sc > best.sc) best = { sc, i, t: tt, take, takeT, drift, contactY: y };
      }
      if (!best) return null;
      return { player: hitter, take: best.take, takeT: best.takeT, t: best.t, drift: best.drift, jumped: false, pathId: this.pathId };
    }
    ai_hitJumped(t) { return t.ai.hit && t.ai.hit.jumped; }

    onHitterJump(t, h) {
      const opp = this.other(t);
      for (const bl of opp.ai.blockers) {
        const p = bl.player;
        const tpk = p.tPeak * Math.sqrt(VB.BLOCK_JUMP);
        bl.jumpAt = this.time + (h.player.tPeak - tpk) + 0.07 + gauss() * (1.06 - p.s.blocking) * 0.1 + Math.max(0, p.reactT - 0.22) * 0.5;
      }
    }

    // Where everybody who isn't playing the ball should be.
    positionTeam(t) {
      const now = this.time, ai = t.ai, opp = this.other(t);
      const lt = this.lastTouch;
      const b = this.ball;
      const busy = new Set();
      const face = (p, x, z) => { p.look = { x, z }; };
      const go = (p, d, l, arrive = null) => {
        if (now < p.reactAt || busy.has(p) || p.air) return;
        const w = t.toWorld(d, l);
        p.target = w; p.arriveT = arrive;
      };
      // Contact plan
      if (ai.plan) {
        const pl = ai.plan, p = pl.player;
        busy.add(p);
        if (now >= p.reactAt) {
          const noise = clamp((pl.t - now) / 1.0, 0, 1) * (1 - p.s.awareness) * 1.2;
          if (p.perc.id !== this.pathId) {
            const e = (1 - p.s.awareness) * 0.9;
            p.perc = { id: this.pathId, ex: gauss() * e, ez: gauss() * e };
          }
          p.target = { x: pl.stand.x + p.perc.ex * noise, z: pl.stand.z + p.perc.ez * noise };
          p.arriveT = null;
        }
        face(p, b.pos.x, b.pos.z);
      }
      if (ai.hit) {
        const h = ai.hit, p = h.player;
        busy.add(p);
        if (!p.air) {
          p.target = { x: h.take.x, z: h.take.z };
          p.arriveT = h.takeT;
          p.look = { x: 0, z: p.pos.z };
          if (!h.jumped && p.pose !== 'approach') p.setPose('approach', 0.2, now);
          else if (!h.jumped) p.poseUntil = now + 0.2;
        }
      }
      for (const bl of ai.blockers) {
        busy.add(bl.player);
        if (!bl.player.air && !bl.jumped) {
          bl.player.target = { x: t.sgn * 0.42, z: bl.z };
          bl.player.arriveT = null;
          bl.player.look = { x: 0, z: bl.player.pos.z };
        } else if (!bl.player.air && bl.jumped) {
          busy.delete(bl.player);
        }
      }
      for (const p of t.players) if (!busy.has(p)) face(p, b.pos.x, b.pos.z);

      const offense = lt && lt.team === t && !['serve', 'attack', 'free'].includes(lt.kind) && this.canTeamPlay(t);
      const free = t.players.filter((p) => !busy.has(p));
      if (offense) {
        if (ai.setInfo) {
          // Cover the hitter.
          const hp = ai.setInfo.targetLocal;
          const spots = [[hp.d + 1.6, hp.l - 1.4], [hp.d + 1.6, hp.l + 1.4], [hp.d + 3.4, hp.l * 0.5], [hp.d + 1.0, hp.l + (hp.l > 0 ? -2.5 : 2.5)], [6.5, 0]];
          this.assignSpots(t, free, spots.map(([d, l]) => [clamp(d, 1, 8.5), clamp(l, -4.2, 4.2)]), go);
        } else {
          const setterPlan = ai.plan && ai.plan.purpose === 'set' ? ai.plan : null;
          for (const p of free) {
            const z = p.zone;
            if (p === t.setter() && !t.profile.fixedRoles) { go(p, 1.3, 0.8); continue; }
            if (z === 4) go(p, 3.6, -3.9);
            else if (z === 3) {
              const quickReady = setterPlan && setterPlan.t - now < 0.45 && setterPlan.type === 'over';
              if (quickReady) {
                const sl = t.toLocal(setterPlan.stand.x, setterPlan.stand.z);
                go(p, 1.25, clamp(sl.l - 1.2, -3.5, 3.5));
              } else go(p, 2.6, -0.4);
            } else if (z === 2) go(p, 3.4, 3.9);
            else if (z === 1) go(p, 6.2, 2.6);
            else if (z === 6) go(p, 7.2, 0);
            else go(p, 6.2, -2.6);
          }
        }
        return;
      }

      const incoming = lt && lt.team === opp && ['serve', 'attack', 'free', 'block'].includes(lt.kind);
      const oppBuilding = lt && lt.team === opp && !incoming;
      const weSent = lt && lt.team === t && ['attack', 'free', 'serve'].includes(lt.kind);

      if (lt && lt.kind === 'serve' && lt.team === opp) {
        // Serve receive: hold formation unless planned.
        return;
      }
      if (incoming) {
        // Ball coming over: hitters peel off the net if it's a free ball, setter releases.
        const slow = b.vel.len() < 12 || lt.kind === 'free';
        for (const p of free) {
          if (p === t.setter() && !(ai.plan && ai.plan.player === p)) { go(p, 1.1, 0.8); continue; }
          if (!slow) continue;
          const z = p.zone;
          if (z === 4) go(p, 3.6, -3.9);
          else if (z === 3) go(p, 2.8, -0.4);
          else if (z === 2) go(p, 3.4, 3.9);
        }
        return;
      }
      if (oppBuilding && opp.ai.setInfo) {
        if (!ai.blockRead && now >= opp.ai.setInfo.time + this.readDelay(t)) this.setupBlock(t, opp);
        if (ai.blockRead) {
          const A = ai.readZ;
          // Diggers: line, cross, deep, plus tip coverage for spare front-row player.
          const frontFree = free.filter((p) => p.front);
          const backFree = free.filter((p) => !p.front);
          const sgA = Math.sign(A) || 1;
          const toL = (zW) => t.toLocal(t.sgn, zW).l;
          const spots = [[6.3, toL(clamp(A * 0.95, -4, 4))], [5.8, toL(-sgA * 2.6)], [8.2, toL(-A * 0.25)]];
          this.assignSpots(t, backFree, spots, go);
          for (const p of frontFree) go(p, 3.0, toL(clamp(A * 0.4, -3, 3)));
          return;
        }
      }
      if (weSent || oppBuilding || !lt) {
        // Base defence.
        const base = { 1: [6.4, 3.0], 2: [0.8, 2.8], 3: [0.8, 0], 4: [0.8, -2.8], 5: [6.4, -3.0], 6: [7.8, 0] };
        // Just after attacking, front row recover to the net more slowly (they're landing).
        for (const p of free) {
          const s = base[p.zone];
          go(p, s[0], s[1]);
        }
      }
    }

    readDelay(t) {
      let aw = 0;
      for (const p of t.players) if (p.front) aw += p.s.awareness / 3;
      return 0.3 - 0.2 * aw;
    }

    assignSpots(t, players, spots, go) {
      const used = new Set();
      const ps = players.slice();
      // Greedy: repeatedly take the globally closest (player, spot) pair.
      while (ps.length && used.size < spots.length) {
        let bi = -1, bj = -1, bd = 1e9;
        for (let i = 0; i < ps.length; i++) for (let j = 0; j < spots.length; j++) {
          if (used.has(j)) continue;
          const w = t.toWorld(spots[j][0], spots[j][1]);
          const d = Math.hypot(w.x - ps[i].pos.x, w.z - ps[i].pos.z);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
        if (bi < 0) break;
        go(ps[bi], spots[bj][0], spots[bj][1]);
        used.add(bj);
        ps.splice(bi, 1);
      }
    }

    // Read the opponent's set and put up a block.
    setupBlock(t, opp) {
      const ai = t.ai;
      ai.blockRead = true;
      const si = opp.ai.setInfo;
      let aw = 0;
      for (const p of t.players) if (p.front) aw = Math.max(aw, p.s.awareness);
      const zEst = clamp(si.target.z + gauss() * (1 - aw) * 1.1, -4.1, 4.1);
      ai.readZ = zEst;
      const fronts = t.players.filter((p) => p.front && !p.air && this.time >= p.downUntil - 0.3);
      fronts.sort((a, b) => Math.abs(a.pos.z - zEst) - Math.abs(b.pos.z - zEst));
      const timeLeft = si.T - 0.2;
      ai.blockers = [];
      if (!fronts.length) return;
      const primary = fronts[0];
      ai.blockers.push({ player: primary, z: zEst, jumpAt: null, jumped: false });
      const side = zEst > 0 ? -1 : 1; // second blocker closes toward the middle
      for (let k = 1; k < fronts.length && ai.blockers.length < 2 + (si.type === 'quick' ? 0 : 0); k++) {
        const p = fronts[k];
        const z2 = clamp(zEst + side * 0.62 * ai.blockers.length, -4.2, 4.2);
        const d = Math.abs(p.pos.z - z2) + Math.abs(Math.abs(p.pos.x) - 0.42);
        if (!t.profile.fixedRoles && rand() > t.knowledge * 0.8) break;
        if (moveTime(d, p) < timeLeft + 0.1) ai.blockers.push({ player: p, z: z2, jumpAt: null, jumped: false });
      }
    }

    // ---------------------------------------------------------- contacts
    checkPlanContact(t) {
      const pl = t.ai.plan;
      if (!pl) return false;
      const p = pl.player, b = this.ball, now = this.time;
      if (p.air || now < p.downUntil - 0.1) return false;
      if (b.pos.x * t.sgn < 0.02) return false;
      const hd = b.pos.distXZ(p.pos);
      const y = b.pos.y;
      const inOver = y >= p.H * 0.9 && y <= p.H * 1.25 && hd <= 0.6;
      const inBump = y >= 0.3 && y <= 1.35 && hd <= 0.8;
      const inDive = y >= 0.05 && y <= 1.1 && hd <= 0.8 + t.profile.diveReach;
      const nx = b.pos.x + b.vel.x * DT * 2, ny = b.pos.y + b.vel.y * DT * 2, nz = b.pos.z + b.vel.z * DT * 2;
      const nhd = Math.hypot(nx - p.pos.x, nz - p.pos.z);
      const timeOk = now >= pl.t - 0.04;
      let type = null;
      if (inOver && pl.type === 'over') {
        const leaving = ny < p.H * 0.9 || nhd > 0.6;
        if (timeOk || leaving || (b.vel.y < 0 && y <= p.H * 1.06)) type = 'over';
      } else if (inBump && pl.type !== 'over') {
        const leaving = ny < 0.3 || nhd > 0.8;
        if (timeOk || leaving || (b.vel.y < 0 && y <= 0.9)) type = 'bump';
      } else if (inOver && pl.type !== 'over') {
        const leaving = ny < p.H * 0.9 || nhd > 0.6;
        if (leaving && y > 1.4) type = 'over';
      } else if (inBump && pl.type === 'over') {
        const leaving = ny < 0.3 || nhd > 0.8;
        if (leaving || y < p.H * 0.7) type = 'bump';
      }
      if (!type && inDive && !inBump && !inOver) {
        const leaving = ny < 0.08 || nhd > 2.1;
        if ((leaving || y < 0.25) && (pl.dive || hd > 0.8)) type = 'dive';
      }
      if (!type) return false;
      const reach = type === 'over' ? hd / 0.6 : type === 'bump' ? hd / 0.8 : 1;
      const info = { type, reach: clamp(reach, 0, 1), vin: b.vel.len(), dive: type === 'dive' };
      if (type === 'dive') {
        // Lunge toward the ball and hit the deck.
        const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
        p.pos.x += (dx / d) * Math.max(0, d - 0.6); p.pos.z += (dz / d) * Math.max(0, d - 0.6);
        p.facing = Math.atan2(dx, dz);
        p.vel.set((dx / d) * 2, 0, (dz / d) * 2);
        p.setPose('dive', 1.0, now);
        p.downUntil = now + 1.0;
      } else {
        p.setPose(type === 'over' ? 'set' : 'bump', 0.4, now);
      }
      const purpose = pl.purpose;
      t.ai.plan = null;
      const call = type === 'over' ? this.handlingFault(p, info, pl.touchNo, y) : null;
      if (purpose === 'pass') this.doPass(p, info);
      else if (purpose === 'set') this.doSet(p, info);
      else this.doFree(p, info);
      if (call && this.phase === 'rally') {
        this.pointTo(this.other(t), 'handling', p, call === 'lift' ? `Lift called on ${this.pn(p)}` : `Double contact called on ${this.pn(p)}`);
      }
      return true;
    }

    checkHit(t) {
      const h = t.ai.hit;
      if (!h || !h.jumped) return false;
      const p = h.player, b = this.ball;
      if (!p.air) {
        // Landed without touching the ball: fall back to generic planning.
        t.ai.hit = null; t.ai.setInfo = null; t.ai.nextPlan = 0;
        return false;
      }
      if (b.pos.x * t.sgn < -0.05) return false;
      const hp = p.handPoint();
      const hd = Math.hypot(b.pos.x - hp.x, b.pos.z - hp.z);
      const inWin = hd < 0.6 && b.pos.y <= hp.y + 0.14 && b.pos.y >= hp.y - 0.8;
      if (!inWin) return false;
      const nx = b.pos.x + b.vel.x * DT * 2, ny = b.pos.y + b.vel.y * DT * 2, nz = b.pos.z + b.vel.z * DT * 2;
      const leaving = Math.hypot(nx - hp.x, nz - hp.z) > 0.6 || ny < hp.y - 0.8;
      if (!(p.vel.y <= 0.4 || leaving)) return false;
      const q = clamp(1 - ((hp.y - b.pos.y) / 0.8) * 0.55 - (hd / 0.6) * 0.35, 0.1, 1);
      p.setPose('spike', 0.35, this.time);
      t.ai.hit = null;
      this.doAttack(p, q);
      return true;
    }

    checkBlock(t) {
      const ai = t.ai;
      if (!ai.blockers.length) return false;
      const b = this.ball, sg = t.sgn;
      const lt = this.lastTouch;
      if (!lt || lt.team === t) return false;
      if (b.vel.x * sg <= 0) return false; // must be moving toward our side
      for (const bl of ai.blockers) {
        const p = bl.player;
        if (!p.air || p.jumpKind !== 'block') continue;
        const top = p.pos.y + p.reach + 0.05;
        const bottom = Math.max(C.netTop - 0.15, top - 0.6);
        if (top < C.netTop + 0.05) continue;
        const pen = (0.06 + 0.3 * p.s.blocking) * clamp((top - C.netTop) / 0.4, 0.3, 1);
        // hands span x from our side (sg*0.05) over to opponent side (-sg*pen)
        const xl = Math.min(sg * 0.06, -sg * pen) - R, xh = Math.max(sg * 0.06, -sg * pen) + R;
        if (b.pos.x < xl || b.pos.x > xh) continue;
        if (b.pos.y < bottom - R || b.pos.y > top + R) continue;
        if (Math.abs(b.pos.z - p.pos.z) > 0.45 + R) continue;
        this.resolveBlock(t, p, top);
        return true;
      }
      return false;
    }

    callIllegalAttack() {
      const p = this.pendingIllegal.player;
      this.pendingIllegal = null;
      return this.pointTo(this.other(p.team), 'fault', p, `Illegal back-row attack by ${this.pn(p)} (took off inside the 3 m line)`, null, p);
    }

    resolveBlock(t, p, top) {
      if (this.pendingIllegal) return this.callIllegalAttack();
      const b = this.ball, sg = t.sgn, now = this.time;
      const lt = this.lastTouch;
      const attacker = lt.player;
      const hitting = lt.kind === 'attack' ? attacker.s.hitting : 0.2;
      const helpers = t.ai.blockers.filter((x) => x.player !== p && x.player.air && Math.abs(x.player.pos.z - b.pos.z) < 1.1).map((x) => x.player);
      const centered = clamp(1 - Math.abs(b.pos.z - p.pos.z) / 0.55, 0, 1);
      const margin = top - b.pos.y;
      const pStuff = clamp(0.18 + 0.55 * p.s.blocking - 0.3 * hitting + 0.22 * centered + 0.08 * helpers.length + (margin > 0.25 ? 0.08 : -0.1), 0.05, 0.85);
      const pTool = clamp(0.1 + 0.15 * (1 - centered) + 0.12 * hitting, 0.05, 0.4);
      const r = rand(), sp = b.vel.len();
      let outcome;
      if (r < pStuff) {
        outcome = 'stuff';
        b.pos.x = -sg * (R + 0.06);
        b.vel.set(-sg * sp * randRange(0.2, 0.4), -randRange(1.5, 4.5), b.vel.z * 0.3 + gauss() * 1.2);
      } else if (r < pStuff + pTool) {
        outcome = 'tool';
        const side = Math.sign(b.pos.z - p.pos.z) || (rand() < 0.5 ? -1 : 1);
        if (rand() < 0.5) b.vel.set(sg * sp * randRange(0.3, 0.5), randRange(1, 4), side * randRange(3, 7));
        else b.vel.set(sg * sp * randRange(0.5, 0.7), randRange(3, 7), side * randRange(0, 2));
      } else if (rand() < 0.6) {
        outcome = 'soft';
        b.vel.set(sg * randRange(1.5, 3.5), randRange(3, 6.5), gauss() * 1.2);
      } else {
        outcome = 'softback';
        b.pos.x = -sg * (R + 0.06);
        b.vel.set(-sg * randRange(1, 3), randRange(3, 6), gauss() * 1.2);
      }
      b.spin.set(gauss() * 10, gauss() * 10, gauss() * 10);
      b.float = null;
      this.lastBlock = { players: [p, ...helpers], outcome, time: now, attacker: lt.kind === 'attack' ? attacker : null };
      if (outcome === 'stuff') this.addLog(`Roofed by ${this.pn(p)}${helpers.length ? ' & ' + helpers.map((h) => this.pn(h)).join(' & ') : ''}`, t, 'block');
      else if (outcome === 'tool') this.addLog(`${this.pn(attacker)} tools the block`, attacker.team, 'info');
      else this.addLog(`Touched by the block (${this.pn(p)})`, t, 'info');
      this.registerContact(p, 'block');
      this.onBallEvent(0.05);
    }

    checkPlayerFaults() {
      for (const t of this.teams) for (const p of t.players) {
        if (!p.air) continue;
        // Body touching the net while in the air
        if (Math.abs(p.pos.x) < 0.14 && Math.abs(p.pos.z) < C.HALF_W + 0.5) {
          if (rand() < 0.5 + (1 - p.s.awareness) * 0.5) {
            this.pointTo(this.other(t), 'fault', p, `Net violation by ${this.pn(p)}`, null, p);
            return;
          }
          // Avoided it at the last instant
          p.vel.x = t.sgn * Math.abs(p.vel.x);
        }
      }
    }

    registerContact(p, kind) {
      const t = p.team, opp = this.other(t), lt = this.lastTouch;
      // Back-row player sending a ball that is entirely above the net from the front zone: illegal if it crosses.
      this.pendingIllegal = null;
      if (!p.front && kind !== 'serve' && kind !== 'block' && kind !== 'body' && this.ball.pos.y - R > C.netTop) {
        const foot = p.air && p.takeoff ? p.takeoff : p.pos;
        if (t.toLocal(foot.x, foot.z).d <= C.ATTACK_LINE) this.pendingIllegal = { player: p };
      }
      const newPoss = !lt || lt.team !== t;
      if (newPoss) {
        this.touches[t.idx] = 0;
        t.ai.blockers = t.ai.blockers.filter((b) => b.player.air);
        t.ai.blockRead = false;
        opp.ai.setInfo = null; opp.ai.hit = null; opp.ai.plan = null;
      }
      if (kind === 'block') this.touches[t.idx] = 0;
      else this.touches[t.idx]++;
      // Confirm a pending dig once the ball is played again.
      if (this.pendingDig && kind !== 'block') {
        if (this.pendingDig.team === t) this.pendingDig.box.dig++;
        this.pendingDig = null;
      }
      this.lastTouch = { team: t, player: p, kind, time: this.time };
      this.contacts.push(this.lastTouch);
      t.ai.plan = null;
      if (kind === 'attack' || kind === 'free' || kind === 'serve') { t.ai.setInfo = null; t.ai.hit = null; }
      // Opponents get a reaction delay after any contact on the other side.
      const readF = kind === 'attack' ? 0.6 : 1;
      for (const q of opp.players) q.reactAt = this.time + q.reactT * readF;
      for (const q of t.players) if (q !== p) q.reactAt = Math.max(q.reactAt, this.time + q.reactT * 0.4);
      this.statsVersion++;
    }

    // ---- first contact: pass / dig / reception
    doPass(p, info) {
      const t = p.team, b = this.ball, lt = this.lastTouch;
      const prevKind = lt && lt.team !== t ? lt.kind : null;
      const kind = prevKind === 'serve' ? 'reception' : prevKind === 'attack' ? 'dig' : 'pass';
      const skill = info.type === 'over' ? (p.s.passing + p.s.setting) / 2 : p.s.passing;
      const prof = t.profile;
      let err = prof.err.pass * (1.05 - skill) * (0.35 + info.vin / 30) * (1 + 0.5 * info.reach + (info.dive ? 0.8 : 0) + (info.type === 'over' && info.vin > 12 ? 0.6 : 0));
      if (b.float && info.type === 'over') err *= 1.2;
      const spot = t.toWorld(1.3, 0.8);
      const target = new V3(spot.x, 2.25, spot.z);
      const dist = b.pos.distXZ(target);
      let T = 0.95 + 0.07 * dist;
      const pShank = clamp(((err - 0.6) * 0.35 + Math.max(0, info.vin - 17) * 0.012) * prof.shank, 0, 0.55);
      if (rand() < pShank) {
        // Shanked: the ball flies off somewhere unplanned.
        const ang = rand() * Math.PI * 2;
        const hs = randRange(1, 5) * (0.5 + info.vin / 20) * prof.shankFar;
        b.vel.set(Math.cos(ang) * hs, randRange(2, 7) * Math.sqrt(prof.shankFar), Math.sin(ang) * hs);
        this.addLog(`${this.pn(p)} shanks the ${kind === 'dig' ? 'dig' : 'pass'}`, t, 'info');
      } else {
        const loc = t.toLocal(target.x, target.z);
        loc.d += gauss() * err * 0.8;
        loc.l += gauss() * err * 1.2;
        const w = t.toWorld(loc.d, loc.l);
        target.x = w.x; target.z = w.z;
        T = clamp(T * (1 + gauss() * err * 0.15), 0.6, 2.2);
        b.vel.copy(PH.solveLaunch(b.pos, target, T, null));
      }
      b.spin.set(gauss() * 3, gauss() * 3, gauss() * 3);
      b.float = null;
      if (kind === 'reception') p.box.ra++;
      this.registerContact(p, kind);
      if (kind === 'dig') this.pendingDig = { team: t, box: p.box };
      this.onBallEvent();
    }

    // ---- second contact: set
    doSet(p, info) {
      const t = p.team, b = this.ball, opp = this.other(t);
      const quality = info.type === 'over' && !info.dive && info.reach < 0.6 ? 1 : info.type === 'over' ? 0.7 : 0.4;
      // Setter dump: attack on two.
      if (p.front && info.type === 'over' && b.pos.y > C.netTop - 0.05 && Math.abs(b.pos.x) < 1.6 && rand() < 0.05 * p.s.awareness * quality) {
        this.addLog(`${this.pn(p)} dumps it on two`, t, 'info');
        this.doAttack(p, 0.6, 'tip');
        return;
      }
      // Chasing a ball far off the court: just bump it high back toward the middle.
      const spot = t.toWorld(1.3, 0.8);
      const farOff = Math.hypot(b.pos.x - spot.x, b.pos.z - spot.z) > 5 || Math.abs(b.pos.z) > C.HALF_W + 0.5 || Math.abs(b.pos.x) > C.HALF_L;
      if (farOff) { this.doSave(p, info); return; }
      const choice = this.chooseHitter(t, p, quality);
      if (!choice) { this.doFree(p, info); return; }
      const { hitter, type, local } = choice;
      const hc = hitter.reach + hitter.jumpH * 0.95;
      let err = t.profile.err.set * (1.06 - p.s.setting) * (1 + info.reach * 0.8 + (info.type !== 'over' ? 1.0 : 0) + (info.dive ? 1.5 : 0) + Math.max(0, info.vin - 8) * 0.05);
      const loc = { d: local.d + gauss() * err * 0.45, l: local.l + gauss() * err * 0.7 };
      const w = t.toWorld(loc.d, loc.l);
      const target = new V3(w.x, hc - 0.1, w.z);
      const dist = b.pos.distXZ(target);
      let T = (type === 'quick' ? 0.62 : type === 'medium' ? 0.95 : type === 'back' ? 1.15 : 1.25) + dist * 0.03;
      T *= 1 + gauss() * err * 0.07;
      b.vel.copy(PH.solveLaunch(b.pos, target, T, null));
      b.spin.set(gauss(), gauss(), gauss());
      b.float = null;
      this.registerContact(p, 'set');
      t.ai.setInfo = { hitter, setter: p, type, target, targetLocal: loc, T, time: this.time };
      t.ai.hit = null;
      this.onBallEvent();
      t.ai.nextPlan = 0;
    }

    // A high "save" pass back to the middle of the court from far away.
    doSave(p, info) {
      const t = p.team, b = this.ball;
      const err = t.profile.err.set * (1.06 - (p.s.passing + p.s.setting) / 2) * (1 + info.reach + (info.dive ? 1.2 : 0));
      const w = t.toWorld(2.8 + gauss() * err * 1.2, gauss() * err * 1.5);
      const target = new V3(w.x, 2.4, w.z);
      const T = clamp(1.2 + b.pos.distXZ(target) * 0.06, 1.2, 2.3);
      b.vel.copy(PH.solveLaunch(b.pos, target, T, null));
      b.spin.set(gauss() * 3, gauss() * 3, gauss() * 3);
      b.float = null;
      this.addLog(`${this.pn(p)} chases it down`, t, 'info');
      this.registerContact(p, 'pass');
      this.onBallEvent();
    }

    chooseHitter(t, setter, quality) {
      const opp = this.other(t), now = this.time;
      // Does the setter know who the good hitters are?
      const know = t.profile.fixedRoles ? 1 : (t.knowledge + setter.raw.awareness) / 2;
      const sl = t.toLocal(setter.pos.x, setter.pos.z);
      let best = null;
      for (const p of t.players) {
        if (p === setter || p.air || now < p.downUntil - 0.3) continue;
        if (!p.front && quality < 0.7) continue; // back-row sets need a decent first two contacts
        const z = p.zone;
        let type, local;
        const pl = t.toLocal(p.pos.x, p.pos.z);
        if (!p.front) { type = 'back'; local = { d: 3.6, l: z === 6 ? 0 : z === 1 ? 2.6 : -2.6 }; }
        else if (z === 3 && quality >= 0.95 && pl.d < 2.2) { type = 'quick'; local = { d: 0.6, l: clamp(sl.l - 1.2, -3.5, 3.5) }; }
        else if (z === 3) { type = 'medium'; local = { d: 0.8, l: -0.5 }; }
        else if (z === 4) { type = 'high'; local = { d: 0.9, l: -3.5 }; }
        else { type = 'high'; local = { d: 0.9, l: 3.5 }; }
        if (type !== 'quick' && type !== 'back' && Math.abs(pl.l - local.l) > 3.5) local.l = (local.l + pl.l) / 2;
        const T = type === 'quick' ? 0.62 : type === 'medium' ? 0.95 : type === 'back' ? 1.15 : 1.25;
        const w = t.toWorld(local.d + 0.3 + 0.35, local.l);
        const dist = Math.hypot(w.x - p.pos.x, w.z - p.pos.z);
        const feasible = moveTime(dist, p) * (type === 'quick' ? 0.8 : 1) < T - p.tPeak + 0.15;
        let sc = know * (p.s.hitting * 2 + p.s.jumping * 0.5) * (t.profile.fixedRoles ? 1 : 2.5) + (feasible ? 0 : -3);
        if (type === 'quick') sc += 0.25;
        if (type === 'medium') sc -= 0.3;
        if (type === 'back') sc -= t.profile.fixedRoles ? 0.7 : 2.4;
        // Avoid the side with more blockers.
        const lw = t.toWorld(local.d, local.l);
        let blk = 0;
        for (const o of opp.players) if (o.front && Math.abs(o.pos.z - lw.z) < 1.6) blk++;
        sc -= blk * 0.35 * setter.s.awareness;
        sc += gauss() * ((1.3 - setter.s.awareness) * 0.6 + (1 - know) * 0.9);
        if (!best || sc > best.sc) best = { sc, hitter: p, type, local, feasible };
      }
      if (!best) return null;
      return best;
    }

    // ---- attack
    doAttack(p, q, forceType) {
      const t = p.team, opp = this.other(t), b = this.ball;
      const c = b.pos.clone();
      if (c.y < C.netTop + 0.1 || Math.abs(c.x) > 6) { this.doFree(p, { type: 'over', reach: 0.5, vin: b.vel.len(), dive: false }, true); return; }
      const hit = p.s.hitting, aw = p.s.awareness;
      const spike = (12.5 + 14 * hit) * (0.62 + 0.38 * q);
      // Opponent blockers in the air / at the net.
      const blockers = opp.players.filter((o) => o.front && Math.abs(o.pos.x) < 1.3);
      const cands = [];
      const push = (d, l, kind) => cands.push({ d, l, kind });
      if (!forceType) {
        for (const d of [2.5, 4, 5.5, 7, 8.3]) for (const l of [-3.9, -2.7, -1.4, 0, 1.4, 2.7, 3.9]) push(d, l, 'spike');
        for (const d of [6.5, 8.2]) for (const l of [-3, 0, 3]) push(d, l, 'roll');
      }
      for (const d of [1.3, 2.2]) for (const l of [-3, -1.5, 0, 1.5, 3]) push(d, l, 'tip');
      let best = null;
      for (const cd of cands) {
        if (forceType && cd.kind !== forceType) continue;
        const w = opp.toWorld(cd.d, cd.l);
        const spd = cd.kind === 'spike' ? spike : cd.kind === 'roll' ? 10 + 3 * hit : 6.5;
        const dist = Math.hypot(w.x - c.x, w.z - c.z);
        const tf = dist / (spd * 0.8) + (cd.kind === 'tip' ? 0.3 : 0);
        const fooled = cd.kind === 'tip' ? 0.3 : 0.1; // defenders are late on off-speed shots
        let open = 99;
        for (const o of opp.players) {
          const reachR = 0.9 + o.speed * Math.max(0, tf - o.reactT - fooled) * 0.65;
          open = Math.min(open, Math.hypot(o.pos.x - w.x, o.pos.z - w.z) - reachR);
        }
        // Walk the straight-line flight and see whether it passes through a blocker's hands.
        let blockPen = 0;
        if (cd.kind !== 'tip') {
          for (const o of blockers) {
            const peak = o.air ? o.pos.y + Math.max(0, o.vel.y) ** 2 / (2 * G) : o.jumpH * VB.BLOCK_JUMP;
            const top = peak + o.reach + 0.1;
            for (let k = 1; k <= 16; k++) {
              const s = k / 16;
              const x = c.x + (w.x - c.x) * s;
              if (Math.abs(x) > 0.55) continue;
              const z = c.z + (w.z - c.z) * s;
              const y = c.y - (c.y - R) * s * (cd.kind === 'spike' ? 1 : 0.4);
              if (Math.abs(o.pos.z - z) < 0.6 && y < top + 0.05) { blockPen += 1.4 + aw; break; }
            }
          }
        }
        const errSd = (1.05 - hit) * 2.0 + (1 - q) * 1.0;
        const margin = Math.min(9 - cd.d, 4.5 - Math.abs(cd.l));
        const risk = Math.exp(-Math.max(0, margin) / Math.max(0.2, errSd)) * 1.2;
        let sc = clamp(open, -1.5, 1.2) * 0.6 - blockPen - risk * 2.2 + gauss() * (1.2 - aw) * 0.9;
        if (cd.kind === 'spike') sc += 0.4 * q + 0.4;
        if (cd.kind === 'tip') sc -= 0.3;
        if (cd.kind === 'roll') sc -= 0.2;
        if (VB.DEBUG) (this._atk || (this._atk = [])).push({ sc: +sc.toFixed(2), kind: cd.kind, d: cd.d, l: cd.l, blockPen, open: +open.toFixed(2), risk: +risk.toFixed(2) });
        if (!best || sc > best.sc) best = { sc, cd, w, spd, dist };
      }
      const { cd, w, spd, dist } = best;
      const target = new V3(w.x, R, w.z);
      const dir = { x: w.x - c.x, z: w.z - c.z };
      const spin = cd.kind === 'tip' ? new V3() : topspin(dir, (cd.kind === 'spike' ? 30 + 30 * hit : 15) * q);
      let T = dist / (spd * 0.82) + (cd.kind === 'tip' ? 0.35 : 0);
      let v = PH.solveLaunch(c, target, T, spin);
      const minClear = cd.kind === 'tip' ? 0.35 : 0.04;
      for (let k = 0; k < 8; k++) {
        const chk = PH.checkShot(c, v, spin, minClear);
        if (chk.ok) break;
        T *= 1.12;
        v = PH.solveLaunch(c, target, T, spin);
      }
      const err = t.profile.err.attack * (1.06 - hit) * (0.7 + (1 - q) * 1.3) * (cd.kind === 'tip' ? 0.6 : 1);
      v = perturb(v, gauss() * err * 0.12, gauss() * err * 0.08, 1 + gauss() * 0.05);
      b.vel.copy(v);
      b.spin.copy(spin);
      b.float = null;
      p.box.ta++;
      this.shotKind = cd.kind;
      this.registerContact(p, 'attack');
      this.onBallEvent();
    }

    // ---- free ball / down ball over the net
    doFree(p, info, fromAttack) {
      const t = p.team, opp = this.other(t), b = this.ball;
      const skill = (p.s.passing + p.s.setting) / 2;
      const err = t.profile.err.set * (1.08 - skill) * (1 + (info.reach || 0) + (info.dive ? 1.5 : 0) + (info.vin || 0) * 0.03);
      const loc = { d: randRange(4.5, 7.5) + gauss() * err * 1.0, l: randRange(-3, 3) + gauss() * err * 1.2 };
      const w = opp.toWorld(loc.d, loc.l);
      const target = new V3(w.x, R, w.z);
      let T = 1.4;
      let v = PH.solveLaunch(b.pos, target, T, null);
      for (let k = 0; k < 8; k++) {
        if (PH.checkShot(b.pos, v, null, 0.35).ok) break;
        T *= 1.12;
        v = PH.solveLaunch(b.pos, target, T, null);
      }
      v = perturb(v, gauss() * err * 0.03, gauss() * err * 0.03, 1);
      b.vel.copy(v);
      b.spin.set(gauss() * 4, gauss() * 4, gauss() * 4);
      b.float = null;
      if (fromAttack) p.box.ta++;
      this.registerContact(p, fromAttack ? 'attack' : 'free');
      if (fromAttack) this.shotKind = 'down';
      this.onBallEvent();
    }

    // ---- serve
    doServe(p) {
      const t = p.team, opp = this.other(t), b = this.ball;
      const s = p.s.serving;
      const type = this.serve.type;
      const spd = type === 'topspin' ? 17 + 9 * s : type === 'jumpfloat' ? 14.5 + 6 * s : type === 'underhand' ? 8.5 + 4 * s : 13 + 6.5 * s;
      const sdSrv = 0.4 + (1 - s) * 1.5;
      let best = null;
      for (let d = 2.5; d <= 8.6; d += 1) for (let l = -4; l <= 4; l += 1) {
        const w = opp.toWorld(d, l);
        let near = 99;
        for (const o of opp.players) near = Math.min(near, Math.hypot(o.pos.x - w.x, o.pos.z - w.z));
        const margin = Math.min(9 - d, 4.5 - Math.abs(l));
        const risk = Math.exp(-margin / sdSrv) * 2.2;
        const sc = near * 0.6 + (d > 6 ? 0.3 : 0) - risk + gauss() * 0.5;
        if (!best || sc > best.sc) best = { sc, w };
      }
      const target = new V3(best.w.x, R, best.w.z);
      const dir = { x: target.x - b.pos.x, z: target.z - b.pos.z };
      const dist = Math.hypot(dir.x, dir.z);
      const spin = type === 'topspin' ? topspin(dir, 25 + 25 * s) : new V3(gauss() * 0.5, gauss() * 0.5, gauss() * 0.5);
      let T = dist / (spd * 0.78);
      let v = PH.solveLaunch(b.pos, target, T, spin);
      const minClear = (type === 'topspin' ? 0.25 : type === 'underhand' ? 0.6 : 0.12) + (1 - s) * 0.35;
      for (let k = 0; k < 12; k++) {
        if (PH.checkShot(b.pos, v, spin, minClear).ok) break;
        T *= 1.07;
        v = PH.solveLaunch(b.pos, target, T, spin);
      }
      const err = t.profile.err.serve * (1.08 - s);
      v = perturb(v, gauss() * err * 0.05, gauss() * err * 0.05, 1 + gauss() * 0.03);
      b.vel.copy(v);
      b.spin.copy(spin);
      b.float = type === 'topspin' ? null : {
        amp: type === 'underhand' ? 0.3 : (type === 'jumpfloat' ? 1.0 : 0.8) + 1.6 * s, t0: this.time,
        w1: randRange(3, 6), w2: randRange(2, 5), p1: rand() * 6.28, p2: rand() * 6.28,
      };
      p.setPose(type === 'float' ? 'serveHit' : type === 'underhand' ? 'bump' : 'spike', 0.35, this.time);
      this.phase = 'rally';
      this.rallies++;
      this.netHitLogged = false;
      this.registerContact(p, 'serve');
      const label = type === 'topspin' ? 'jump serve' : type === 'jumpfloat' ? 'jump float' : type === 'underhand' ? 'underhand serve' : 'float serve';
      this.addLog(`${this.pn(p)} ${label}`, t, 'serve');
      this.onBallEvent();
      // Receivers see the serve a touch late.
      for (const q of opp.players) q.reactAt = this.time + q.reactT;
    }

    // ---------------------------------------------------------- scoring
    pn(p) { return p ? `#${p.number} ${p.name.split(' ').slice(-1)[0]}` : ''; }

    fault(lt, reason, text, where) {
      if (!lt) return this.pointTo(this.teams[1 - this.serving], reason, null, text);
      return this.pointTo(this.other(lt.team), reason, lt.player, text, where);
    }

    // Award a point. `culprit` is the player who committed an error (if any).
    pointTo(winner, reason, culprit, text, where, netFaultPlayer) {
      if (this.phase !== 'rally' && this.phase !== 'serve') return;
      const loser = this.other(winner);
      const lastW = [...this.contacts].reverse().find((c) => c.team === winner);
      const lastL = [...this.contacts].reverse().find((c) => c.team === loser);
      let desc = text || '';
      const setAssist = (attacker) => {
        const idx = this.contacts.lastIndexOf(this.contacts.slice().reverse().find((c) => c.player === attacker && c.kind === 'attack'));
        const prev = idx > 0 ? this.contacts[idx - 1] : null;
        if (prev && prev.kind === 'set' && prev.team === attacker.team && prev.player !== attacker) {
          prev.player.box.a++;
          return ` (set by ${this.pn(prev.player)})`;
        }
        return '';
      };
      if (reason === 'handling') {
        culprit.box.bhe++;
      } else if (netFaultPlayer) {
        netFaultPlayer.box.e++;
      } else if (reason === 'serveError') {
        culprit.box.se++;
      } else if (reason === 'in') {
        // Ball landed in the loser's court.
        if (lastW && lastW.kind === 'attack') {
          lastW.player.box.k++;
          desc = `Kill by ${this.pn(lastW.player)}${setAssist(lastW.player)}`;
          if (this.shotKind === 'tip') desc = `Tip kill by ${this.pn(lastW.player)}${setAssist(lastW.player)}`;
        } else if (lastW && lastW.kind === 'serve' && this.contacts.filter((c) => c.team === loser).length <= 1) {
          const receivers = this.contacts.filter((c) => c.team === loser);
          lastW.player.box.sa++;
          if (receivers.length) { receivers[0].player.box.re++; desc = `Ace by ${this.pn(lastW.player)} — ${this.pn(receivers[0].player)} can't handle it`; }
          else desc = `Ace by ${this.pn(lastW.player)}`;
        } else if (lastW && lastW.kind === 'block' && this.lastBlock && this.lastBlock.outcome === 'stuff') {
          const bps = this.lastBlock.players;
          if (bps.length === 1) bps[0].box.bs++; else for (const bp of bps) bp.box.ba++;
          if (this.lastBlock.attacker) this.lastBlock.attacker.box.e++;
          desc = `Block point — ${bps.map((x) => this.pn(x)).join(' & ')}`;
        } else if (!lastW && lastL && lastL.kind === 'serve') {
          lastL.player.box.se++;
          desc = `Service error by ${this.pn(lastL.player)} — into the net`;
        } else if (lastW) {
          desc = lastL ? `Ball drops in on ${loser.name}'s side` : `${this.pn(lastW.player)} finds the floor`;
        } else desc = `Ball drops on ${loser.name}'s side`;
      } else {
        // Loser's error: out, antenna, net crossing, etc.
        const lc = this.lastTouch;
        const why = text || 'out';
        if (lc && lc.kind === 'block' && lc.team === loser && this.lastBlock && this.lastBlock.attacker && this.lastBlock.attacker.team === winner) {
          const a = this.lastBlock.attacker;
          a.box.k++;
          desc = `Kill by ${this.pn(a)} off the block${setAssist(a)}`;
        } else if (lc && lc.kind === 'serve') {
          lc.player.box.se++;
          desc = `Service error by ${this.pn(lc.player)} — ${why}`;
        } else if (lc && lc.kind === 'attack') {
          lc.player.box.e++;
          desc = `Attack error by ${this.pn(lc.player)} — ${why}`;
        } else if (lc && lastW && lastW.kind === 'attack') {
          lastW.player.box.k++;
          desc = `Kill by ${this.pn(lastW.player)}${setAssist(lastW.player)} — ${this.pn(lc.player)} can't control it`;
        } else if (lc && lastW && lastW.kind === 'serve' && this.contacts.filter((c) => c.team === loser).length <= 1) {
          lastW.player.box.sa++;
          lc.player.box.re++;
          desc = `Ace by ${this.pn(lastW.player)} — ${this.pn(lc.player)} shanks it`;
        } else if (lc) {
          desc = `Ball-handling error by ${this.pn(lc.player)} — ${why}`;
        }
      }
      if (this.pendingDig && this.pendingDig.team === winner) this.pendingDig.box.dig++;
      this.pendingDig = null;

      winner.score++;
      this.lastWinner = winner;
      this.addLog(`${desc}  →  ${this.teams[0].score}–${this.teams[1].score}`, winner, 'point');
      this.statsVersion++;
      this.phase = 'dead';
      this.phaseStart = this.time;
      this.ball.live = false;
      for (const t of this.teams) { t.ai.plan = null; t.ai.hit = null; t.ai.blockers = t.ai.blockers.filter((b) => b.player.air); }

      // Side-out: winner rotates and serves.
      if (winner.idx !== this.serving) {
        winner.rotate();
        this.pickSetter(winner);
        this.serving = winner.idx;
      }
      // Set / match end
      const target = this.setTarget;
      const s = winner.score, o = loser.score;
      const cap = this.settings.pointCap;
      const won = (s >= target && (!this.settings.winBy2 || s - o >= 2)) || (cap > 0 && s >= cap);
      if (won) {
        winner.sets++;
        this.teams[0].setScores.push(this.teams[0].score);
        this.teams[1].setScores.push(this.teams[1].score);
        if (winner.sets >= this.setsToWin) {
          this.winner = winner;
          this.pendingSetEnd = 'match';
          this.addLog(`${winner.name} win the match ${winner.sets}–${loser.sets}!`, winner, 'header');
        } else {
          this.pendingSetEnd = 'set';
          this.addLog(`${winner.name} take set ${this.setNo} ${s}–${o}`, winner, 'header');
        }
      }
    }
  }

  VB.DEFAULT_SETTINGS = {
    pointsPerSet: 25,
    finalSetPoints: 15,
    bestOf: 5,
    winBy2: true,
    pointCap: 0,
    netHeight: 2.43,
    switchSides: true,
    frontRowSetter: true,
    handlingCalls: 1,
    pointDelay: 2.4,
    serveDelay: 1.6,
    setBreak: 4,
  };

  VB.BLOCK_JUMP = 0.8;

  // Mode profiles. `map` converts a 0..1 rating into engine ability (casual 10/10 ~ a mid-level competitive player).
  VB.PROFILES = {
    competitive: {
      statMax: 100, heightUnit: 'cm', map: null, fixedRoles: true,
      err: { pass: 1, set: 1, attack: 1, serve: 1 }, shank: 1, shankFar: 1, diveReach: 1.3,
    },
    casual: {
      statMax: 10, heightUnit: 'in', fixedRoles: false,
      map: {
        jumping: [0.0, 0.55], reactions: [0.05, 0.55], agility: [0.08, 0.6], hitting: [0.0, 0.55],
        passing: [0.02, 0.6], setting: [0.02, 0.6], blocking: [0.0, 0.5], serving: [0.05, 0.55], awareness: [0.0, 0.5],
      },
      err: { pass: 1.2, set: 1.3, attack: 1.3, serve: 1.5 }, shank: 1.4, shankFar: 1.5, diveReach: 0.9,
    },
  };
  Object.assign(VB, { Game, Player, Team, moveTime });
})();

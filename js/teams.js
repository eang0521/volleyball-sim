// Team / player data generation. Plain data only (the live Player objects are built in game.js).
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const { gauss, clamp, pick, shuffle, rand } = VB;

  VB.STAT_KEYS = ['jumping', 'reactions', 'agility', 'hitting', 'passing', 'setting', 'blocking', 'serving', 'awareness'];
  VB.STAT_LABELS = {
    jumping: 'JMP', reactions: 'REA', agility: 'AGI', hitting: 'HIT', passing: 'PAS',
    setting: 'SET', blocking: 'BLK', serving: 'SRV', awareness: 'AWR',
  };
  VB.CASUAL_POSITION_LABELS = ['P1 · right back (serves first)', 'P2 · right front', 'P3 · middle front', 'P4 · left front', 'P5 · left back', 'P6 · middle back'];
  VB.POSITION_LABELS = ['P1 · RB (serves first)', 'P2 · RF (setter)', 'P3 · MF', 'P4 · LF (hitter)', 'P5 · LB', 'P6 · MB'];

  VB.SKILL_LEVELS = {
    recreational: { label: 'Recreational', mean: 38, sd: 13, height: 177 },
    intermediate: { label: 'Intermediate', mean: 54, sd: 12, height: 183 },
    advanced: { label: 'Advanced', mean: 69, sd: 10, height: 189 },
    elite: { label: 'Elite', mean: 83, sd: 7, height: 195 },
  };

  const FIRST = ['Alex', 'Jordan', 'Sam', 'Riley', 'Casey', 'Taylor', 'Morgan', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Kai',
    'Devon', 'Skyler', 'Emerson', 'Parker', 'Reese', 'Hayden', 'Dakota', 'Elliot', 'Finley', 'Sage', 'Micah', 'Noel',
    'Ari', 'Blake', 'Cameron', 'Drew', 'Jesse', 'Logan', 'Marlow', 'Nico', 'Remy', 'Tatum', 'Wren', 'Zion', 'Luca', 'Mika'];
  const LAST = ['Rivera', 'Chen', 'Okafor', 'Nguyen', 'Kowalski', 'Silva', 'Haddad', 'Johansson', 'Park', 'Moreau',
    'Tanaka', 'Adeyemi', 'Costa', 'Novak', 'Ibrahim', 'Larsen', 'Fischer', 'Reyes', 'Morales', 'Kim', 'Petrov',
    'Duarte', 'Walsh', 'Bauer', 'Sato', 'Mensah', 'Rossi', 'Varga', 'Lindqvist', 'Oduya', 'Castillo', 'Brooks'];
  const CITIES = ['Harbor City', 'Northfield', 'Riverside', 'Summit', 'Bayview', 'Ironwood', 'Lakeshore', 'Redrock',
    'Pinecrest', 'Eastport', 'Silverton', 'Westbrook'];
  const MASCOTS = ['Spikers', 'Tide', 'Hawks', 'Volts', 'Comets', 'Wolves', 'Storm', 'Rockets', 'Owls', 'Blaze',
    'Sharks', 'Falcons'];
  const COLORS = ['#e63946', '#1d7fe0', '#2a9d4f', '#f4a261', '#8e44ad', '#f1c40f', '#16a3a3', '#e84393', '#d35400', '#ecf0f1'];
  const SKINS = ['#f1c7a5', '#e0ac85', '#c68a5e', '#a86b43', '#7d4a2c', '#5c3620'];

  // Casual players: ratings 0-10, height in inches.
  function randomCasualPlayer(number) {
    const talent = gauss() * 1.1;
    const stats = {};
    for (const k of VB.STAT_KEYS) stats[k] = Math.round(clamp(4.5 + talent + gauss() * 1.8, 0, 10));
    const height = Math.round(clamp(68 + gauss() * 3.5, 58, 80));
    stats.blocking = Math.round(clamp(stats.blocking + (height - 68) * 0.2, 0, 10));
    stats.agility = Math.round(clamp(stats.agility - (height - 68) * 0.1, 0, 10));
    return { name: pick(FIRST) + ' ' + pick(LAST), number, height, stats, skin: pick(SKINS) };
  }

  function randomPlayer(level, number) {
    if (level === 'casual') return randomCasualPlayer(number);
    const L = VB.SKILL_LEVELS[level] || VB.SKILL_LEVELS.intermediate;
    const talent = gauss() * L.sd * 0.5; // overall talent shared by all stats
    const stats = {};
    for (const k of VB.STAT_KEYS) stats[k] = Math.round(clamp(L.mean + talent + gauss() * L.sd * 0.85, 5, 99));
    const height = Math.round(clamp(L.height + gauss() * 8, 160, 215));
    // Taller players tend to block better; shorter ones tend to move/pass better.
    const hAdj = (height - L.height) * 0.6;
    stats.blocking = Math.round(clamp(stats.blocking + hAdj, 5, 99));
    stats.agility = Math.round(clamp(stats.agility - hAdj * 0.5, 5, 99));
    return {
      name: pick(FIRST) + ' ' + pick(LAST),
      number,
      height,
      stats,
      skin: pick(SKINS),
    };
  }

  // Order 6 players into rotation positions 1..6 using casual role logic.
  function arrangeLineup(players) {
    const pool = players.slice();
    const take = (score) => {
      let best = 0;
      for (let i = 1; i < pool.length; i++) if (score(pool[i]) > score(pool[best])) best = i;
      return pool.splice(best, 1)[0];
    };
    const s = (p, k) => p.stats[k];
    const setter = take((p) => s(p, 'setting') * 1.5 + s(p, 'awareness') * 0.5); // P2 (RF)
    const hitter = take((p) => s(p, 'hitting') * 1.4 + s(p, 'jumping') * 0.6); // P4 (LF)
    const middle = take((p) => s(p, 'blocking') * 1.2 + s(p, 'hitting') * 0.5 + p.height * 0.3); // P3 (MF)
    const server = take((p) => s(p, 'serving')); // P1
    const libLike = take((p) => s(p, 'passing')); // P6
    const last = pool[0]; // P5
    return [server, setter, middle, hitter, last, libLike];
  }

  // Casual lineup: spread setters, hitters, blockers and passers so every rotation is playable.
  // Tries all 720 orders. In each rotation the front row is 3 consecutive players in the
  // circular order (zones 2-3-4) and the back row is the other 3; we maximise the weakest
  // rotation, then the average, and penalise uneven rotations.
  function rotationStrength(front, back) {
    const st = (p, k) => p.stats[k];
    const hAdj = (p) => (p.height - 68) * 0.15;
    const setVal = (p) => st(p, 'setting') + st(p, 'awareness') * 0.3;
    const hitVal = (p) => st(p, 'hitting') + st(p, 'jumping') * 0.4 + hAdj(p);
    const blkVal = (p) => st(p, 'blocking') + st(p, 'jumping') * 0.3 + hAdj(p) * 1.3;
    const passVal = (p) => st(p, 'passing') + st(p, 'reactions') * 0.4 + st(p, 'agility') * 0.3;
    const setter = front.reduce((a, p) => (setVal(p) > setVal(a) ? p : a));
    const hitters = front.filter((p) => p !== setter);
    return setVal(setter) * 1.0 +
      hitters.reduce((s, p) => s + hitVal(p), 0) * 0.5 +
      front.reduce((s, p) => s + blkVal(p), 0) / 3 * 0.35 +
      back.reduce((s, p) => s + passVal(p), 0) * 0.3;
  }

  function lineupRotations(order) {
    const out = [];
    for (let r = 0; r < 6; r++) {
      const at = (zone) => order[(zone - 1 + r) % 6]; // after r rotations, zone z holds order[z-1+r]
      out.push({ front: [at(2), at(3), at(4)], back: [at(1), at(5), at(6)] });
    }
    return out;
  }

  function balanceScore(order) {
    const s = lineupRotations(order).map((x) => rotationStrength(x.front, x.back));
    const mean = s.reduce((a, b) => a + b, 0) / 6;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / 6);
    return Math.min(...s) + 0.25 * mean - 0.5 * sd;
  }

  function balancedLineup(players) {
    let best = null, bestScore = -Infinity;
    const perm = (arr, k) => {
      if (k === arr.length) {
        const sc = balanceScore(arr);
        if (sc > bestScore + 1e-9) { bestScore = sc; best = arr.slice(); }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        perm(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    perm(players.slice(), 0);
    // Same circular order, but start in the rotation that's strongest overall with a good server at P1.
    let start = 0, startScore = -Infinity;
    for (let r = 0; r < 6; r++) {
      const o = best.slice(r).concat(best.slice(0, r));
      const rot = lineupRotations(o)[0];
      const sc = rotationStrength(rot.front, rot.back) + o[0].stats.serving * 0.3;
      if (sc > startScore) { startScore = sc; start = r; }
    }
    return best.slice(start).concat(best.slice(0, start));
  }

  function randomTeam(level, name, color) {
    const nums = shuffle(Array.from({ length: 24 }, (_, i) => i + 1)).slice(0, 6);
    const players = nums.map((n) => randomPlayer(level, n));
    return {
      name: name || pick(CITIES) + ' ' + pick(MASCOTS),
      color: color || pick(COLORS),
      players: level === 'casual' ? balancedLineup(players) : arrangeLineup(players),
    };
  }

  function randomTeams(level) {
    const cols = shuffle(COLORS.slice());
    const cities = shuffle(CITIES.slice());
    const mascots = shuffle(MASCOTS.slice());
    return [
      randomTeam(level, cities[0] + ' ' + mascots[0], cols[0]),
      randomTeam(level, cities[1] + ' ' + mascots[1], cols[1]),
    ];
  }

  function overall(p) {
    let sum = 0;
    for (const k of VB.STAT_KEYS) sum += p.stats[k];
    const avg = sum / VB.STAT_KEYS.length;
    return VB.MODE === 'casual' ? avg.toFixed(1) : Math.round(avg);
  }

  Object.assign(VB, { randomPlayer, randomTeam, randomTeams, arrangeLineup, balancedLineup, lineupRotations, rotationStrength, overall, SKINS, COLORS });
  VB.rand01 = rand;
})();

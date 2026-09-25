// Team / player data generation. Plain data only (the live Player objects are built in game.js).
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const { gauss, clamp, pick, shuffle, rand } = VB;

  VB.STAT_KEYS = ['jumping', 'reactions', 'agility', 'hitting', 'passing', 'setting', 'blocking', 'serving', 'awareness'];
  VB.STAT_LABELS = {
    jumping: 'JMP', reactions: 'REA', agility: 'AGI', hitting: 'HIT', passing: 'PAS',
    setting: 'SET', blocking: 'BLK', serving: 'SRV', awareness: 'AWR',
  };
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

  function randomPlayer(level, number) {
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

  function randomTeam(level, name, color) {
    const nums = shuffle(Array.from({ length: 24 }, (_, i) => i + 1)).slice(0, 6);
    const players = nums.map((n) => randomPlayer(level, n));
    return {
      name: name || pick(CITIES) + ' ' + pick(MASCOTS),
      color: color || pick(COLORS),
      players: arrangeLineup(players),
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
    return Math.round(sum / VB.STAT_KEYS.length);
  }

  Object.assign(VB, { randomPlayer, randomTeam, randomTeams, arrangeLineup, overall, SKINS, COLORS });
  VB.rand01 = rand;
})();

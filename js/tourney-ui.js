// Tournament page UI: players → teams → format → bracket, with background simulation and a live 3D viewer.
(function () {
  const T = VB.T;
  VB.MODE = 'casual';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const KEY = 'vbt.state';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  };

  // ------------------------------------------------------------ state
  const S = Object.assign({
    tab: 'players', players: [], pairs: [], present: [], k: 0, teams: [], config: clone(T.DEFAULT_CONFIG), tour: null,
  }, store.get() || {});
  S.config = mergeConfig(S.config);
  if (S.scale !== 10) { for (const p of S.players) p.skill = T.fromStars(p.skill); S.scale = 10; }
  function mergeConfig(c) {
    const d = clone(T.DEFAULT_CONFIG);
    c = c || {};
    return Object.assign(d, c, {
      match: { pool: Object.assign(d.match.pool, c.match && c.match.pool), playoff: Object.assign(d.match.playoff, c.match && c.match.playoff), final: Object.assign(d.match.final, c.match && c.match.final) },
      rules: Object.assign(d.rules, c.rules),
    });
  }
  let pmap = {};
  const rebuildMap = () => { pmap = Object.fromEntries(S.players.map((p) => [p.id, p])); if (S.tour) S.tour.playerMap = pmap; };
  rebuildMap();
  function save() {
    const tour = S.tour ? Object.assign({}, S.tour, { playerMap: undefined }) : null;
    store.set(Object.assign({}, S, { tour }));
  }
  const present = () => S.players.filter((p) => S.present.includes(p.id));
  const maxTeams = () => Math.max(2, Math.floor(present().length / 6));
  const teamOf = (pid) => S.teams.find((t) => t.playerIds.includes(pid));
  const tById = (id) => (S.tour ? S.tour.teams : S.teams).find((t) => t.id === id);
  // Rating badge, coloured like open-gym-teams: 1-3 gray, 4-6 blue, 7-8 green, 9-10 gold.
  const badge = (n) => `<span class="rb ${n >= 9 ? 'r4' : n >= 7 ? 'r3' : n >= 4 ? 'r2' : 'r1'}" title="${n} · ${T.LEVELS[n] || ''}">${n}</span>`;
  const sn = (id) => T.shortNames(S.players)[id] || (pmap[id] ? pmap[id].name : '?'); // "Elijah A."

  // ------------------------------------------------------------ tabs
  function showTab(tab) {
    S.tab = tab; save();
    for (const b of $$('.steps button')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); }
    for (const s of $$('.tab')) s.hidden = s.id !== 'tab-' + tab;
    render();
  }
  for (const b of $$('.steps button')) b.onclick = () => showTab(b.dataset.tab);

  function render() {
    if (S.tab === 'players') renderPlayers();
    else if (S.tab === 'teams') renderTeams();
    else if (S.tab === 'format') renderFormat();
    else renderPlay();
  }

  // ------------------------------------------------------------ 1. players
  $('#btnLoad').onclick = () => {
    const res = T.parsePlayers($('#pasteBox').value);
    const msg = $('#loadMsg');
    if (res.error || !res.players.length) { msg.textContent = res.error || 'No players found.'; msg.className = 'msg err'; return; }
    if (S.tour && !confirm('Loading new players resets the current tournament and teams. Continue?')) return;
    S.players = res.players; S.pairs = res.pairs; S.present = res.players.map((p) => p.id); S.scale = 10;
    S.teams = []; S.tour = null; S.k = 0;
    rebuildMap(); save();
    msg.className = 'msg';
    msg.textContent = `Loaded ${res.players.length} player${res.players.length === 1 ? "" : "s"}${res.pairs.length ? ` and ${res.pairs.length} together/apart rules` : ''}.${res.converted ? ' This backup used 1–5 stars, so ratings were converted to 1–10 (2 × stars − 1).' : ''} Uncheck anyone who isn't playing, then go to Teams.`;
    $('#pasteBox').value = '';
    renderPlayers();
  };
  $('#playerSearch').oninput = () => renderPlayerTable();
  $('#btnAll').onclick = () => { S.present = S.players.map((p) => p.id); changedRoster(); };
  $('#btnNone').onclick = () => { S.present = []; changedRoster(); };
  function changedRoster() { if (!S.tour) { S.teams = []; } save(); renderPlayers(); }

  function renderPlayers() {
    $('#playersCard').hidden = !S.players.length;
    if (!S.players.length) return;
    renderPlayerTable();
    renderStatsKey();
  }
  function renderPlayerTable() {
    const q = $('#playerSearch').value.trim().toLowerCase();
    const n = S.present.length;
    $('#presentCount').textContent = `· ${n} of ${S.players.length} playing${n < 12 ? ' (need at least 12)' : ''}`;
    const locked = !!S.tour;
    const posOpts = (v) => [['', '—']].concat(T.POS).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('');
    const rows = S.players.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => {
      const on = S.present.includes(p.id);
      return `<tr class="${on ? '' : 'out'}" data-id="${p.id}">
        <td><input type="checkbox" data-f="present" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(p.name)} is playing"></td>
        <td>${esc(p.name)}</td>
        <td><select data-f="skill" ${locked ? 'disabled' : ''} aria-label="Rating for ${esc(p.name)}">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => `<option value="${s}"${s === p.skill ? ' selected' : ''}>${s} · ${T.LEVELS[s]}</option>`).join('')}</select></td>
        <td><select data-f="pos" ${locked ? 'disabled' : ''} aria-label="Position for ${esc(p.name)}">${posOpts(p.pos)}</select></td>
        <td><select data-f="gender" ${locked ? 'disabled' : ''} aria-label="Gender for ${esc(p.name)}"><option value=""${!p.gender ? ' selected' : ''}>—</option><option value="M"${p.gender === 'M' ? ' selected' : ''}>M</option><option value="F"${p.gender === 'F' ? ' selected' : ''}>F</option></select></td>
        <td class="t">${S.tour || S.teams.length ? (teamOf(p.id) ? `<span class="dot" style="background:${teamOf(p.id).color}"></span>${esc(teamOf(p.id).name)}` : '') : ''}</td>
      </tr>`;
    }).join('');
    $('#playerTable').innerHTML = `<thead><tr><th>Playing</th><th>Name</th><th>Stars</th><th>Position</th><th>Gender</th><th>Team</th></tr></thead><tbody>${rows}</tbody>`;
  }
  $('#playerTable').onchange = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const p = pmap[tr.dataset.id], f = e.target.dataset.f;
    if (f === 'present') { S.present = e.target.checked ? S.present.concat(p.id) : S.present.filter((x) => x !== p.id); tr.classList.toggle('out', !e.target.checked); changedRoster(); return; }
    if (f === 'skill') p.skill = +e.target.value;
    else p[f] = e.target.value;
    save();
  };
  function renderStatsKey() {
    const keys = VB.STAT_KEYS;
    const rows = [['A', 'All-around'], ['H', 'Hitter'], ['M', 'Middle'], ['L', 'Libero'], ['S', 'Setter']].map(([k, l]) => {
      const v = T.ratingStats(5, k), off = T.OFFSETS[k];
      return `<tr><td>${l}</td>${keys.map((s) => `<td class="${(off[s] || 0) > 0 ? 'up' : (off[s] || 0) < 0 ? 'dn' : ''}">${v[s]}</td>`).join('')}<td>${keys.reduce((a, s) => a + v[s], 0)}</td></tr>`;
    }).join('');
    $('#statsKey').innerHTML = `<p class="hint">Skills for a player rated 5 by position. A player's 1–10 rating is the base for every skill, and position moves points between them (shown for a 5; other ratings get the same shifts). A blank position plays as All-around.</p>
      <table class="key"><thead><tr><th>Position</th>${keys.map((k) => `<th title="${k}">${VB.STAT_LABELS[k]}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ------------------------------------------------------------ 2. teams
  function sizesText(n, k) {
    if (n < 12) return `Need at least 12 players (have ${n}).`;
    const base = Math.floor(n / k), extra = n % k;
    return extra ? `${extra} team${extra > 1 ? 's' : ''} of ${base + 1}, ${k - extra} of ${base}` : `${k} teams of ${base}`;
  }
  $('#kDec').onclick = () => { S.k = Math.max(2, (S.k || maxTeams()) - 1); save(); renderTeams(); };
  $('#kInc').onclick = () => { S.k = Math.min(maxTeams(), (S.k || maxTeams()) + 1); save(); renderTeams(); };
  $('#btnMake').onclick = () => makeTeams();

  function playerForLineup(id) { const p = pmap[id]; return Object.assign({}, p, { height: T.HEIGHT_IN, stats: T.ratingStats(p.skill, p.pos) }); }
  function relineup(team) {
    team.playerIds = T.bestLineup(team.playerIds.map(playerForLineup)).map((p) => p.id);
    team.numbers = team.numbers || {};
    const used = new Set(Object.values(team.numbers));
    for (const id of team.playerIds) if (!team.numbers[id]) { let n = 1; while (used.has(n)) n++; team.numbers[id] = n; used.add(n); }
  }
  function makeTeams() {
    const ps = present(), k = Math.min(S.k || maxTeams(), maxTeams());
    if (ps.length < 12) { $('#teamsMsg').textContent = 'Check in at least 12 players first.'; $('#teamsMsg').className = 'msg err'; return; }
    const groups = T.makeTeams(ps, k, S.pairs);
    S.k = k;
    S.teams = groups.map((ids, i) => Object.assign({ id: 't' + i + Math.random().toString(36).slice(2, 6), playerIds: ids, numbers: {} }, T.teamIdentity(i)));
    S.teams.forEach(relineup);
    save();
    $('#teamsMsg').className = 'msg';
    $('#teamsMsg').textContent = `Made ${k} teams. Reshuffle with “Make teams” again, or move players with the menus.`;
    renderTeams();
  }

  function renderTeams() {
    const n = present().length, locked = !!S.tour;
    if (!S.k || S.k > maxTeams()) S.k = maxTeams();
    $('#kOut').textContent = S.k;
    $('#kSizes').textContent = sizesText(n, S.k);
    $('#kDec').disabled = locked || S.k <= 2;
    $('#kInc').disabled = locked || S.k >= maxTeams();
    $('#btnMake').disabled = locked || n < 12;
    $('#btnMake').textContent = S.teams.length ? 'Reshuffle teams' : 'Make teams';
    if (locked) { $('#teamsMsg').className = 'msg'; $('#teamsMsg').textContent = 'The tournament has started — reset it on the Tournament tab to change teams.'; }
    $('#teamGrid').innerHTML = S.teams.map((t) => {
      const ps = t.playerIds.map((id) => pmap[id]);
      const rot = T.cycleRotations(ps).map((r, i) => `R${i + 1} ${r.front.map((p) => esc(sn(p.id))).join('/')}`).join(' · ');
      const moveOpts = (pid) => `<select data-move="${pid}" aria-label="Move ${esc(pmap[pid].name)} to another team" ${locked ? 'disabled' : ''}><option value="">Move…</option>${S.teams.filter((x) => x !== t).map((x) => `<option value="${x.id}">→ ${esc(x.name)}</option>`).join('')}</select>`;
      return `<article class="tcard" style="--tc:${t.color}">
        <header><b>${esc(t.name)}</b><span>${ps.length} players · ${T.teamStrength(ps).toFixed(2)} avg rating</span></header>
        <ol>${ps.map((p, i) => `<li><span class="i">${i < 6 ? 'P' + (i + 1) : 'Sub'}</span><span title="${esc(p.name)}">${esc(sn(p.id))}</span><span class="pos" title="${T.POSN[p.pos] || 'All-around'}">${p.pos || '–'} ${badge(p.skill)}</span>${moveOpts(p.id)}</li>`).join('')}</ol>
        <div class="rots">${ps.length < 6 ? '<span class="warn">Needs at least 6 players.</span> ' : ''}Front row each rotation: ${rot}</div>
      </article>`;
    }).join('');
  }
  $('#teamGrid').onchange = (e) => {
    const pid = e.target.dataset.move, to = e.target.value;
    if (!pid || !to) return;
    const from = teamOf(pid), dest = S.teams.find((t) => t.id === to);
    from.playerIds = from.playerIds.filter((x) => x !== pid);
    dest.playerIds.push(pid);
    delete from.numbers[pid];
    relineup(from); relineup(dest);
    save(); renderTeams();
  };

  // ------------------------------------------------------------ 3. format
  const MATCH_GROUPS = [['pool', 'Pool games'], ['playoff', 'Playoff matches'], ['final', 'Finals (championship / grand final)']];
  function renderMatchGrid() {
    const c = S.config;
    $('#matchGrid').innerHTML = MATCH_GROUPS.map(([k, label]) => {
      const m = c.match[k];
      const allowAll = k === 'pool';
      return `<fieldset data-m="${k}"><legend>${label}</legend>
        ${allowAll ? `<label class="check"><input type="checkbox" data-k="playAllSets" ${m.playAllSets ? 'checked' : ''}> Play a fixed number of sets (ties allowed)</label>` : ''}
        <label>${m.playAllSets ? 'Sets played' : 'Match length'}
          <select data-k="bestOf">${(m.playAllSets ? [1, 2, 3] : [1, 3, 5]).map((v) => `<option value="${v}"${v === m.bestOf ? ' selected' : ''}>${m.playAllSets ? v + ' set' + (v > 1 ? 's' : '') : v === 1 ? '1 set' : 'Best of ' + v}</option>`).join('')}</select>
        </label>
        <label>Points per set <input type="number" data-k="pointsPerSet" min="5" max="50" value="${m.pointsPerSet}"></label>
        ${m.playAllSets || m.bestOf === 1 ? '' : `<label>Deciding set to <input type="number" data-k="finalSetPoints" min="5" max="50" value="${m.finalSetPoints}"></label>`}
        <label class="check"><input type="checkbox" data-k="winBy2" ${m.winBy2 ? 'checked' : ''}> Win by 2</label>
        <label>Point cap (0 = none) <input type="number" data-k="pointCap" min="0" max="60" value="${m.pointCap}"></label>
      </fieldset>`;
    }).join('');
  }
  function poolSizes() {
    const k = S.teams.length || S.k || 2, c = S.config;
    const pools = c.format === 'roundrobin' ? 1 : Math.max(1, Math.min(c.pools, Math.floor(k / 2)));
    return Array.from({ length: pools }, (_, i) => Math.floor(k / pools) + (i < k % pools ? 1 : 0));
  }
  function renderFormat() {
    const f = $('#fmtForm'), c = S.config, locked = !!S.tour;
    f.elements.format.value = c.format;
    f.elements.seeding.value = c.seeding;
    f.elements.pools.value = c.pools;
    f.elements.poolDouble.checked = c.poolDouble;
    f.elements.advanceMode.value = c.advanceMode;
    f.elements.advanceCount.value = c.advanceCount;
    f.elements.playoffType.value = c.playoffType;
    f.elements.thirdPlace.checked = c.thirdPlace;
    f.elements.gfReset.checked = c.gfReset;
    f.elements.netHeight.value = String(c.rules.netHeight);
    f.elements.handlingCalls.value = String(c.rules.handlingCalls);
    f.elements.frontRowSetter.checked = c.rules.frontRowSetter;
    f.elements.switchSides.checked = c.rules.switchSides;
    const maxGames = Math.max(1, Math.max(...poolSizes()) - 1);
    f.elements.poolGames.innerHTML = `<option value="0">Full round robin</option>` + Array.from({ length: maxGames }, (_, i) => `<option value="${i + 1}">${i + 1} game${i ? 's' : ''} each</option>`).join('');
    f.elements.poolGames.value = String(Math.min(c.poolGames, maxGames));
    $('#advLbl').textContent = c.advanceMode === 'perPool' ? 'Teams per pool' : 'Teams in the playoff';
    for (const el of $$('[data-show]', f)) el.hidden = !el.dataset.show.split(' ').includes(c.format);
    const bracketType = c.format === 'double' || (c.format === 'pool-playoff' && c.playoffType === 'double') ? 'double' : 'single';
    for (const el of $$('[data-bracket]', f)) el.hidden = el.dataset.bracket !== bracketType;
    f.elements.bracketStyle.value = c.bracketStyle || 'standard';
    f.elements.ladderByes.value = c.ladderByes || '';
    const ladder = bracketType === 'single' && c.bracketStyle === 'ladder';
    for (const el of $$('[data-ladder]', f)) el.hidden = !ladder;
    if (ladder) renderLadderPreview();
    renderMatchGrid();
    for (const el of f.elements) el.disabled = locked;
    renderSummary();
  }
  $('#fmtForm').onchange = (e) => {
    const f = $('#fmtForm'), c = S.config, el = e.target;
    const fs = el.closest('fieldset[data-m]');
    if (fs) {
      const m = c.match[fs.dataset.m], k = el.dataset.k;
      m[k] = el.type === 'checkbox' ? el.checked : +el.value;
      if (k === 'playAllSets') m.bestOf = m.playAllSets ? 2 : 1;
    } else {
      c.format = f.elements.format.value;
      c.seeding = f.elements.seeding.value;
      c.pools = Math.max(1, +f.elements.pools.value || 1);
      c.poolGames = +f.elements.poolGames.value || 0;
      c.poolDouble = f.elements.poolDouble.checked;
      c.advanceMode = f.elements.advanceMode.value;
      c.advanceCount = Math.max(1, +f.elements.advanceCount.value || 1);
      c.playoffType = f.elements.playoffType.value;
      c.thirdPlace = f.elements.thirdPlace.checked;
      c.bracketStyle = f.elements.bracketStyle.value;
      c.ladderByes = T.parseByes(f.elements.ladderByes.value).join(', ');
      c.gfReset = f.elements.gfReset.checked;
      c.rules.netHeight = +f.elements.netHeight.value;
      c.rules.handlingCalls = +f.elements.handlingCalls.value;
      c.rules.frontRowSetter = f.elements.frontRowSetter.checked;
      c.rules.switchSides = f.elements.switchSides.checked;
    }
    save();
    renderFormat();
  };

  // How many teams reach the playoff bracket.
  function playoffCount() {
    const c = S.config, k = S.teams.length || S.k || maxTeams();
    if (c.format !== 'pool-playoff') return k;
    const pools = poolSizes().length;
    return c.advanceMode === 'perPool' ? Math.min(k, c.advanceCount * pools) : Math.min(k, Math.max(2, c.advanceCount));
  }
  const ladderOn = () => {
    const c = S.config;
    return c.bracketStyle === 'ladder' && (c.format === 'single' || (c.format === 'pool-playoff' && c.playoffType === 'single'));
  };
  function ladderError() {
    if (!ladderOn()) return null;
    const plan = T.ladderPlan(playoffCount(), T.parseByes(S.config.ladderByes));
    return plan.error || null;
  }
  // Live preview of the stepladder, e.g. "Round 2: 3 v 6/7, 4 v 5/8".
  function renderLadderPreview() {
    const N = playoffCount();
    const plan = T.ladderPlan(N, T.parseByes(S.config.ladderByes));
    const el = $('#ladderPreview');
    if (plan.error) { el.innerHTML = `<p class="msg err">${esc(plan.error)}</p>`; return; }
    el.innerHTML = `<p class="hint">${N} teams${S.config.ladderByes ? '' : ` — automatic byes: <b>${plan.byes.join(', ') || 'none'}</b>`}. Numbers are seeds; “5/8” means the winner of 5 v 8.</p>` +
      `<div class="ladder">${T.ladderPreview(plan).map((r) => `<div><h3>${esc(r.name)}</h3><ul>${r.games.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }

  // Plain-language description of the chosen format and how many matches it means.
  function describe() {
    const c = S.config, k = S.teams.length || S.k || maxTeams();
    const fmtLen = (m) => (m.playAllSets ? `${m.bestOf} set${m.bestOf > 1 ? 's' : ''}` : m.bestOf === 1 ? '1 set' : `best of ${m.bestOf}`) + ` to ${m.pointsPerSet}`;
    const elim = (n, type) => (type === 'double' ? `${2 * n - 2}${c.gfReset ? '–' + (2 * n - 1) : ''}` : `${n - 1 + (c.thirdPlace ? 1 : 0)}`);
    const bracketName = (type) => (type === 'double' ? 'double-elimination' : ladderOn() ? 'stepladder (top seeds get extra byes)' : 'single-elimination');
    const err = ladderError();
    if (err) return `<span class="msg err">Stepladder byes don't work for ${playoffCount()} teams: ${esc(err)}</span>`;
    if (c.format === 'single' || c.format === 'double') {
      return `<b>${k} teams</b> in a ${bracketName(c.format)} bracket — <b>${elim(k, c.format)} matches</b>. Playoff matches: ${fmtLen(c.match.playoff)}; final: ${fmtLen(c.match.final)}.`;
    }
    const sizes = poolSizes();
    const per = (s) => { const full = (s * (s - 1)) / 2 * (c.poolDouble ? 2 : 1); const g = c.poolGames > 0 ? Math.min(c.poolGames * (c.poolDouble ? 2 : 1), (s - 1) * (c.poolDouble ? 2 : 1)) : (s - 1) * (c.poolDouble ? 2 : 1); return { full, g, n: c.poolGames > 0 ? Math.floor((s * g) / 2) : full }; };
    const poolGames = sizes.reduce((a, s) => a + per(s).n, 0);
    const poolTxt = sizes.length === 1 ? `one pool of ${sizes[0]}` : `${sizes.length} pools (${sizes.join(', ')} teams)`;
    if (c.format === 'roundrobin') return `<b>${k} teams</b> in ${poolTxt} — <b>${poolGames} games</b> (${fmtLen(c.match.pool)}). Best record wins.`;
    const adv = c.advanceMode === 'perPool' ? Math.min(k, c.advanceCount * sizes.length) : Math.min(k, Math.max(2, c.advanceCount));
    return `<b>${k} teams</b> in ${poolTxt}: <b>${poolGames} pool games</b> (${fmtLen(c.match.pool)}). Then <b>${adv} teams</b> (${c.advanceMode === 'perPool' ? `top ${c.advanceCount} of each pool` : 'best records overall'}) play a ${bracketName(c.playoffType)} playoff — <b>${elim(adv, c.playoffType)} matches</b> (${fmtLen(c.match.playoff)}; final ${fmtLen(c.match.final)}).`;
  }
  function renderSummary() { $('#fmtSummary').innerHTML = describe(); }

  // ------------------------------------------------------------ 4. tournament
  function teamsValid() { return S.teams.length >= 2 && S.teams.every((t) => t.playerIds.length >= 6); }
  $('#btnStart').onclick = () => {
    if (!teamsValid()) return;
    const tour = { teams: clone(S.teams), config: clone(S.config), playerMap: pmap };
    T.start(tour);
    S.tour = tour;
    save(); renderPlay();
  };
  // Replays go to IndexedDB; the saved tournament keeps only captions and scores.
  function stashHighlights(res, m) {
    if (!res || !res.highlights || !m) return;
    const A = tById(m.a), B = tById(m.b);
    const label = `${A.name} vs ${B.name}${m.label ? ' · ' + m.label : ''}`;
    res.highlights = res.highlights.map((h) => {
      h.label = label; h.matchId = m.id;
      VB.HL.store.put(h);
      return VB.HL.meta(h);
    });
  }
  const allHighlights = () => S.tour.matches.flatMap((m) => (m.result && m.result.highlights) || []).sort((a, b) => b.score - a.score);
  function hlItem(h) {
    const [A, B] = h.teams;
    return `<li class="hl">
      <div class="hl-top"><span class="flames" title="Excitement ${h.score.toFixed(1)}">${'🔥'.repeat(VB.HL.flames(h.score))}</span><span class="hl-score">Set ${h.set} · <span class="dot" style="background:${A.color}"></span>${h.before[0]}–${h.before[1]}<span class="dot" style="background:${B.color}"></span></span></div>
      <div class="hl-label">${esc(h.label || '')}</div>
      <div class="hl-title">${esc(h.title)}</div>
      ${h.detail ? `<div class="hl-detail">${esc(h.detail)}</div>` : ''}
      <div class="hl-tags">${h.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <button class="small" data-hlw="${h.id}" ${h.hasReplay ? '' : 'disabled title="No replay kept"'}>▶ Watch</button>
    </li>`;
  }
  function renderTourHighlights() {
    const list = allHighlights();
    $('#hlCard').hidden = !list.length;
    if (!list.length) return;
    $('#hlList').innerHTML = list.slice(0, 10).map(hlItem).join('');
  }
  $('#btnHlReel').onclick = () => viewer.openReplay(allHighlights().filter((h) => h.hasReplay).slice(0, 10));

  $('#btnReset').onclick = () => {
    if (sim.busy) return;
    if (!confirm('Reset the tournament? All results will be cleared (teams and settings are kept).')) return;
    S.tour = null; save(); renderPlay();
    VB.HL.store.clear();
  };

  function teamLabel(id) {
    if (!id) return '<span class="tbd">TBD</span>';
    if (id === T.BYE) return '<span class="tbd">bye</span>';
    const t = tById(id);
    return `<span><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span>`;
  }
  function matchCard(m, cls = '') {
    const r = m.result;
    const side = (key, idx) => {
      const win = r && !r.bye && ((r.winner === 'A' && idx === 0) || (r.winner === 'B' && idx === 1));
      const lose = r && !r.bye && r.winner && !win;
      const sc = r && !r.bye && !r.skipped ? `${r.sets[idx]} <span class="lbl2">(${r.setScores[idx].join('-')})</span>` : '';
      return `<div class="mt ${win ? 'win' : lose ? 'lose' : ''}">${teamLabel(m[key])}<span class="sc">${sc}</span></div>`;
    };
    const playable = T.isPlayable(m);
    const hls = r && r.highlights && r.highlights.some((h) => h.hasReplay) ? `<button class="small" data-mhl="${m.id}">★ Highlights</button>` : '';
    const act = !playable && hls ? `<div class="act">${hls}</div>` : playable ? `<div class="act"><button class="small" data-watch="${m.id}">▶ Watch</button><button class="small" data-sim="${m.id}">Sim</button></div>` : '';
    const note = r && r.skipped ? '<div class="lbl2">Not needed</div>' : r && !r.bye && !r.winner ? '<div class="lbl2">Tied on sets</div>' : '';
    const lbl = cls.includes('nolabel') ? '' : `<div class="lbl2">${esc(m.label || '')}</div>`;
    return `<div class="match ${playable ? 'ready' : ''} ${cls}">${lbl}${side('a', 0)}${side('b', 1)}${note}${act}</div>`;
  }

  function renderPlay() {
    const tour = S.tour;
    $('#startCard').hidden = !!tour;
    $('#liveArea').hidden = !tour;
    if (!tour) {
      const ok = teamsValid();
      $('#startSummary').innerHTML = ok ? describe() : 'Make teams first (Teams tab). Every team needs at least 6 players.';
      $('#btnStart').disabled = !ok || !!ladderError();
      return;
    }
    tour.playerMap = pmap;
    renderToolbar();
    // Champion
    const ch = $('#champion');
    if (tour.stage === 'done' && tour.champion) {
      const t = tById(tour.champion);
      ch.hidden = false;
      ch.innerHTML = `🏆 <b>${esc(t.name)}</b> win the tournament! <span class="hint">${t.playerIds.map((id) => esc(sn(id))).join(', ')}</span>`;
    } else ch.hidden = true;
    // Pools
    const poolMs = tour.matches.filter((m) => m.stage === 'pool');
    if (tour.pools && poolMs.length) {
      const advIds = new Set(tour.stage !== 'pool' && tour.playoffSeeds ? tour.playoffSeeds : []);
      $('#poolsArea').innerHTML = `<div class="pools">${tour.pools.map((_, pi) => {
        const rows = T.standings(tour, pi);
        const ms = poolMs.filter((m) => m.pool === pi);
        return `<div class="card"><h2>${tour.pools.length > 1 ? 'Pool ' + String.fromCharCode(65 + pi) : 'Standings'}</h2>
          <div class="tbl-wrap"><table class="stand"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th>${ms.some((m) => m.result && !m.result.winner) ? '<th>T</th>' : ''}<th>Sets</th><th>Pts ±</th></tr></thead><tbody>
          ${rows.map((r, i) => `<tr class="${advIds.has(r.id) ? 'adv' : ''}"><td>${i + 1}</td><td>${teamLabel(r.id)}</td><td>${r.w}</td><td>${r.l}</td>${ms.some((m) => m.result && !m.result.winner) ? `<td>${r.t}</td>` : ''}<td>${r.sw}–${r.sl}</td><td>${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}</td></tr>`).join('')}
          </tbody></table></div>
          <details ${tour.stage === 'pool' ? 'open' : ''}><summary class="hint">Games (${ms.filter((m) => m.result).length}/${ms.length} played)</summary><div class="mlist">${ms.map((m) => matchCard(m, 'pool')).join('')}</div></details></div>`;
      }).join('')}</div>`;
    } else $('#poolsArea').innerHTML = '';
    // Bracket
    const po = tour.matches.filter((m) => m.stage === 'playoff');
    if (po.length) {
      const visible = (m) => !(m.result && m.result.bye);
      const cols = (list, prefix) => {
        const rounds = [...new Set(list.map((m) => m.round))].sort((a, b) => a - b);
        return rounds.map((r) => {
          const ms = list.filter((m) => m.round === r && visible(m));
          if (!ms.length) return '';
          return `<div class="bcol"><h3>${esc(ms[0].label)}</h3><div class="bms">${ms.map((m) => matchCard(m, 'nolabel')).join('')}</div></div>`;
        }).join('');
      };
      const W = po.filter((m) => m.bracket === 'W'), L = po.filter((m) => m.bracket === 'L');
      const fin = po.filter((m) => ['GF', 'GF2', '3rd'].includes(m.bracket) && visible(m) && !(m.result && m.result.skipped && m.bracket === 'GF2'));
      const isDouble = L.length || po.some((m) => m.bracket === 'GF');
      $('#bracketArea').innerHTML = `<div class="card"><h2>${isDouble ? 'Winners bracket' : 'Playoffs'}</h2><div class="bracket-wrap"><div class="bracket">${cols(W, isDouble ? 'Winners' : '')}${!isDouble ? fin.map((m) => `<div class="bcol"><h3>${esc(m.label)}</h3><div class="bms">${matchCard(m, 'nolabel')}</div></div>`).join('') : ''}</div></div></div>
        ${isDouble ? `<div class="card"><h2>Losers bracket</h2><div class="bracket-wrap"><div class="bracket">${cols(L, 'Losers')}</div></div></div>
        <div class="card"><h2>Finals</h2><div class="bracket-wrap"><div class="bracket">${fin.map((m) => `<div class="bcol"><h3>${esc(m.label)}</h3><div class="bms">${matchCard(m, 'nolabel')}</div></div>`).join('')}</div></div></div>` : ''}`;
    } else {
      $('#bracketArea').innerHTML = tour.config.format === 'pool-playoff' ? `<div class="card"><h2>Playoffs</h2><p class="hint">The bracket is drawn when pool play finishes.</p></div>` : '';
    }
    renderLeaders();
    renderTourHighlights();
  }

  function renderToolbar() {
    const tour = S.tour, any = !!T.nextPlayable(tour), busy = sim.busy;
    $('#btnSimNext').disabled = busy || !any;
    $('#btnSimAvail').disabled = busy || !any;
    $('#btnSimAll').disabled = busy || tour.stage === 'done';
    $('#btnReset').disabled = busy;
    const left = tour.matches.filter((m) => !m.result).length, done = tour.matches.filter((m) => m.result && !m.result.bye && !m.result.skipped).length;
    if (!busy) $('#simStatus').textContent = tour.stage === 'done' ? `Finished — ${done} matches played.` : `${done} played · ${left} to go${tour.stage === 'pool' && tour.config.format === 'pool-playoff' ? ' in pool play' : ''}`;
  }

  function renderLeaders() {
    const tot = {};
    for (const m of S.tour.matches) {
      if (!m.result || !m.result.box) continue;
      for (const [pid, b] of Object.entries(m.result.box)) {
        const t = tot[pid] || (tot[pid] = { pts: 0, k: 0, sa: 0, blk: 0, dig: 0, a: 0, gp: 0 });
        t.k += b.k; t.sa += b.sa; t.blk += b.bs + b.ba * 0.5; t.dig += b.dig; t.a += b.a; t.gp++;
        t.pts += b.k + b.sa + b.bs + b.ba * 0.5;
      }
    }
    const ids = Object.keys(tot);
    $('#leadersCard').hidden = !ids.length;
    if (!ids.length) return;
    const tm = (pid) => S.tour.teams.find((t) => t.playerIds.includes(pid));
    const cat = (key, label) => {
      const top = ids.filter((id) => tot[id][key] > 0).sort((a, b) => tot[b][key] - tot[a][key]).slice(0, 8);
      return `<div><h3>${label}</h3><ol>${top.map((id) => `<li><span class="dot" style="background:${tm(id) ? tm(id).color : '#888'}"></span>${esc(sn(id))} — <b>${+tot[id][key].toFixed(1)}</b></li>`).join('') || '<li class="hint">—</li>'}</ol></div>`;
    };
    $('#leaders').innerHTML = cat('pts', 'Points') + cat('k', 'Kills') + cat('sa', 'Aces') + cat('blk', 'Blocks') + cat('dig', 'Digs') + cat('a', 'Assists');
  }

  $('#tab-play').onclick = (e) => {
    const w = e.target.closest('[data-watch]'), s = e.target.closest('[data-sim]');
    if (w && !sim.busy) viewer.open(w.dataset.watch);
    if (s && !sim.busy) sim.run([s.dataset.sim]);
    const hw = e.target.closest('[data-hlw]'), mh = e.target.closest('[data-mhl]');
    if (hw) { const h = allHighlights().find((x) => x.id === hw.dataset.hlw); if (h) viewer.openReplay([h]); }
    if (mh) { const m = S.tour.matches.find((x) => x.id === mh.dataset.mhl); viewer.openReplay(m.result.highlights.filter((h) => h.hasReplay).sort((a, b) => b.score - a.score)); }
  };
  $('#btnSimNext').onclick = () => { const m = T.nextPlayable(S.tour); if (m) sim.run([m.id]); };
  $('#btnSimAvail').onclick = () => sim.run(S.tour.matches.filter(T.isPlayable).map((m) => m.id));
  $('#btnSimAll').onclick = () => sim.run(null);

  // ------------------------------------------------------------ simulation (background workers)
  const sim = {
    busy: false, workers: [], queue: [], inflight: new Map(), all: false, done: 0,
    init() {
      if (this.workers.length || !window.Worker || !/^https?:/.test(location.protocol)) return;
      const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        try {
          const w = new Worker('js/sim-worker.js');
          w.onmessage = (e) => this.finish(w, e.data);
          w.onerror = () => { this.workers = this.workers.filter((x) => x !== w); };
          w.idle = true;
          this.workers.push(w);
        } catch (e) { /* workers unavailable (e.g. file://) */ }
      }
    },
    // ids = specific matches, or null = keep going until the tournament is finished.
    run(ids) {
      if (this.busy) return;
      this.init();
      this.busy = true; this.all = ids === null; this.done = 0;
      this.queue = ids ? ids.slice() : S.tour.matches.filter(T.isPlayable).map((m) => m.id);
      renderToolbar();
      this.pump();
    },
    job(id) {
      const m = S.tour.matches.find((x) => x.id === id);
      return { job: id, teams: [T.gameTeam(S.tour, m.a), T.gameTeam(S.tour, m.b)], settings: T.gameSettings(S.tour, m, true) };
    },
    pump() {
      if (this.all) for (const m of S.tour.matches) if (T.isPlayable(m) && !this.queue.includes(m.id) && !this.inflight.has(m.id)) this.queue.push(m.id);
      if (!this.queue.length && !this.inflight.size) { this.busy = false; renderPlay(); return; }
      $('#simStatus').textContent = `Simulating… ${this.done} done, ${this.inflight.size + this.queue.length} in progress`;
      if (this.workers.length) {
        for (const w of this.workers) {
          if (!w.idle || !this.queue.length) continue;
          const id = this.queue.shift();
          w.idle = false; w.job = id;
          this.inflight.set(id, w);
          w.postMessage(this.job(id));
        }
      } else if (this.queue.length && !this.inflight.size) {
        // No workers (opened from a file): simulate on the page, one match per tick.
        const id = this.queue.shift();
        this.inflight.set(id, null);
        setTimeout(() => {
          const j = this.job(id);
          this.finish(null, { job: id, result: T.simMatch(j.teams, j.settings, { highlights: 5 }) });
        }, 16);
      }
    },
    finish(w, data) {
      if (w) w.idle = true;
      this.inflight.delete(data.job);
      if (data.error) { console.error(data.error); }
      else if (S.tour) {
        stashHighlights(data.result, S.tour.matches.find((m) => m.id === data.job));
        T.applyResult(S.tour, data.job, data.result); this.done++; save();
      }
      renderPlay();
      this.pump();
    },
  };

  // ------------------------------------------------------------ live viewer
  const viewer = {
    renderer: null, game: null, match: null, speed: 1, paused: false, raf: 0, recorded: false, logV: -1,
    open(id) {
      const m = S.tour.matches.find((x) => x.id === id);
      if (!T.isPlayable(m)) return;
      this.match = m;
      this.teams = [T.gameTeam(S.tour, m.a), T.gameTeam(S.tour, m.b)];
      this.game = new VB.Game(this.teams, T.gameSettings(S.tour, m, false), 'tournament');
      VB.HL.attach(this.game, { keep: 5 });
      this.mode = 'live'; $('#vFinish').hidden = false; $('#vNext').hidden = true;
      $('#viewer').hidden = false;
      document.body.style.overflow = 'hidden';
      if (!this.renderer) this.renderer = new VB.Renderer($('#vStage'));
      this.renderer.resize();
      this.renderer.setGame(this.game);
      this.renderer.setCameraMode($('#vCam').value);
      this.recorded = false; this.paused = false; this.logV = -1; this.acc = 0; this.finishing = false;
      $('#vBanner').hidden = true;
      this.syncControls();
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame((t) => this.frame(t));
      $('#vClose').focus();
    },
    // ---- highlight replays
    async openReplay(metas) {
      if (!metas.length) return;
      const list = (await Promise.all(metas.map((m) => VB.HL.store.get(m)))).filter(Boolean);
      if (!list.length) { $('#simStatus').textContent = 'Those replays are no longer saved in this browser.'; return; }
      this.mode = 'replay'; this.reel = list; this.reelPos = -1; this.game = null;
      this.recorded = true; this.paused = false;
      $('#viewer').hidden = false;
      document.body.style.overflow = 'hidden';
      if (!this.renderer) this.renderer = new VB.Renderer($('#vStage'));
      this.renderer.resize();
      this.renderer.setCameraMode($('#vCam').value);
      $('#vFinish').hidden = true;
      $('#vNext').hidden = list.length < 2;
      $('#vLog').innerHTML = list.map((h, i) => `<li data-i="${i}">${i + 1}. ${esc(h.title)} <span class="hl-label">— ${esc(h.label || '')}</span></li>`).join('');
      this.nextReplay();
      this.syncControls();
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame((t) => this.frame(t));
    },
    nextReplay() {
      this.reelPos++;
      const h = this.reel[this.reelPos];
      this.hold = 0;
      if (!h) {
        this.replay = null;
        $('#vBanner').innerHTML = `End of highlights. <button id="vAgain">Watch again</button><button class="primary" id="vDone">Back to tournament</button>`;
        $('#vBanner').hidden = false;
        $('#vAgain').onclick = () => { this.reelPos = -1; this.nextReplay(); };
        $('#vDone').onclick = () => this.close(true);
        return;
      }
      this.replay = new VB.HL.Replay(h);
      VB.C.netTop = h.netTop;
      this.renderer.setGame(this.replay);
      $('#vBanner').innerHTML = `<span class="rb-badge">REPLAY${this.reel.length > 1 ? ` ${this.reelPos + 1}/${this.reel.length}` : ''}</span><span class="flames">${'🔥'.repeat(VB.HL.flames(h.score))}</span> ${esc(h.title)}${h.detail ? `<div class="hl-detail">${esc(h.detail)}</div>` : ''}`;
      $('#vBanner').hidden = false;
      for (const li of $$('#vLog li')) li.style.fontWeight = +li.dataset.i === this.reelPos ? '700' : '';
    },
    replayHud() {
      const h = this.replay.h, sg = h.sgn || [-1, 1];
      const li = sg[0] < 0 ? 0 : 1, ri = 1 - li;
      const set = (side, i) => {
        $('#vSw' + side).style.background = h.teams[i].color;
        $('#vName' + side).textContent = h.teams[i].name;
        $('#vSets' + side).textContent = h.sets[i];
        $('#vPts' + side).textContent = this.replay.t >= h.pointT ? h.after[i] : h.before[i];
        $('#vSrv' + side).classList.remove('on');
      };
      set('A', li); set('B', ri);
      $('#vInfo').textContent = `${h.label || ''} · Set ${h.set}`;
    },
    frame(now) {
      const real = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.mode === 'replay') {
        if (this.replay) {
          if (!this.paused && this.replay.advance(real * this.speed)) { this.hold += real; if (this.hold > 1.2) this.nextReplay(); }
          if (this.replay) {
            this.renderer.render(this.paused ? 0 : real * this.replay.rate(), { speed: 1, showMarkers: false, showNames: $('#vNames').checked });
            this.replayHud();
          }
        }
        this.raf = requestAnimationFrame((t) => this.frame(t));
        return;
      }
      const g = this.game, DT = VB.C.DT;
      if (!this.paused && g.phase !== 'over') {
        this.acc += real * (this.finishing ? 0 : this.speed);
        let n = 0;
        while (this.acc >= DT && n < 4000) { g.update(DT); this.acc -= DT; n++; }
      }
      this.renderer.render(this.paused ? 0 : real, { speed: this.speed, showMarkers: false, showNames: $('#vNames').checked });
      this.hud();
      if (g.phase === 'over' && !this.recorded) this.record();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    },
    hud() {
      const g = this.game, left = g.teams.find((t) => t.sgn < 0), right = g.teams.find((t) => t.sgn > 0);
      const set = (side, t) => {
        $('#vSw' + side).style.background = t.color;
        $('#vName' + side).textContent = t.name;
        $('#vSets' + side).textContent = t.sets;
        $('#vPts' + side).textContent = t.score;
        $('#vSrv' + side).classList.toggle('on', g.serving === t.idx && g.phase !== 'over');
      };
      set('A', left); set('B', right);
      const f = T.formatFor(S.tour, this.match);
      $('#vInfo').textContent = `${this.match.label || ''} · Set ${g.setNo} to ${g.setTarget}${f.playAllSets ? ` · ${f.bestOf} sets` : f.bestOf > 1 ? ` · best of ${f.bestOf}` : ''}`;
      if (g.logVersion !== this.logV) {
        this.logV = g.logVersion;
        $('#vLog').innerHTML = g.log.slice(-120).reverse().map((e) => {
          const t = e.team != null ? g.teams[e.team] : null;
          return `<li class="${e.kind}" style="border-left-color:${t ? t.color : 'transparent'}">${esc(e.kind === 'point' ? e.text.split('  →')[0] + ` (${e.score[0]}–${e.score[1]})` : e.text)}</li>`;
        }).join('');
      }
    },
    record() {
      this.recorded = true;
      const res = T.gameResult(this.game, this.teams);
      res.highlights = this.game.recorder.top(5);
      stashHighlights(res, this.match);
      T.applyResult(S.tour, this.match.id, res);
      save();
      const g = this.game;
      const wt = g.winner;
      $('#vBanner').innerHTML = `${wt ? `🏆 ${esc(wt.name)} win ${wt.sets}–${g.other(wt).sets}` : `Tied ${g.teams[0].sets}–${g.teams[1].sets} on sets`} — result saved. <button class="primary" id="vDone">Back to tournament</button>`;
      $('#vBanner').hidden = false;
      $('#vDone').onclick = () => this.close(true);
      this.finishing = false;
      this.syncControls();
    },
    close(force) {
      if (!force && !this.recorded && !confirm('Leave this match? It has not finished, so no result will be saved.')) return;
      cancelAnimationFrame(this.raf);
      $('#viewer').hidden = true;
      document.body.style.overflow = '';
      this.game = null; this.replay = null; this.mode = 'live';
      VB.C.netTop = S.config.rules.netHeight;
      renderPlay();
    },
    // Fast-forward to the end in timed chunks (keeps going even if the tab isn't being drawn).
    finish() {
      if (this.recorded || this.finishing) return;
      this.finishing = true;
      this.syncControls();
      const step = () => {
        const g = this.game;
        if (!g || this.recorded) return;
        const t0 = performance.now();
        while (g.phase !== 'over' && performance.now() - t0 < 40) for (let i = 0; i < 240; i++) g.update(VB.C.DT);
        if (g.phase === 'over') { this.hud(); this.record(); } else setTimeout(step, 0);
      };
      step();
    },
    syncControls() {
      $('#vPlay').textContent = this.paused ? '▶ Play' : '❚❚ Pause';
      for (const b of $$('#vSpeed button')) b.classList.toggle('on', +b.dataset.s === this.speed);
      $('#vFinish').disabled = this.recorded || this.finishing;
    },
  };
  $('#vPlay').onclick = () => { viewer.paused = !viewer.paused; viewer.syncControls(); };
  for (const b of $$('#vSpeed button')) b.onclick = () => { viewer.speed = +b.dataset.s; viewer.syncControls(); };
  $('#vCam').onchange = (e) => viewer.renderer && viewer.renderer.setCameraMode(e.target.value);
  $('#vFinish').onclick = () => viewer.finish();
  $('#vNext').onclick = () => viewer.mode === 'replay' && viewer.nextReplay();
  $('#vClose').onclick = () => viewer.close(false);
  window.addEventListener('keydown', (e) => {
    if ($('#viewer').hidden) return;
    if (e.key === 'Escape') viewer.close(false);
    else if (e.code === 'Space' && !e.target.closest('button, select')) { e.preventDefault(); viewer.paused = !viewer.paused; viewer.syncControls(); }
  });

  // ------------------------------------------------------------ boot
  window.tourApp = { S, T, sim, viewer, render };
  showTab(S.tab || 'players');
})();

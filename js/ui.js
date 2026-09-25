// DOM user interface: scoreboard, controls, side panel tabs and the team editor.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Casual mode keeps its own saved teams/settings under a separate key prefix.
  const key = (k) => (VB.MODE === 'casual' ? k.replace(/^vb\./, 'vbc.') : k);
  VB.store = {
    get(k, d) { try { const v = localStorage.getItem(key(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const casual = () => VB.MODE === 'casual';
  const fmtHeight = (h) => (casual() ? `${Math.floor(h / 12)}′${h % 12}″` : `${h} cm`);
  const levelDefault = () => (casual() ? 'casual' : VB.store.get('vb.level', 'intermediate'));

  const lastName = (n) => n.split(' ').slice(-1)[0];
  const ZONE_ROLE = { 1: 'RB', 2: 'RF · setter', 3: 'MF', 4: 'LF · hitter', 5: 'LB', 6: 'MB' };

  class UI {
    constructor(app) {
      this.app = app;
      this.logV = -1;
      this.statsV = -1;
      this.tab = VB.store.get('vb.tab', 'log');
      this.bind();
    }

    get game() { return this.app.game; }

    bind() {
      const app = this.app;
      $('#btn-new').onclick = () => app.newMatch();
      $('#btn-play').onclick = () => app.togglePause();
      $('#btn-step').onclick = () => app.step();
      for (const b of $$('#speed-seg button')) b.onclick = () => app.setSpeed(+b.dataset.speed);
      $('#cam-select').onchange = (e) => app.setCamera(e.target.value);
      $('#btn-panel').onclick = () => this.togglePanel();
      for (const b of $$('.tabs button')) b.onclick = () => this.showTab(b.dataset.tab);
      if (VB.store.get('vb.panel', window.innerWidth > 900)) document.body.classList.add('panel-open');
      this.showTab(this.tab);

      // Random-level select
      const rl = $('#rand-level');
      for (const [k, v] of Object.entries(VB.SKILL_LEVELS)) rl.add(new Option(v.label, k));
      rl.value = VB.store.get('vb.level', 'intermediate');
      rl.onchange = () => VB.store.set('vb.level', rl.value);
      $('#btn-random-teams').onclick = () => app.newTeams(VB.randomTeams(casual() ? 'casual' : rl.value));
      if (casual()) rl.closest('label').hidden = true;
      const ml = $('#mode-link');
      ml.href = casual() ? './' : './?mode=casual';
      ml.textContent = casual() ? 'Switch to the competitive version →' : 'Switch to the casual version →';
      $('#btn-edit-teams').onclick = () => this.openEditor();

      // Settings
      const f = $('#settings-form');
      for (const el of $$('[data-casual]')) el.hidden = !casual();
      this.fillSettings();
      f.addEventListener('change', () => {
        const s = {};
        for (const el of f.elements) {
          if (!el.name) continue;
          if (el.type === 'checkbox') s[el.name] = el.checked;
          else s[el.name] = +el.value;
        }
        if (!(s.pointsPerSet >= 1)) s.pointsPerSet = 25;
        if (!(s.finalSetPoints >= 1)) s.finalSetPoints = 15;
        app.updateSettings(s);
      });

      window.addEventListener('keydown', (e) => {
        if (e.target.closest('input, select, textarea, dialog')) return;
        if (e.code === 'Space') { e.preventDefault(); app.togglePause(); }
        else if (e.key === '.') app.step();
        else if (e.key === 'n' || e.key === 'N') app.newMatch();
        else if (e.key === 'p' || e.key === 'P') this.togglePanel();
        else if (e.key === 'c' || e.key === 'C') {
          const sel = $('#cam-select');
          sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
          app.setCamera(sel.value);
        } else if (/^[1-6]$/.test(e.key)) app.setSpeed([0.25, 0.5, 1, 2, 4, 8][+e.key - 1]);
      });
    }

    fillSettings() {
      const f = $('#settings-form'), s = this.app.settings;
      for (const el of f.elements) {
        if (!el.name || !(el.name in s)) continue;
        if (el.type === 'checkbox') el.checked = !!s[el.name];
        else el.value = String(s[el.name]);
      }
    }

    togglePanel() {
      document.body.classList.toggle('panel-open');
      VB.store.set('vb.panel', document.body.classList.contains('panel-open'));
      this.app.renderer.resize();
    }

    showTab(tab) {
      this.tab = tab;
      VB.store.set('vb.tab', tab);
      for (const b of $$('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
      for (const s of $$('.tab-body')) s.hidden = s.id !== 'tab-' + tab;
      this.statsV = -1;
    }

    reset() { this.logV = -1; this.statsV = -1; }

    syncControls() {
      const app = this.app;
      $('#btn-play').textContent = app.paused ? '▶ Play' : '❚❚ Pause';
      for (const b of $$('#speed-seg button')) b.classList.toggle('on', +b.dataset.speed === app.speed);
    }

    // ---------------------------------------------------------- per frame
    update() {
      const g = this.game;
      if (!g) return;
      const left = g.teams.find((t) => t.sgn < 0), right = g.teams.find((t) => t.sgn > 0);
      const fillTeam = (el, t) => {
        $('.sb-swatch', el).style.background = t.color;
        $('.sb-name', el).textContent = t.name;
        $('.sb-serve', el).classList.toggle('on', g.serving === t.idx && g.phase !== 'over');
      };
      fillTeam($('#sb-a'), left);
      fillTeam($('#sb-b'), right);
      $('#sb-score-a').textContent = left.score;
      $('#sb-score-b').textContent = right.score;
      $('#sb-sets-a').textContent = left.sets;
      $('#sb-sets-b').textContent = right.sets;
      const s = g.settings;
      $('#sb-info').textContent = (casual() ? 'Casual · ' : '') + (g.phase === 'over' ? 'Final' : `Set ${g.setNo}${g.isDecidingSet ? ' (deciding)' : ''} · to ${g.setTarget}${s.winBy2 ? ', win by 2' : ''}`);
      this.updateBanner();
      if (g.logVersion !== this.logV) { this.logV = g.logVersion; this.renderLog(); }
      if (g.statsVersion !== this.statsV) {
        this.statsV = g.statsVersion;
        if (this.tab === 'box') this.renderBox();
        if (this.tab === 'teams') this.renderTeams();
      }
    }

    updateBanner() {
      const g = this.game, el = $('#banner');
      let html = '';
      if (g.phase === 'over' && g.winner) {
        const l = g.other(g.winner);
        html = `🏆 ${esc(g.winner.name)} win ${g.winner.sets}–${l.sets} <button class="primary" data-act="new">New match</button>`;
      } else if (g.phase === 'setbreak') {
        const a = g.teams[0], b = g.teams[1];
        const i = a.setScores.length - 1;
        const w = a.setScores[i] > b.setScores[i] ? a : b;
        html = `${esc(w.name)} take set ${g.setNo} (${Math.max(a.setScores[i], b.setScores[i])}–${Math.min(a.setScores[i], b.setScores[i])})${this.app.settings.switchSides ? ' · teams switch sides' : ''}`;
      } else if (g.phase === 'dead') {
        const last = g.log[g.log.length - 1];
        if (last && (last.kind === 'point' || last.kind === 'info')) html = esc(last.text.split('  →')[0]);
      }
      if (html !== this.bannerHtml) {
        this.bannerHtml = html;
        el.innerHTML = html;
        el.hidden = !html;
        const btn = el.querySelector('[data-act=new]');
        if (btn) btn.onclick = () => this.app.newMatch();
      }
    }

    renderLog() {
      const g = this.game;
      const items = g.log.slice(-250).reverse();
      $('#log').innerHTML = items.map((e) => {
        const t = e.team != null ? g.teams[e.team] : null;
        const color = t ? t.color : 'transparent';
        const sc = e.kind === 'point' ? `<span class="sc">S${e.set} · ${e.score[0]}–${e.score[1]}</span>` : '';
        const text = e.kind === 'point' ? e.text.split('  →')[0] : e.text;
        return `<li class="${e.kind}" style="border-left-color:${color}">${sc}${esc(text)}</li>`;
      }).join('');
    }

    renderBox() {
      const g = this.game;
      const cols = ['#', 'Player', 'Pts', 'K', 'E', 'TA', 'Hit%', 'A', 'SA', 'SE', 'RE', 'Dig', 'BS', 'BA'];
      const fmtPct = (k, e, ta) => (ta ? ((k - e) / ta).toFixed(3).replace(/^0/, '').replace(/^-0/, '-') : '—');
      const html = g.teams.map((t) => {
        const tot = { k: 0, e: 0, ta: 0, a: 0, sa: 0, se: 0, re: 0, dig: 0, bs: 0, ba: 0, pts: 0 };
        const rows = t.players.map((p) => {
          const b = p.box;
          const pts = b.k + b.sa + b.bs + b.ba * 0.5;
          for (const k of Object.keys(tot)) tot[k] += k === 'pts' ? pts : b[k];
          return `<tr><td>${p.number}</td><td>${esc(lastName(p.name))}</td><td>${pts}</td><td>${b.k}</td><td>${b.e}</td><td>${b.ta}</td><td>${fmtPct(b.k, b.e, b.ta)}</td><td>${b.a}</td><td>${b.sa}</td><td>${b.se}</td><td>${b.re}</td><td>${b.dig}</td><td>${b.bs}</td><td>${b.ba}</td></tr>`;
        }).join('');
        const T = tot;
        return `<div class="box-team"><h3><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</h3>
          <div class="tbl-wrap"><table class="box"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${rows}<tr class="tot"><td></td><td>Team</td><td>${T.pts}</td><td>${T.k}</td><td>${T.e}</td><td>${T.ta}</td><td>${fmtPct(T.k, T.e, T.ta)}</td><td>${T.a}</td><td>${T.sa}</td><td>${T.se}</td><td>${T.re}</td><td>${T.dig}</td><td>${T.bs}</td><td>${T.ba}</td></tr></tbody></table></div></div>`;
      }).join('');
      $('#boxscore').innerHTML = html + `<p class="legend">K kills · E attack errors (incl. blocked, net faults) · TA attack attempts · A assists · SA aces · SE service errors · RE reception errors · BS solo blocks · BA block assists</p>`;
    }

    renderTeams() {
      const g = this.game;
      $('#team-summaries').innerHTML = g.teams.map((t) => {
        const cell = (z) => {
          const p = t.at(z);
          const role = casual() ? (p === t.setter() ? 'setting' : z >= 2 && z <= 4 ? 'front' : 'back') : ZONE_ROLE[z];
          return `<div${casual() && p === t.setter() ? ' class="setter"' : ''}><b>${p.number}</b>${esc(lastName(p.name))}<br><small>${role}</small></div>`;
        };
        const roster = t.players.map((p, i) => `<tr><td class="num">P${i + 1}</td><td>#${p.number} ${esc(p.name)}</td><td class="num">${fmtHeight(p.data.height)}</td><td class="num"><b>${VB.overall(p.data)}</b> OVR</td></tr>`).join('');
        const know = casual() ? `<p class="hint">Knows its roles: <b>${Math.round(t.knowledge * 100)}%</b> (from team awareness). Setting this rotation: #${t.setter().number} ${esc(lastName(t.setter().name))}.</p>` : '';
        return `<div class="team-sum"><h3><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</h3>${know}
          <div class="rot"><div class="net"></div>${cell(4)}${cell(3)}${cell(2)}${cell(5)}${cell(6)}${cell(1)}</div>
          <table class="roster">${roster}</table></div>`;
      }).join('') + `<p class="hint">Rotation shows current court positions (net at top). Teams rotate clockwise each time they win the serve back.${casual() ? ' Casual teams pick a setter each rotation — teams with better awareness usually pick their best setter and set their best hitters.' : ''}</p>`;
    }

    // ---------------------------------------------------------- editor
    openEditor() {
      this.draft = JSON.parse(JSON.stringify(this.app.teamsData));
      this.renderEditor();
      const dlg = $('#editor');
      dlg.returnValue = '';
      dlg.showModal();
      dlg.onclose = () => {
        if (dlg.returnValue === 'apply') {
          this.readEditor();
          this.app.newTeams(this.draft);
        }
      };
    }

    renderEditor() {
      const keys = VB.STAT_KEYS;
      const levels = Object.entries(VB.SKILL_LEVELS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
      const cz = casual();
      const smin = cz ? 0 : 1, smax = cz ? 10 : 99;
      const hmin = cz ? 54 : 150, hmax = cz ? 86 : 225;
      const posLabels = cz ? VB.CASUAL_POSITION_LABELS : VB.POSITION_LABELS;
      $('#editor .ed-head .hint').textContent = cz
        ? 'Rows are the starting rotation (P1 serves first). Positions are loose — each rotation the team decides who sets, based on its awareness. Ratings are 0–10; heights are in inches.'
        : 'Rows are the starting rotation: P1 serves first, P2 (right front) usually sets, P4 (left front) usually hits. Any player can play any role. Ratings are 1–99.';
      const wrap = $('#editor-teams');
      wrap.innerHTML = this.draft.map((t, ti) => `
        <div class="ed-team" data-team="${ti}">
          <div class="ed-team-head">
            <input type="color" data-f="color" value="${esc(t.color)}" aria-label="Team colour">
            <input type="text" data-f="name" value="${esc(t.name)}" aria-label="Team name" maxlength="40">
            <select data-f="level" aria-label="Random level" ${cz ? 'hidden' : ''}>${levels}</select>
            <button type="button" data-act="rand-team">🎲 Randomize team</button>
            <button type="button" data-act="auto-lineup" title="Reorder players into positions by their strengths">Auto lineup</button>
          </div>
          <div class="tbl-wrap"><table class="ed">
            <thead><tr><th>Pos</th><th>#</th><th>Name</th><th>Ht ${cz ? 'in' : 'cm'}</th>${keys.map((k) => `<th title="${k}">${VB.STAT_LABELS[k]}</th>`).join('')}<th>OVR</th><th></th></tr></thead>
            <tbody>${t.players.map((p, i) => `
              <tr data-p="${i}">
                <td class="pos">${posLabels[i]}</td>
                <td><input type="number" data-k="number" min="0" max="99" value="${p.number}"></td>
                <td><input type="text" class="nm" data-k="name" value="${esc(p.name)}" maxlength="30"></td>
                <td><input type="number" data-k="height" min="${hmin}" max="${hmax}" value="${p.height}" title="${fmtHeight(p.height)}"></td>
                ${keys.map((k) => `<td><input type="number" data-s="${k}" min="${smin}" max="${smax}" value="${p.stats[k]}"></td>`).join('')}
                <td class="ovr">${VB.overall(p)}</td>
                <td><button type="button" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-act="down" title="Move down" ${i === 5 ? 'disabled' : ''}>↓</button><button type="button" data-act="rand-p" title="Randomize player">🎲</button></td>
              </tr>`).join('')}
            </tbody></table></div>
        </div>`).join('');
      if (!cz) for (const sel of $$('select[data-f=level]', wrap)) sel.value = VB.store.get('vb.level', 'intermediate');
      wrap.oninput = (e) => {
        const tr = e.target.closest('tr[data-p]');
        if (tr) {
          this.readEditor();
          const ti = +tr.closest('.ed-team').dataset.team;
          $('.ovr', tr).textContent = VB.overall(this.draft[ti].players[+tr.dataset.p]);
        }
      };
      wrap.onclick = (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        this.readEditor();
        const teamEl = btn.closest('.ed-team'), ti = +teamEl.dataset.team;
        const team = this.draft[ti];
        const level = casual() ? 'casual' : $('select[data-f=level]', teamEl).value;
        if (!casual()) VB.store.set('vb.level', level);
        const tr = btn.closest('tr[data-p]');
        const pi = tr ? +tr.dataset.p : -1;
        switch (btn.dataset.act) {
          case 'rand-team': {
            const nt = VB.randomTeam(level, team.name, team.color);
            team.players = nt.players;
            break;
          }
          case 'auto-lineup': team.players = VB.arrangeLineup(team.players); break;
          case 'up': [team.players[pi - 1], team.players[pi]] = [team.players[pi], team.players[pi - 1]]; break;
          case 'down': [team.players[pi + 1], team.players[pi]] = [team.players[pi], team.players[pi + 1]]; break;
          case 'rand-p': team.players[pi] = Object.assign(VB.randomPlayer(level, team.players[pi].number), {}); break;
        }
        this.renderEditor();
      };
    }

    readEditor() {
      const clampN = (v, a, b, d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d);
      for (const teamEl of $$('#editor-teams .ed-team')) {
        const t = this.draft[+teamEl.dataset.team];
        t.name = $('input[data-f=name]', teamEl).value.trim() || t.name;
        t.color = $('input[data-f=color]', teamEl).value;
        for (const tr of $$('tr[data-p]', teamEl)) {
          const p = t.players[+tr.dataset.p];
          p.name = $('input[data-k=name]', tr).value.trim() || p.name;
          p.number = clampN(+$('input[data-k=number]', tr).value, 0, 99, p.number);
          const cz = casual();
          p.height = clampN(+$('input[data-k=height]', tr).value, cz ? 54 : 150, cz ? 86 : 225, p.height);
          for (const inp of $$('input[data-s]', tr)) p.stats[inp.dataset.s] = clampN(+inp.value, cz ? 0 : 1, cz ? 10 : 99, p.stats[inp.dataset.s]);
        }
      }
    }
  }

  VB.UI = UI;
})();

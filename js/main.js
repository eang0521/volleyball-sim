// App bootstrap and the fixed-timestep simulation loop.
(function () {
  const { store } = VB;
  VB.MODE = new URLSearchParams(location.search).get('mode') === 'casual' || document.body.dataset.mode === 'casual' ? 'casual' : 'competitive';
  const CASUAL = VB.MODE === 'casual';
  if (CASUAL) { document.title = 'Volleyball Sim — Casual'; document.body.classList.add('casual'); }
  const statMax = CASUAL ? 10 : 99;

  function validTeams(d) {
    return Array.isArray(d) && d.length === 2 && d.every((t) => t && t.name && Array.isArray(t.players) && t.players.length === 6 &&
      t.players.every((p) => p && p.name && p.stats && Number.isFinite(p.height) && Object.values(p.stats).every((v) => v <= statMax)));
  }

  const app = {
    settings: Object.assign({}, VB.DEFAULT_SETTINGS, CASUAL ? { bestOf: 3, netHeight: 2.35 } : {}, { showMarkers: false }, store.get('vb.settings', {})),
    teamsData: null,
    paused: false,
    speed: 1,
    acc: 0,
    game: null,

    newMatch() {
      this.game = new VB.Game(this.teamsData, this.settings, VB.MODE);
      this.renderer.setGame(this.game);
      this.ui.reset();
      this.acc = 0;
    },
    newTeams(data) {
      this.teamsData = data;
      store.set('vb.teams', data);
      this.newMatch();
    },
    updateSettings(s) {
      Object.assign(this.settings, s);
      store.set('vb.settings', this.settings);
      if (this.game) {
        const prevFront = this.game.settings.frontRowSetter;
        Object.assign(this.game.settings, s);
        VB.C.netTop = this.settings.netHeight;
        if (prevFront !== this.game.settings.frontRowSetter) for (const t of this.game.teams) this.game.pickSetter(t);
      }
    },
    togglePause() { this.paused = !this.paused; this.ui.syncControls(); },
    setSpeed(v) { this.speed = v; this.ui.syncControls(); },
    step() {
      if (!this.paused) { this.paused = true; this.ui.syncControls(); }
      this.pendingStep = true;
    },
    setCamera(m) { this.renderer.setCameraMode(m); store.set('vb.camera', m); },
  };

  const saved = store.get('vb.teams', null);
  app.teamsData = validTeams(saved) ? saved : VB.randomTeams(CASUAL ? 'casual' : store.get('vb.level', 'intermediate'));
  app.renderer = new VB.Renderer(document.getElementById('stage'));
  app.ui = new VB.UI(app);
  window.app = app;
  app.newMatch();
  const cam = store.get('vb.camera', 'broadcast');
  document.getElementById('cam-select').value = cam;
  app.setCamera(cam);
  app.ui.syncControls();

  const DT = VB.C.DT;
  let last = performance.now();
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    let simDt = 0;
    if (!app.paused) {
      app.acc += real * app.speed;
      let n = 0;
      while (app.acc >= DT && n < 4000) { app.game.update(DT); app.acc -= DT; n++; simDt += DT; }
    } else if (app.pendingStep) {
      app.pendingStep = false;
      for (let i = 0; i < 4; i++) { app.game.update(DT); simDt += DT; }
    }
    app.renderer.render(app.paused ? simDt : real, { speed: app.paused ? 1 : app.speed, showMarkers: app.settings.showMarkers });
    app.ui.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// Three.js rendering of the court, net, players and ball. Reads Game state; never mutates it.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const C = VB.C;
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

  // Arm poses: [pitch, spreadOut] per arm (negative pitch swings the arm forward/up).
  const POSES = {
    idle: { L: [-0.05, 0.08], R: [-0.05, 0.08], crouch: 0 },
    ready: { L: [-0.55, 0.12], R: [-0.55, 0.12], crouch: 0.35 },
    bump: { L: [-0.9, -0.24], R: [-0.9, -0.24], crouch: 0.7 },
    set: { L: [-2.6, 0.38], R: [-2.6, 0.38], crouch: 0.2 },
    approach: { L: [0.8, 0.15], R: [0.8, 0.15], crouch: 0.4 },
    spikeWind: { L: [-2.6, 0.12], R: [-3.5, 0.3], crouch: 0 },
    spike: { L: [-0.5, 0.1], R: [-0.9, 0.05], crouch: 0 },
    block: { L: [-3.05, 0.08], R: [-3.05, 0.08], crouch: 0 },
    toss: { L: [-2.7, 0.05], R: [-2.2, 0.5], crouch: 0 },
    serveHit: { L: [-0.5, 0.1], R: [-2.95, 0.12], crouch: 0 },
    dive: { L: [-1.6, -0.1], R: [-1.6, -0.1], crouch: 0 },
    celebrate: { L: [-2.9, 0.5], R: [-2.9, 0.5], crouch: 0 },
  };

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function shade(hex, f) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(f);
    return c;
  }

  function jerseyTex(num, color, big) {
    return canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = color; g.fillRect(0, 0, w, h);
      const lum = new THREE.Color(color);
      const light = lum.r * 0.3 + lum.g * 0.59 + lum.b * 0.11 > 0.6;
      g.fillStyle = light ? '#111' : '#fff';
      g.font = `bold ${big ? 72 : 52}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), w / 2, h / 2 + 4);
    });
  }

  class PlayerView {
    constructor(p, scene) {
      this.p = p;
      const H = p.H;
      const g = (this.group = new THREE.Group());
      this.pivot = new THREE.Group(); // tilts for dives
      g.add(this.pivot);
      const bodyW = 0.25 * H, bodyD = 0.14 * H;
      const shoulder = (this.shoulder = 0.82 * H);
      const hip = 0.46 * H;
      const color = p.team.color;
      // Legs / shorts prism
      const legs = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.9, hip, bodyD * 0.9), new THREE.MeshStandardMaterial({ color: shade(color, 0.35), roughness: 0.8 }));
      legs.position.y = hip / 2;
      // Torso prism with numbers on each face
      const side = new THREE.MeshStandardMaterial({ map: jerseyTex(p.number, color, false), roughness: 0.7 });
      const back = new THREE.MeshStandardMaterial({ map: jerseyTex(p.number, color, true), roughness: 0.7 });
      const plain = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(bodyW, shoulder - hip, bodyD), [side, side, plain, plain, side, back]);
      torso.position.y = hip + (shoulder - hip) / 2;
      this.torso = torso;
      const skinMat = new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.6 });
      const headR = 0.065 * H;
      const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 14), skinMat);
      head.position.y = shoulder + 0.03 * H + headR;
      this.upper = new THREE.Group();
      this.upper.add(torso, head);
      this.pivot.add(legs, this.upper);
      // Arms
      const armLen = (this.armLen = 0.47 * H);
      const armGeo = new THREE.CylinderGeometry(0.032, 0.028, armLen, 8);
      armGeo.translate(0, -armLen / 2, 0);
      const handGeo = new THREE.SphereGeometry(0.04, 8, 6);
      const makeArm = (sgn) => {
        const piv = new THREE.Group();
        piv.position.set(sgn * (bodyW / 2 + 0.035), shoulder - 0.04, 0);
        const sleeve = new THREE.Mesh(armGeo, skinMat);
        const hand = new THREE.Mesh(handGeo, skinMat);
        hand.position.y = -armLen;
        piv.add(sleeve, hand);
        this.upper.add(piv);
        piv.userData.sgn = sgn;
        return piv;
      };
      this.armL = makeArm(1); // player's left = local +x
      this.armR = makeArm(-1);
      this.cur = { L: [0, 0.08], R: [0, 0.08], crouch: 0, tilt: 0 };
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
      // Highlight ring (shows the player the AI has assigned to the ball)
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.visible = false;
      scene.add(this.ring);
      scene.add(g);
    }

    update(dt, game, showRing) {
      const p = this.p;
      this.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.group.rotation.y = p.facing;
      const pose = POSES[p.pose] || POSES.ready;
      const rate = p.pose === 'spike' || p.pose === 'serveHit' ? 30 : p.pose === 'bump' || p.pose === 'set' || p.pose === 'block' ? 16 : 9;
      const k = 1 - Math.exp(-rate * dt);
      const c = this.cur;
      for (const side of ['L', 'R']) {
        c[side][0] += (pose[side][0] - c[side][0]) * k;
        c[side][1] += (pose[side][1] - c[side][1]) * k;
      }
      c.crouch += (pose.crouch - c.crouch) * k;
      const tiltT = p.pose === 'dive' ? 1.25 : 0;
      c.tilt += (tiltT - c.tilt) * (1 - Math.exp(-10 * dt));
      this.armL.rotation.set(c.L[0], 0, c.L[1]);
      this.armR.rotation.set(c.R[0], 0, -c.R[1]);
      const sq = 1 - 0.1 * c.crouch;
      this.pivot.scale.set(1, sq, 1);
      this.pivot.rotation.x = c.tilt;
      this.pivot.position.z = c.tilt * 0.25;
      this.ring.visible = showRing;
      if (showRing) this.ring.position.set(p.pos.x, 0.015, p.pos.z);
    }

    dispose(scene) {
      scene.remove(this.group);
      scene.remove(this.ring);
      this.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
    }
  }

  class Renderer {
    constructor(container) {
      this.container = container;
      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.outputEncoding = THREE.sRGBEncoding;
      container.appendChild(r.domElement);
      const scene = (this.scene = new THREE.Scene());
      scene.background = new THREE.Color(0x0c1422);
      scene.fog = new THREE.Fog(0x0c1422, 30, 60);
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
      this.cameraMode = 'broadcast';
      this.camTarget = new THREE.Vector3(0, 1.2, 0);
      this.camPos = new THREE.Vector3(0, 8.5, 17.5);
      this.controls = new THREE.OrbitControls(this.camera, r.domElement);
      this.controls.enabled = false;
      this.controls.target.set(0, 1, 0);
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
      this.controls.minDistance = 4;
      this.controls.maxDistance = 45;

      scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2016, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 0.85);
      sun.position.set(4, 18, 9);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -15; sc.right = 15; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 40;
      sun.shadow.bias = -0.0005;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xbcd0ff, 0.25);
      fill.position.set(-6, 10, -8);
      scene.add(fill);

      this.buildArena();
      this.netGroup = new THREE.Group();
      scene.add(this.netGroup);
      this.buildNet(C.netTop);
      this.buildBall();
      this.playerViews = [];
      // Landing marker
      this.marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false }));
      this.marker.rotation.x = -Math.PI / 2;
      this.marker.visible = false;
      scene.add(this.marker);

      window.addEventListener('resize', () => this.resize());
      this.resize();
    }

    buildArena() {
      const s = this.scene;
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x1d4e7a, roughness: 0.85 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      s.add(floor);
      const court = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshStandardMaterial({ color: 0xd7864c, roughness: 0.7 }));
      court.rotation.x = -Math.PI / 2;
      court.position.y = 0.002;
      court.receiveShadow = true;
      s.add(court);
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f0 });
      const line = (w, d, x, z) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.004, z);
        m.receiveShadow = true;
        s.add(m);
      };
      const lw = 0.05;
      line(18, lw, 0, 4.5 - lw / 2); line(18, lw, 0, -4.5 + lw / 2); // sidelines
      line(lw, 9, 9 - lw / 2, 0); line(lw, 9, -9 + lw / 2, 0); // end lines
      line(lw, 9, 0, 0); // centre line
      line(lw, 9, 3 - lw / 2, 0); line(lw, 9, -3 + lw / 2, 0); // attack lines
      // Dashed attack-line extensions
      for (const x of [3 - lw / 2, -3 + lw / 2]) for (const zs of [1, -1]) for (let i = 0; i < 5; i++) line(lw, 0.15, x, zs * (4.5 + 0.2 + i * 0.35));
      // Surrounding gym: bleachers for depth
      const standMat = new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.95 });
      const seatMat = new THREE.MeshStandardMaterial({ color: 0x2f4461, roughness: 0.9 });
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(30, 0.45, 0.8), i % 2 ? standMat : seatMat);
        b.position.set(0, 0.22 + i * 0.45, -10.5 - i * 0.8);
        b.receiveShadow = true;
        s.add(b);
      }
      for (const sx of [1, -1]) for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 16), i % 2 ? standMat : seatMat);
        b.position.set(sx * (15.5 + i * 0.8), 0.22 + i * 0.45, 0);
        s.add(b);
      }
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({ color: 0x141e2e, roughness: 1 }));
      wall.position.set(0, 8, -15.5);
      s.add(wall);
      // Referee stand
      const ref = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x555b66 }));
      ref.position.set(0, 0.75, -5.8);
      ref.castShadow = true;
      s.add(ref);
    }

    buildNet(top) {
      const g = this.netGroup;
      while (g.children.length) {
        const c = g.children.pop();
        c.geometry && c.geometry.dispose();
      }
      const postMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.4, roughness: 0.4 });
      for (const z of [5.2, -5.2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top + 0.25, 12), postMat);
        post.position.set(0, (top + 0.25) / 2, z);
        post.castShadow = true;
        g.add(post);
      }
      const meshTex = canvasTex(64, 64, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.strokeStyle = 'rgba(20,20,20,0.9)';
        c.lineWidth = 3;
        c.strokeRect(0, 0, w, h);
      });
      meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
      meshTex.repeat.set(100, 10);
      const net = new THREE.Mesh(new THREE.PlaneGeometry(10.4, C.NET_DEPTH), new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      net.rotation.y = Math.PI / 2;
      net.position.set(0, top - C.NET_DEPTH / 2, 0);
      g.add(net);
      const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 10.4), tapeMat);
      tape.position.set(0, top - 0.035, 0);
      tape.castShadow = true;
      g.add(tape);
      const btape = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 10.4), tapeMat);
      btape.position.set(0, top - C.NET_DEPTH + 0.025, 0);
      g.add(btape);
      for (const z of [4.5, -4.5]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.014, C.NET_DEPTH, 0.05), tapeMat);
        band.position.set(0, top - C.NET_DEPTH / 2, z);
        g.add(band);
      }
      const antTex = canvasTex(8, 128, (c, w, h) => {
        for (let i = 0; i < 18; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#e02020'; c.fillRect(0, (i * h) / 18, w, h / 18 + 1); }
      });
      const antLen = C.NET_DEPTH + C.ANTENNA_H;
      for (const z of [C.ANTENNA_Z, -C.ANTENNA_Z]) {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, antLen, 8), new THREE.MeshStandardMaterial({ map: antTex }));
        a.position.set(0, top - C.NET_DEPTH + antLen / 2, z);
        a.castShadow = true;
        g.add(a);
      }
      // Cable
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 10.4, 6), postMat);
      cable.rotation.x = Math.PI / 2;
      cable.position.set(0, top, 0);
      g.add(cable);
      this.netTop = top;
    }

    buildBall() {
      const tex = canvasTex(256, 128, (c, w, h) => {
        const cols = ['#f6d33c', '#1f5fbf', '#f7f7f2'];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x += 2) {
            const u = x / w, v = y / h;
            const band = Math.floor((v * 3 + 0.18 * Math.sin(u * Math.PI * 6)) % 3 + 3) % 3;
            c.fillStyle = cols[band];
            c.fillRect(x, y, 2, 1);
          }
        }
        c.strokeStyle = 'rgba(0,0,0,0.25)';
        c.lineWidth = 1.5;
        for (let k = 1; k < 3; k++) {
          c.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const y = (h / 3) * (k - 0.18 * Math.sin((x / w) * Math.PI * 6));
            x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
          }
          c.stroke();
        }
      });
      tex.encoding = THREE.sRGBEncoding;
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(C.R, 28, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
      this.ball.castShadow = true;
      this.scene.add(this.ball);
    }

    setGame(game) {
      for (const v of this.playerViews) v.dispose(this.scene);
      this.game = game;
      this.playerViews = game.allPlayers.map((p) => new PlayerView(p, this.scene));
      if (Math.abs(this.netTop - C.netTop) > 1e-3) this.buildNet(C.netTop);
    }

    setCameraMode(mode) {
      this.cameraMode = mode;
      this.controls.enabled = mode === 'orbit';
      if (mode === 'orbit') {
        this.controls.target.copy(this.camTarget);
        this.controls.update();
      }
    }

    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // Pull the camera back on narrow screens so the whole court fits.
      const vfov = (this.camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      this.fit = VB.clamp(12.5 / Math.tan(hfov / 2) / 19.5, 1, 2.4);
      this.scene.fog.near = 30 * this.fit;
      this.scene.fog.far = 60 * this.fit;
    }

    render(dt, opts) {
      const game = this.game;
      if (!game) return;
      if (Math.abs(this.netTop - C.netTop) > 1e-3) this.buildNet(C.netTop);
      const b = game.ball;
      this.ball.position.set(b.pos.x, b.pos.y, b.pos.z);
      const w = Math.hypot(b.spin.x, b.spin.y, b.spin.z);
      if (w > 1e-3) {
        const axis = new THREE.Vector3(b.spin.x / w, b.spin.y / w, b.spin.z / w);
        this.ball.rotateOnWorldAxis(axis, w * dt * opts.speed);
      }
      const planned = new Set();
      if (opts.showMarkers) for (const t of game.teams) {
        if (t.ai.plan) planned.add(t.ai.plan.player);
        if (t.ai.hit) planned.add(t.ai.hit.player);
      }
      for (const v of this.playerViews) v.update(dt * Math.max(opts.speed, 0.25), game, planned.has(v.p));
      const land = game.phase === 'rally' && game.path && game.path.land;
      this.marker.visible = !!(opts.showMarkers && land);
      if (land) this.marker.position.set(land.x, 0.012, land.z);

      // Camera
      const f = this.fit || 1;
      if (this.cameraMode === 'broadcast') {
        this.camPos.set(0, 8.2 * f, 17.5 * f);
        this.camTarget.set(0, 1.0, 0);
        this.camera.position.lerp(this.camPos, 1 - Math.exp(-4 * dt));
        this.camera.lookAt(this.camTarget);
      } else if (this.cameraMode === 'follow') {
        const bx = VB.clamp(b.pos.x, -11, 11);
        const k = 1 - Math.exp(-2.2 * dt);
        this.camPos.set(bx * 0.45, 7.2 * f, 15 * f);
        this.camera.position.lerp(this.camPos, k);
        this.camTarget.lerp(new THREE.Vector3(bx * 0.6, 1.3, 0), k);
        this.camera.lookAt(this.camTarget);
      } else if (this.cameraMode === 'baseline') {
        const side = game.teams[0].sgn;
        this.camPos.set(side * 16 * f, 5.5, 0);
        this.camera.position.lerp(this.camPos, 1 - Math.exp(-4 * dt));
        this.camTarget.set(-side * 2, 1.2, 0);
        this.camera.lookAt(this.camTarget);
      } else {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  VB.Renderer = Renderer;
})();

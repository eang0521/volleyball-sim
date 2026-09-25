// Shared math + random helpers. No DOM / THREE dependencies so the sim can run headless in Node.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new V3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    len() { return Math.hypot(this.x, this.y, this.z); }
    lenXZ() { return Math.hypot(this.x, this.z); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    normalize() { const l = this.len() || 1; return this.scale(1 / l); }
    dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    distXZ(v) { return Math.hypot(this.x - v.x, this.z - v.z); }
  }

  const rand = Math.random;
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const randRange = (a, b) => a + (b - a) * rand();
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Wrap an angle into [-PI, PI].
  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  Object.assign(VB, { V3, rand, gauss, clamp, lerp, pick, randRange, shuffle, wrapAngle });
})();

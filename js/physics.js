// Ball physics: gravity, quadratic air drag, Magnus force (topspin/backspin), float wobble.
// Also a trajectory predictor and a "shooting" solver that finds the launch velocity needed to
// send the ball from A to B in a given flight time under the same physics.
var VB = globalThis.VB || (globalThis.VB = {});

(function () {
  const C = (VB.C = {
    G: 9.81,
    DT: 1 / 240,
    R: 0.105, // ball radius (m)
    DRAG_K: 0.023, // 0.5*rho*Cd*A/m with Cd ~0.3
    MAGNUS_K: 0.006, // lift per (rad/s * m/s)
    HALF_L: 9, // court is 18 x 9; net at x = 0
    HALF_W: 4.5,
    ATTACK_LINE: 3,
    NET_DEPTH: 1.0, // vertical height of the net mesh
    ANTENNA_Z: 4.55,
    ANTENNA_H: 0.8,
    NET_HALF_WIDTH: 5.0,
    netTop: 2.43,
  });

  const { G, DT, R, DRAG_K, MAGNUS_K } = C;

  // One semi-implicit Euler step on plain numbers. s = [px,py,pz,vx,vy,vz], spin = V3-like.
  function stepArr(s, sp, dt, ax0, ay0, az0) {
    const vx = s[3], vy = s[4], vz = s[5];
    const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const ax = -DRAG_K * v * vx + MAGNUS_K * (sp.y * vz - sp.z * vy) + (ax0 || 0);
    const ay = -G - DRAG_K * v * vy + MAGNUS_K * (sp.z * vx - sp.x * vz) + (ay0 || 0);
    const az = -DRAG_K * v * vz + MAGNUS_K * (sp.x * vy - sp.y * vx) + (az0 || 0);
    s[3] += ax * dt; s[4] += ay * dt; s[5] += az * dt;
    s[0] += s[3] * dt; s[1] += s[4] * dt; s[2] += s[5] * dt;
  }

  const ZERO = { x: 0, y: 0, z: 0 };
  const tmp = new Float64Array(6);

  // Position after flying for T seconds (no collisions).
  function simulate(p0, v0, spin, T, out) {
    tmp[0] = p0.x; tmp[1] = p0.y; tmp[2] = p0.z; tmp[3] = v0.x; tmp[4] = v0.y; tmp[5] = v0.z;
    spin = spin || ZERO;
    const n = Math.floor(T / DT);
    for (let i = 0; i < n; i++) stepArr(tmp, spin, DT);
    const rem = T - n * DT;
    if (rem > 1e-6) stepArr(tmp, spin, rem);
    out = out || new VB.V3();
    return out.set(tmp[0], tmp[1], tmp[2]);
  }

  // Find v0 such that the ball reaches `target` exactly T seconds after leaving p0.
  function solveLaunch(p0, target, T, spin) {
    const v = new VB.V3(
      (target.x - p0.x) / T,
      (target.y - p0.y + 0.5 * G * T * T) / T,
      (target.z - p0.z) / T
    );
    const end = new VB.V3();
    for (let i = 0; i < 14; i++) {
      simulate(p0, v, spin, T, end);
      const ex = target.x - end.x, ey = target.y - end.y, ez = target.z - end.z;
      if (ex * ex + ey * ey + ez * ez < 1e-4) break;
      // Drag makes the ball fall short, so over-correct slightly.
      v.x += (ex / T) * 1.1; v.y += (ey / T) * 1.1; v.z += (ez / T) * 1.1;
    }
    return v;
  }

  // Predict the ball path from the current state until it reaches the floor (or maxT).
  // Ignores net/players; the game re-predicts after every collision event.
  function predict(p, v, spin, t0, maxT = 6) {
    const max = Math.ceil(maxT / DT) + 2;
    const path = {
      t0, n: 0,
      x: new Float64Array(max), y: new Float64Array(max), z: new Float64Array(max),
      vx: new Float64Array(max), vy: new Float64Array(max), vz: new Float64Array(max),
      land: null,
    };
    const s = new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z]);
    spin = spin || ZERO;
    let i = 0;
    for (; i < max; i++) {
      path.x[i] = s[0]; path.y[i] = s[1]; path.z[i] = s[2];
      path.vx[i] = s[3]; path.vy[i] = s[4]; path.vz[i] = s[5];
      if (s[1] <= R && s[4] < 0 && i > 0) {
        path.land = { t: t0 + i * DT, x: s[0], z: s[2] };
        i++;
        break;
      }
      stepArr(s, spin, DT);
    }
    path.n = i;
    return path;
  }

  // Where does the path cross the net plane (x = 0)?  Returns {i, t, y, z} or null.
  function netCrossing(path, fromIndex = 0) {
    for (let i = Math.max(1, fromIndex); i < path.n; i++) {
      const a = path.x[i - 1], b = path.x[i];
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
        const f = a / (a - b);
        return {
          i,
          t: path.t0 + (i - 1 + f) * DT,
          y: path.y[i - 1] + (path.y[i] - path.y[i - 1]) * f,
          z: path.z[i - 1] + (path.z[i] - path.z[i - 1]) * f,
        };
      }
    }
    return null;
  }

  // Check whether a launch clears the net inside the antennas and lands where intended.
  function checkShot(p0, v0, spin, minClear) {
    const path = predict(p0, v0, spin, 0, 4);
    const c = netCrossing(path);
    if (!c) return { ok: false, path, clear: -9 };
    const clear = c.y - C.netTop - R;
    const ok = clear >= (minClear || 0) && Math.abs(c.z) < C.ANTENNA_Z - R;
    return { ok, path, clear, cross: c };
  }

  // Resolve collisions of the live ball with the net, tape and antennas.
  // Returns an event name or null. Mutates ball.pos / ball.vel.
  function collideNet(ball, prevX) {
    const p = ball.pos, v = ball.vel;
    const top = C.netTop, bottom = top - C.NET_DEPTH;
    // Antennas (vertical rods just outside each sideline).
    for (const za of [C.ANTENNA_Z, -C.ANTENNA_Z]) {
      if (p.y > bottom && p.y < top + C.ANTENNA_H && Math.hypot(p.x, p.z - za) < R + 0.012) {
        const nx = p.x, nz = p.z - za, d = Math.hypot(nx, nz) || 1;
        const vn = (v.x * nx + v.z * nz) / d;
        if (vn < 0) { v.x -= 1.4 * vn * nx / d; v.z -= 1.4 * vn * nz / d; }
        return 'antenna';
      }
    }
    if (Math.abs(p.z) > C.NET_HALF_WIDTH) return null;
    // Top tape: a horizontal cylinder along z at height `top`.
    const dy = p.y - top;
    const d = Math.hypot(p.x, dy);
    if (d < R + 0.035 && dy > -0.04) {
      const nx = p.x / d, ny = dy / d;
      const vn = v.x * nx + v.y * ny;
      if (vn < 0) {
        v.x -= 1.35 * vn * nx; v.y -= 1.35 * vn * ny;
        v.x *= 0.8; v.z *= 0.85;
      }
      p.x = nx * (R + 0.036); p.y = top + ny * (R + 0.036);
      return Math.abs(p.z) > C.HALF_W ? 'netOutside' : 'tape';
    }
    // Net mesh: soft, absorbs most energy and drops the ball on the side it came from.
    if (Math.abs(p.x) < R && p.y < top && p.y > bottom - R * 0.5) {
      const side = Math.sign(prevX) || Math.sign(p.x) || 1;
      p.x = side * R;
      v.x = side * Math.abs(v.x) * 0.15;
      v.y *= 0.4; v.z *= 0.5;
      return Math.abs(p.z) > C.HALF_W ? 'netOutside' : 'net';
    }
    return null;
  }

  VB.Physics = { stepArr, simulate, solveLaunch, predict, netCrossing, checkShot, collideNet };
})();

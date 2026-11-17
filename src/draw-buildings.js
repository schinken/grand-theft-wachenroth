/**
 * @fileoverview Draws what stands: buildings, whose walls lean away from the
 * camera, street furniture and trees, and their shadows.
 */

import {near, put, stand} from './hills.js';
import {state} from './state.js';
import {CANOPY} from './textures.js';
import {PX_PER_M, TAU, lerp} from './util.js';
import {ctx, flatCtx} from './view.js';

/**
 * @param {!Array<!Building>} builds
 * @param {!Array<!Object>} trees
 * @param {number} x0 The view, in metres.
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawShadows(builds, trees, x0, y0, x1, y1) {
  flatCtx.fillStyle = 'rgba(0,0,0,.28)';
  for (const b of builds) {
    const o = b.h * 0.35;
    if (b.x1 + o < x0 || b.x0 > x1 || b.y1 + o < y0 || b.y0 > y1) {
      continue;
    }
    flatCtx.translate(o, o);
    flatCtx.fill(b.path);
    flatCtx.translate(-o, -o);
  }
  flatCtx.beginPath();
  for (const t of trees) {
    if (t.cut) {
      continue;
    }
    flatCtx.moveTo(t.x + 1.6 + t.r * 0.9, t.y + 1.6);
    flatCtx.arc(t.x + 1.6, t.y + 1.6, t.r * 0.9, 0, TAU);
  }
  flatCtx.fill();
}

const FRAME = '#f1ecde';
const byLeftEdge = (a, b) => a.sx0 - b.sx0;
// The buildings in view, kept between frames so drawing allocates nothing.
const inView = [];
// For pairs of buildings, by their ids: the line that keeps them apart.
const partings = new Map();

/**
 * Looks for the wall of one building that has the whole other building on its
 * outside, as far out as possible: the line along it keeps the two apart.
 * @param {!Building} a
 * @param {!Building} b
 * @return {?Array<number>} [nx, ny, c] with `a` where nx * x + ny * y < c, or
 *     null where no wall does it: a garage in the corner of an L-shaped house.
 */
export function parting(a, b) {
  let best = null;
  // Neighbours that touch are surveyed with small steps in their walls: the
  // other building may reach this far across the line.
  let room = -0.8;
  for (const [own, other, sign] of [
    [a.p, b.p, 1],
    [b.p, a.p, -1],
  ]) {
    for (let i = 0; i < own.length; i += 2) {
      const j = (i + 2) % own.length;
      const len = Math.hypot(own[j] - own[i], own[j + 1] - own[i + 1]) || 1;
      const nx = (own[j + 1] - own[i + 1]) / len; // outward: outlines run
      const ny = -(own[j] - own[i]) / len; // clockwise
      const c = nx * own[i] + ny * own[i + 1];
      let gap = 1e9;
      for (let k = 0; k < other.length; k += 2) {
        gap = Math.min(gap, nx * other[k] + ny * other[k + 1] - c);
      }
      // Not a wall in a recess: its own building lies all behind it.
      const outer = own.every(
        (v, k) => k % 2 || nx * v + ny * own[k + 1] - c < 0.3
      );
      if (gap > room && outer) {
        room = gap;
        best = [nx * sign, ny * sign, c * sign];
      }
    }
  }
  return best;
}

/**
 * Whether one building can hide the other from a camera above (cx, cy), and
 * so has to be drawn after it. A sight line runs from the camera outwards and
 * downwards: what it passes first is in front, whatever the heights.
 * @param {!Building} a
 * @param {!Building} b
 * @param {number} cx
 * @param {number} cy
 * @return {boolean} True for `a` in front, false for `b`.
 */
export function inFront(a, b, cx, cy) {
  if (a.on === b || b.on === a) {
    return a.on === b; // a tower stands on its building
  }
  const low = a.id < b.id ? a : b;
  const key = low.id * 65536 + (low === a ? b : a).id;
  let line = partings.get(key);
  if (line === undefined) {
    line = parting(low, low === a ? b : a);
    partings.set(key, line);
  }
  if (line) {
    // The camera looks across the line from its own side.
    return line[0] * cx + line[1] * cy < line[2] === (low === a);
  }
  // Nested into each other: in front is the one that hides more walls of the
  // other.
  const mine = wallsHidden(a, b, cx, cy);
  const theirs = wallsHidden(b, a, cx, cy);
  return mine === theirs ? a.h > b.h : mine > theirs;
}

/**
 * Counts the walls of one building that another one hides from a camera
 * above (cx, cy): those whose middle lies behind the other's outline.
 * @param {!Building} front
 * @param {!Building} back
 * @param {number} cx
 * @param {number} cy
 * @return {number}
 */
function wallsHidden(front, back, cx, cy) {
  const p = front.p;
  const q = back.p;
  let count = 0;
  for (let w = 0; w < q.length; w += 2) {
    const v = (w + 2) % q.length;
    const len = Math.hypot(q[v] - q[w], q[v + 1] - q[w + 1]) || 1;
    // A point just inside the wall, so walls that touch do not count
    const dx = (q[w] + q[v]) / 2 - ((q[v + 1] - q[w + 1]) / len) * 0.6 - cx;
    const dy = (q[w + 1] + q[v + 1]) / 2 + ((q[v] - q[w]) / len) * 0.6 - cy;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      const ex = p[j] - p[i];
      const ey = p[j + 1] - p[i + 1];
      const det = dx * ey - dy * ex;
      const t = ((p[i] - cx) * ey - (p[i + 1] - cy) * ex) / det;
      const u = ((p[i] - cx) * dy - (p[i + 1] - cy) * dx) / det;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        count++;
        break;
      }
    }
  }
  return count;
}

// Scratch space for one building, so drawing allocates nothing per frame.
const visibleWalls = [];
const rowLo = [];
const rowHi = [];
// Plain objects, not DOMMatrix: the canvas reads them twice as fast.
const PATTERN_HOME = {a: 1 / PX_PER_M, d: 1 / PX_PER_M};
const pinned = {a: 0, b: 0, c: 0, d: 0, e: 0, f: 0};
// Three points of a roof face and where they appear: x, y, then seen x, y.
const face = new Float64Array(12);

/**
 * Pins a roof texture to the sloping face described in `face`, so the tiles
 * lean with the roof instead of sliding across it when the camera moves.
 * @param {!CanvasPattern} pattern
 * @param {boolean} turned Whether the rows of tiles run across the building,
 *     as on the end faces of a hip roof.
 */
function pinPattern(pattern, turned) {
  const ux = face[4] - face[0];
  const uy = face[5] - face[1];
  const vx = face[8] - face[0];
  const vy = face[9] - face[1];
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-6) {
    pattern.setTransform(PATTERN_HOME);
    return;
  }
  const sx = face[6] - face[2];
  const sy = face[7] - face[3];
  const tx = face[10] - face[2];
  const ty = face[11] - face[3];
  // The map from the roof face to the screen: x' = a x + c y + e, and so on.
  const a = (sx * vy - tx * uy) / det;
  const c = (tx * ux - sx * vx) / det;
  const b = (sy * vy - ty * uy) / det;
  const d = (ty * ux - sy * vx) / det;
  pinned.a = (turned ? c : a) / PX_PER_M;
  pinned.b = (turned ? d : b) / PX_PER_M;
  pinned.c = (turned ? -a : c) / PX_PER_M;
  pinned.d = (turned ? -b : d) / PX_PER_M;
  pinned.e = face[2] - (a * face[0] + c * face[1]);
  pinned.f = face[3] - (b * face[0] + d * face[1]);
  pattern.setTransform(pinned);
}

/**
 * Notes one corner of a roof face for pinPattern().
 * @param {number} i Which of the three corners.
 * @param {number} x The corner, in the building's frame.
 * @param {number} y
 * @param {number} s How far the perspective pushes it out.
 * @param {number} lx The camera, in the building's frame.
 * @param {number} ly
 */
function corner(i, x, y, s, lx, ly) {
  face[i * 4] = x;
  face[i * 4 + 1] = y;
  face[i * 4 + 2] = x * s + lx * (1 - s);
  face[i * 4 + 3] = y * s + ly * (1 - s);
}

/**
 * The walls that face the camera, with plinth, windows and doors.
 * @param {!Building} b
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 * @param {number} h Wall height.
 * @param {number} s How far the perspective pushes the eaves out.
 */
function drawWalls(b, cx, cy, hc, h, s) {
  const p = b.p;
  const n = p.length;
  const ox = cx * (1 - s);
  const oy = cy * (1 - s);
  if (b.k === 'o') {
    // An open roof stands on posts.
    ctx.strokeStyle = '#6c6f76';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      ctx.moveTo(p[i], p[i + 1]);
      ctx.lineTo(p[i] * s + ox, p[i + 1] * s + oy);
    }
    ctx.stroke();
    return;
  }
  // The walls of a tower start on the roof it stands on, not on the ground.
  const under = b.on ? Math.min(b.on.h + (b.on.rh || 0), h) : 0;
  const s0 = hc / (hc - under);
  const px = cx * (1 - s0);
  const py = cy * (1 - s0);
  visibleWalls.length = 0;
  ctx.lineWidth = 0.15;
  for (let i = 0, k = 0; i < n; i += 2, k++) {
    const ax = p[i];
    const ay = p[i + 1];
    if ((cx - ax) * b.nx[k] + (cy - ay) * b.ny[k] <= 0) {
      continue; // faces away
    }
    const j = (i + 2) % n;
    const bx = p[j];
    const by = p[j + 1];
    ctx.fillStyle = ctx.strokeStyle = b.wall[k];
    ctx.beginPath();
    ctx.moveTo(ax * s0 + px, ay * s0 + py);
    ctx.lineTo(bx * s0 + px, by * s0 + py);
    ctx.lineTo(bx * s + ox, by * s + oy);
    ctx.lineTo(ax * s + ox, ay * s + oy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    visibleWalls.push(i);
  }
  if (!visibleWalls.length || under) {
    return; // no plinth, windows or doors up on a roof
  }
  // The plinth of all walls in one stroke
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.lineWidth = 0.32;
  ctx.beginPath();
  for (const i of visibleWalls) {
    const j = (i + 2) % n;
    ctx.moveTo(p[i], p[i + 1]);
    ctx.lineTo(p[j], p[j + 1]);
  }
  ctx.stroke();
  const doors = b.doors;
  if (b.rows) {
    // Every window is a little quad on the wall; all of them go into one path.
    const rows = b.rows;
    for (let f = 0; f < rows.length; f++) {
      rowLo[f] = hc / (hc - h * rows[f][0]);
      rowHi[f] = hc / (hc - h * rows[f][1]);
    }
    let any = false;
    ctx.beginPath();
    for (const i of visibleWalls) {
      const list = b.wins[i >> 1];
      const j = (i + 2) % n;
      const ax = p[i];
      const ay = p[i + 1];
      const ex = p[j] - ax;
      const ey = p[j + 1] - ay;
      const away = Math.hypot(ax + ex / 2 - cx, ay + ey / 2 - cy);
      if (!list.length || (s - 1) * away < 0.8) {
        continue; // seen too steeply to show windows
      }
      const portal = doors && doors.wall === i >> 1 ? doors : null;
      for (let f = 0; f < rows.length; f++) {
        if (f === 0 && portal && portal.wide) {
          continue;
        }
        const lo = rowLo[f];
        const hi = rowHi[f];
        const lox = cx * (1 - lo);
        const loy = cy * (1 - lo);
        const hix = cx * (1 - hi);
        const hiy = cy * (1 - hi);
        for (let w = 0; w < list.length; w += 2) {
          const t = list[w];
          const half = list[w + 1];
          if (f === 0 && portal && Math.abs(t - 0.5) < half + portal.half) {
            continue; // the door is here
          }
          const x0 = ax + ex * (t - half);
          const y0 = ay + ey * (t - half);
          const x1 = ax + ex * (t + half);
          const y1 = ay + ey * (t + half);
          ctx.moveTo(x0 * lo + lox, y0 * lo + loy);
          ctx.lineTo(x1 * lo + lox, y1 * lo + loy);
          ctx.lineTo(x1 * hi + hix, y1 * hi + hiy);
          ctx.lineTo(x0 * hi + hix, y0 * hi + hiy);
          ctx.closePath();
          any = true;
        }
      }
    }
    if (any) {
      ctx.fillStyle = b.glass;
      ctx.fill();
      if (b.frame) {
        ctx.strokeStyle = FRAME;
        ctx.lineWidth = 0.14;
        ctx.stroke();
      }
    }
  }
  if (doors && visibleWalls.includes(doors.wall * 2)) {
    const i = doors.wall * 2;
    const j = (i + 2) % n;
    const ax = p[i];
    const ay = p[i + 1];
    const ex = p[j] - ax;
    const ey = p[j + 1] - ay;
    const hi = hc / (hc - h * doors.top);
    const hix = cx * (1 - hi);
    const hiy = cy * (1 - hi);
    ctx.beginPath();
    for (const t of doors.at) {
      const x0 = ax + ex * (t - doors.half);
      const y0 = ay + ey * (t - doors.half);
      const x1 = ax + ex * (t + doors.half);
      const y1 = ay + ey * (t + doors.half);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 * hi + hix, y1 * hi + hiy);
      ctx.lineTo(x0 * hi + hix, y0 * hi + hiy);
      ctx.closePath();
    }
    ctx.fillStyle = doors.col;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 0.12;
    ctx.stroke();
  }
  ctx.lineCap = 'round';
}

const byFar = (a, b) => b.d - a.d;
// Where the corners of one roof face appear, x then y.
const seen = new Float64Array(40);

/**
 * A roof made of faces, as Flo's house has it: slopes and the gable walls
 * above the eaves, the far ones first.
 * @param {!Building} b
 * @param {number} lx The camera, in the building's frame.
 * @param {number} ly
 * @param {number} s How far the perspective pushes the eaves out.
 * @param {number} s2 The same for the ridge.
 */
function drawPlanes(b, lx, ly, s, s2) {
  for (const f of b.planes) {
    f.d = (f.cu - lx) ** 2 + (f.cv - ly) ** 2;
  }
  b.planes.sort(byFar);
  const q = PX_PER_M;
  const m = pinned;
  for (const f of b.planes) {
    const p = f.p;
    if (f.wall && (lx - p[0]) * f.nu + (ly - p[1]) * f.nv <= 0) {
      continue; // looks away
    }
    // A corner the share k up the roof is pushed out between eaves and ridge.
    let turn = 0;
    for (let i = 0, n = 0; i < p.length; i += 3, n += 2) {
      const ss = 1 / (1 / s + (1 / s2 - 1 / s) * p[i + 2]);
      seen[n] = p[i] * ss + lx * (1 - ss);
      seen[n + 1] = p[i + 1] * ss + ly * (1 - ss);
    }
    const count = (p.length / 3) * 2;
    ctx.beginPath();
    for (let n = 0; n < count; n += 2) {
      const o = (n + 2) % count;
      turn += seen[n] * seen[o + 1] - seen[o] * seen[n + 1];
      ctx.lineTo(seen[n], seen[n + 1]);
    }
    ctx.closePath();
    if (f.wall) {
      ctx.fillStyle = f.wall;
      ctx.fill();
      ctx.stroke();
      continue;
    }
    if (turn <= 0) {
      continue; // seen from below
    }
    for (let i = 0; i < 3; i++) {
      const k = f.pin[i];
      face[i * 4] = p[k];
      face[i * 4 + 1] = p[k + 1];
      face[i * 4 + 2] = seen[(k / 3) * 2];
      face[i * 4 + 3] = seen[(k / 3) * 2 + 1];
    }
    // A face may have a roof of its own; the textures are shared, so it
    // goes back to rest afterwards.
    const roof = f.roof || b.roof;
    pinPattern(roof, f.turned);
    ctx.fillStyle = roof;
    ctx.fill();
    roof.setTransform(PATTERN_HOME);
    ctx.fillStyle = f.tint;
    ctx.fill();
    ctx.stroke();
    for (const [u0, v0, u1, v1, glass] of f.pv) {
      // Solar panels and roof windows lie on the slope, so they use the same
      // map as its tiles: the field, then the gaps between the modules or
      // the frame of the window.
      ctx.beginPath();
      ctx.moveTo(
        (m.a * u0 + m.c * v0) * q + m.e,
        (m.b * u0 + m.d * v0) * q + m.f
      );
      ctx.lineTo(
        (m.a * u1 + m.c * v0) * q + m.e,
        (m.b * u1 + m.d * v0) * q + m.f
      );
      ctx.lineTo(
        (m.a * u1 + m.c * v1) * q + m.e,
        (m.b * u1 + m.d * v1) * q + m.f
      );
      ctx.lineTo(
        (m.a * u0 + m.c * v1) * q + m.e,
        (m.b * u0 + m.d * v1) * q + m.f
      );
      ctx.closePath();
      // A colour instead of glass is a dormer.
      const dormer = typeof glass === 'string';
      ctx.fillStyle = dormer ? glass : glass ? '#9cc3d9' : '#1b2a47';
      ctx.fill();
      for (let u = u0 + 1.1; u < u1 - 0.3 && !glass; u += 1.1) {
        ctx.moveTo(
          (m.a * u + m.c * v0) * q + m.e,
          (m.b * u + m.d * v0) * q + m.f
        );
        ctx.lineTo(
          (m.a * u + m.c * v1) * q + m.e,
          (m.b * u + m.d * v1) * q + m.f
        );
      }
      ctx.strokeStyle = dormer
        ? 'rgba(0,0,0,.35)'
        : glass
          ? '#e8e6df'
          : '#4a6a9c';
      ctx.lineWidth = 0.12;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 0.3;
    }
  }
  if (b.chimney) {
    // a little higher than the ridge
    const ss = 1 / (1 / s + (1 / s2 - 1 / s) * 1.15);
    const x = b.chimney[0] * ss + lx * (1 - ss);
    const y = b.chimney[1] * ss + ly * (1 - ss);
    ctx.fillStyle = '#5a2c22';
    ctx.fillRect(x - 0.45, y - 0.45, 0.9, 0.9);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(x - 0.2, y - 0.2, 0.4, 0.4);
  }
}

/**
 * The roof, in the building's own frame: x runs along the long side.
 * @param {!Building} b
 * @param {number} lx The camera, in the building's frame.
 * @param {number} ly
 * @param {number} s How far the perspective pushes the eaves out.
 * @param {number} s2 The same for the ridge or the tip.
 */
function drawRoof(b, lx, ly, s, s2) {
  const k1 = 1 - s;
  const k2 = 1 - s2;
  ctx.strokeStyle = 'rgba(0,0,0,.5)';
  ctx.lineWidth = 0.3;
  if (b.planes) {
    drawPlanes(b, lx, ly, s, s2);
    ctx.transform(s2, 0, 0, s2, lx * k2, ly * k2);
  } else if (b.halves) {
    for (const g of b.gables) {
      // The triangle under each end of the ridge: wall on a gable, roof on a
      // hip.
      ctx.beginPath();
      ctx.moveTo(g[1] * s + lx * k1, g[2] * s + ly * k1);
      ctx.lineTo(g[3] * s2 + lx * k2, g[4] * s2 + ly * k2);
      ctx.lineTo(g[5] * s + lx * k1, g[6] * s + ly * k1);
      ctx.closePath();
      if (b.hip) {
        corner(0, g[1], g[2], s, lx, ly);
        corner(1, g[5], g[6], s, lx, ly);
        corner(2, g[3], g[4], s2, lx, ly);
        pinPattern(b.roof, true);
        ctx.fillStyle = b.roof;
        ctx.fill();
        ctx.fillStyle = g[7];
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = b.wall[g[0]];
        ctx.fill();
      }
    }
    const span = (b.rx0 + b.rx1) / 2;
    // The slope beyond the ridge first: seen from far off a steep roof hides
    // it, and then the near slope has to cover it.
    for (let i = 0; i < 2; i++) {
      const n = ly >= b.ry === i > 0 ? 0 : 1;
      const hp = b.halves[n];
      ctx.beginPath();
      for (let i = 0; i < hp.length; i += 3) {
        const ss = hp[i + 2] ? s2 : s;
        const x = hp[i] * ss + lx * (1 - ss);
        const y = hp[i + 1] * ss + ly * (1 - ss);
        if (i) {
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
        }
      }
      ctx.closePath();
      const eaves = n ? b.v0 : b.v1;
      corner(0, b.u0, b.ry, s2, lx, ly);
      corner(1, b.u1, b.ry, s2, lx, ly);
      corner(2, span, eaves, s, lx, ly);
      pinPattern(b.roof, false);
      ctx.fillStyle = b.roof;
      ctx.fill();
      ctx.fillStyle = b.tint[n];
      ctx.fill();
      ctx.stroke();
      if (b.pv === n) {
        // Solar panels lie on the slope, so they use the same map as its
        // tiles.
        const m = pinned;
        const u0 = lerp(b.rx0, b.rx1, 0.12);
        const u1 = lerp(b.rx0, b.rx1, 0.88);
        const v0 = lerp(b.ry, eaves, 0.2);
        const v1 = lerp(b.ry, eaves, 0.82);
        const q = PX_PER_M;
        ctx.beginPath();
        ctx.moveTo(
          (m.a * u0 + m.c * v0) * q + m.e,
          (m.b * u0 + m.d * v0) * q + m.f
        );
        ctx.lineTo(
          (m.a * u1 + m.c * v0) * q + m.e,
          (m.b * u1 + m.d * v0) * q + m.f
        );
        ctx.lineTo(
          (m.a * u1 + m.c * v1) * q + m.e,
          (m.b * u1 + m.d * v1) * q + m.f
        );
        ctx.lineTo(
          (m.a * u0 + m.c * v1) * q + m.e,
          (m.b * u0 + m.d * v1) * q + m.f
        );
        ctx.closePath();
        ctx.fillStyle = '#1b2a47';
        ctx.fill();
        ctx.strokeStyle = '#4a6a9c';
        ctx.lineWidth = 0.14;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.lineWidth = 0.3;
      }
    }
    b.roof.setTransform(PATTERN_HOME);
    ctx.strokeStyle = 'rgba(255,228,200,.4)';
    ctx.lineWidth = 0.32; // ridge tiles
    ctx.beginPath();
    ctx.moveTo(b.rx0 * s2 + lx * k2, b.ry * s2 + ly * k2);
    ctx.lineTo(b.rx1 * s2 + lx * k2, b.ry * s2 + ly * k2);
    ctx.stroke();
    if (b.chim) {
      const x = b.chim[0] * s2 + lx * k2;
      const y = b.chim[1] * s2 + ly * k2;
      ctx.fillStyle = '#5a2c22';
      ctx.fillRect(x - 0.45, y - 0.45, 0.9, 0.9);
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(x - 0.2, y - 0.2, 0.4, 0.4);
    }
    if (b.sign) {
      ctx.transform(s2, 0, 0, s2, lx * k2, ly * k2);
    }
  } else if (b.apex) {
    // Spires and silo lids: every wall gets a triangle up to the tip.
    const lp = b.lp;
    for (let i = 0, k = 0; i < lp.length; i += 2, k++) {
      const j = (i + 2) % lp.length;
      ctx.beginPath();
      ctx.moveTo(lp[i] * s + lx * k1, lp[i + 1] * s + ly * k1);
      ctx.lineTo(lp[j] * s + lx * k1, lp[j + 1] * s + ly * k1);
      ctx.lineTo(lx * k2, ly * k2);
      ctx.closePath();
      ctx.fillStyle = b.faces[k];
      ctx.fill();
    }
    if (b.k === 't') {
      ctx.fillStyle = '#e0b21c';
      ctx.fillRect(lx * k2 - 0.35, ly * k2 - 0.35, 0.7, 0.7);
    }
  } else {
    // A flat roof only grows with the perspective, so the canvas can do it.
    ctx.transform(s, 0, 0, s, lx * k1, ly * k1);
    ctx.fillStyle = b.roof;
    ctx.fill(b.lpath);
    ctx.lineWidth = 0.4;
    ctx.stroke(b.lpath);
    if (b.k !== 'o' && b.a > 30) {
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = 0.3;
      ctx.stroke(b.rim);
    }
    if (b.units) {
      for (const [ux, uy, us] of b.units) {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.fillRect(ux + 0.4, uy + 0.4, us, us * 0.7);
        ctx.fillStyle = '#c9cdd3';
        ctx.fillRect(ux, uy, us, us * 0.7);
        ctx.fillStyle = '#7d828a';
        ctx.fillRect(ux + us * 0.15, uy + us * 0.12, us * 0.7, us * 0.12);
      }
    }
  }
  if (b.sign) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      b.sign,
      (b.signU || 0) - b.signW / 2,
      (b.signV || 0) - b.signH / 2,
      b.signW,
      b.signH
    );
    ctx.imageSmoothingEnabled = false;
  }
}

/**
 * Buildings lean away from the screen centre, like looking straight down from a
 * helicopter.
 * @param {!Array<!Building>} builds
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 * @param {number} x0 The view, in metres.
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawBuildings(builds, cx, cy, hc, x0, y0, x1, y1) {
  inView.length = 0;
  for (const b of builds) {
    // The camera is lower above a building that stands on a hill.
    const hb = hc / near(b.mx, b.my);
    const h = Math.min(b.h, hb * 0.5);
    const top = Math.min(h + (b.rh || b.apex || 0), hb * 0.62);
    const s2 = hb / (hb - top);
    // What the building covers on the screen, roof leaning outwards
    b.sx0 = Math.min(b.x0, b.x0 * s2 + cx * (1 - s2));
    b.sx1 = Math.max(b.x1, b.x1 * s2 + cx * (1 - s2));
    b.sy0 = Math.min(b.y0, b.y0 * s2 + cy * (1 - s2));
    b.sy1 = Math.max(b.y1, b.y1 * s2 + cy * (1 - s2));
    if (b.sx1 < x0 || b.sx0 > x1 || b.sy1 < y0 || b.sy0 > y1) {
      continue;
    }
    b.behind.length = 0;
    b.drawn = false;
    inView.push(b);
  }
  // Every building is drawn after those it can hide. Ordering them by how
  // far their middle is from the camera got this wrong for long buildings,
  // and a low roof cut into the taller house next to it. Only buildings that
  // meet on the screen need comparing: sorted by their left edge, those are
  // neighbours in the list.
  inView.sort(byLeftEdge);
  for (let i = 0; i < inView.length; i++) {
    const a = inView[i];
    for (let j = i + 1; j < inView.length && inView[j].sx0 < a.sx1; j++) {
      const b = inView[j];
      if (b.sy0 >= a.sy1 || b.sy1 <= a.sy0) {
        continue;
      }
      if (inFront(a, b, cx, cy)) {
        a.behind.push(b);
      } else {
        b.behind.push(a);
      }
    }
  }
  for (const b of inView) {
    drawBuilding(b, cx, cy);
  }
}

/**
 * Draws a building, after everything it can hide. It stands on the ground at
 * its middle, all of it at that height: a house is level, whatever the slope.
 * @param {!Building} b
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 */
function drawBuilding(b, cx, cy) {
  if (b.drawn) {
    return; // done, or three buildings hide each other in a ring
  }
  b.drawn = true;
  for (const o of b.behind) {
    drawBuilding(o, cx, cy);
  }
  const hc = stand(b.mx, b.my);
  const z = put.z;
  const h = Math.min(b.h, hc * 0.5);
  const top = Math.min(h + (b.rh || b.apex || 0), hc * 0.62);
  const s = hc / (hc - h);
  drawWalls(b, cx, cy, hc, h, s);
  // The canvas would carry the windows' path through the new transform.
  ctx.beginPath();
  ctx.setTransform(
    z * b.ca,
    z * b.sa,
    -z * b.sa,
    z * b.ca,
    put.e + z * b.mx,
    put.f + z * b.my
  );
  const lx = (cx - b.mx) * b.ca + (cy - b.my) * b.sa;
  const ly = (cy - b.my) * b.ca - (cx - b.mx) * b.sa;
  drawRoof(b, lx, ly, s, hc / (hc - top));
}

/**
 * Lanterns and hydrants.
 * @param {!Array<!Prop>} list
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 */
export function drawFurniture(list, cx, cy) {
  const line = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const disc = (x, y, r, f) => {
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };
  ctx.lineCap = 'butt';
  for (const p of list) {
    const hp = stand(p.x, p.y);
    if (p.k === 'hydrant') {
      if (p.down) {
        disc(p.x, p.y, 1.5, 'rgba(70,130,190,.4)');
      }
      disc(p.x + 0.18, p.y + 0.18, 0.36, 'rgba(0,0,0,.3)');
      disc(p.x, p.y, 0.36, p.down ? '#7a1512' : '#c8201c');
      disc(p.x - 0.08, p.y - 0.08, 0.17, p.down ? '#9a2a22' : '#ee6a5a');
      continue;
    }
    const h = 6.5;
    const s = p.down ? 1 : hp / (hp - h);
    // Standing lanterns lean like the houses do, fallen ones lie flat
    const k = 1 - s;
    const tx = p.down ? p.x + Math.cos(p.fa) * h : p.x * s + cx * k;
    const ty = p.down ? p.y + Math.sin(p.fa) * h : p.y * s + cy * k;
    const hx = tx + Math.cos(p.down ? p.fa + 1.2 : p.a) * 1.4 * s;
    const hy = ty + Math.sin(p.down ? p.fa + 1.2 : p.a) * 1.4 * s;
    if (!p.down) {
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.lineWidth = 0.28;
      line(p.x, p.y, p.x + 2.3, p.y + 2.3);
    }
    disc(p.x, p.y, 0.26, '#26282c');
    ctx.strokeStyle = '#3d4045';
    ctx.lineWidth = 0.3;
    line(p.x, p.y, tx, ty);
    ctx.lineWidth = 0.24;
    line(tx, ty, hx, hy);
    disc(hx, hy, 0.52 * s, '#24262a');
    disc(hx, hy, 0.36 * s, p.down ? '#6a6a62' : '#f6edc0');
  }
  ctx.lineCap = 'round';
}

/**
 * @param {!Array<!Object>} trees
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 * @param {number} x0 The view, in metres.
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawTrees(trees, cx, cy, hc, x0, y0, x1, y1) {
  ctx.strokeStyle = '#4a3420';
  ctx.lineWidth = 0.5;
  for (const t of trees) {
    if (t.cut) {
      continue;
    }
    const ht = hc / near(t.x, t.y);
    const s = ht / (ht - t.h);
    const x = t.x * s + cx * (1 - s);
    const y = t.y * s + cy * (1 - s);
    if (
      Math.max(x + t.r, t.x) + 2 < x0 ||
      Math.min(x - t.r, t.x) - 2 > x1 ||
      Math.max(y + t.r, t.y) + 2 < y0 ||
      Math.min(y - t.r, t.y) - 2 > y1
    ) {
      continue; // the grid hands out whole cells, mostly off the screen
    }
    stand(t.x, t.y);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha =
      state.mode === 'play' &&
      Math.hypot(x - state.player.x, y - state.player.y) < t.r + 2.5
        ? 0.4
        : 1; // see under the canopy
    ctx.drawImage(CANOPY[t.s], x - t.r, y - t.r, t.r * 2, t.r * 2);
  }
  ctx.globalAlpha = 1;
}

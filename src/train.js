/**
 * @fileoverview The steel train: once a day a slow goods train with coils of
 * steel crosses the map on the rail along the Reiche Ebrach.
 */

import {MAP} from '../map.js';
import * as audio from './audio.js';
import {bounce, damage} from './cars.js';
import {pushOut} from './geometry.js';
import {stand} from './hills.js';
import {SEGS} from './land.js';
import {state} from './state.js';
import {PX_PER_M, TAU, canvas, clamp, dist} from './util.js';
import {ctx} from './view.js';

/**
 * The rail as one line from its eastern to its western end, stitched from the
 * pieces OSM splits it into: a point with the distance along the rail, d.
 * @type {!Array<{x: number, y: number, d: number}>}
 */
const RAIL = (() => {
  const pieces = MAP.roads
    .filter(r => r.t === 'rail')
    .map(r => r.p.flatMap((v, i) => (i % 2 ? [] : [[v, r.p[i + 1]]])));
  const touch = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1;
  const ends = l => [l[0], l[l.length - 1]];
  // An end of the rail is a point that only its own piece reaches; the line
  // starts at the eastern one.
  let line = null;
  for (const l of pieces) {
    for (const [p, turn] of [
      [l[0], false],
      [l[l.length - 1], true],
    ]) {
      const free = pieces.filter(o => ends(o).some(q => touch(p, q))).length;
      if (free === 1 && (!line || p[0] > line[0][0])) {
        line = turn ? [...l].reverse() : [...l];
        line.piece = l;
      }
    }
  }
  if (!line) {
    return [];
  }
  const left = pieces.filter(l => l !== line.piece);
  for (let i = 0; i < left.length; i++) {
    const l = left[i];
    const end = line[line.length - 1];
    if (touch(l[0], end) || touch(l[l.length - 1], end)) {
      line.push(...(touch(l[0], end) ? l : [...l].reverse()).slice(1));
      left.splice(i, 1);
      i = -1; // look through the rest again from the new end
    }
  }
  let d = 0;
  return line.map(([x, y], i) => {
    d += i ? Math.hypot(x - line[i - 1][0], y - line[i - 1][1]) : 0;
    return {x, y, d};
  });
})();
export const RAIL_LEN = RAIL.length ? RAIL[RAIL.length - 1].d : 0;

/**
 * The point at a distance along the rail; past its ends the rail runs on
 * straight.
 * @param {number} d
 * @return {!Array<number>} x and y.
 */
function railAt(d) {
  let lo = 1;
  let hi = RAIL.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (RAIL[mid].d < d) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const a = RAIL[lo - 1];
  const b = RAIL[lo];
  const k = (d - a.d) / (b.d - a.d || 1);
  return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
}

// Where a road or a track crosses the rail: the point, its distance along the
// rail, and whether the train is near enough to keep the cars back.
export const CROSSINGS = [];
for (let i = 1; i < RAIL.length; i++) {
  const a = RAIL[i - 1];
  const b = RAIL[i];
  for (const sg of SEGS) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const fx = sg[2] - sg[0];
    const fy = sg[3] - sg[1];
    const det = ex * fy - ey * fx;
    const t = ((sg[0] - a.x) * fy - (sg[1] - a.y) * fx) / det;
    const u = ((sg[0] - a.x) * ey - (sg[1] - a.y) * ex) / det;
    const x = a.x + ex * t;
    const y = a.y + ey * t;
    // A crossing on the joint of two stretches of road is found twice.
    const known = CROSSINGS.some(k => Math.hypot(k.x - x, k.y - y) < 3);
    if (det && t >= 0 && t < 1 && u >= 0 && u <= 1 && !known) {
      CROSSINGS.push({
        x,
        y,
        d: a.d + (b.d - a.d) * t,
        shut: false,
      });
    }
  }
}

/**
 * Paints one vehicle of the train from above, once.
 * @param {number} len
 * @param {number} wide
 * @param {boolean} loco
 * @return {!HTMLCanvasElement}
 */
function trainSprite(len, wide, loco) {
  const k = PX_PER_M;
  const sprite = canvas(len * k, wide * k);
  const g = sprite.getContext('2d');
  g.scale(k, k);
  if (loco) {
    // A diesel engine: cab at both ends, the bonnet with its fans between
    g.fillStyle = '#c4561f';
    g.fillRect(0, 0, len, wide);
    g.fillStyle = '#5a5d63';
    g.fillRect(3, 0.45, len - 6, wide - 0.9);
    for (let x = 4.2; x < len - 4; x += 2.4) {
      g.fillStyle = '#2b2b2e';
      g.beginPath();
      g.arc(x, wide / 2, 0.7, 0, TAU);
      g.fill();
      g.fillStyle = '#7d828a';
      g.fillRect(x - 0.6, wide / 2 - 0.06, 1.2, 0.12);
    }
    g.fillStyle = '#9fc4dc';
    g.fillRect(0.3, 0.4, 0.5, wide - 0.8);
    g.fillRect(len - 0.8, 0.4, 0.5, wide - 0.8);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#15151a' : '#f2c21c';
      g.fillRect(i % 3 ? 0 : 0, (i * wide) / 6, 0.25, wide / 6);
      g.fillRect(len - 0.25, (i * wide) / 6, 0.25, wide / 6);
    }
    return sprite;
  }
  // A flat wagon with cradles, and four coils of steel lying in them
  g.fillStyle = '#3b3e44';
  g.fillRect(0, 0, len, wide);
  g.fillStyle = '#5b4a38';
  g.fillRect(0.4, 0.35, len - 0.8, wide - 0.7);
  const shine = g.createLinearGradient(0, 0.4, 0, wide - 0.4);
  shine.addColorStop(0, '#6f757c');
  shine.addColorStop(0.45, '#e3e6ea');
  shine.addColorStop(0.6, '#b9bec4');
  shine.addColorStop(1, '#6f757c');
  for (let i = 0; i < 4; i++) {
    const x = 0.9 + i * 3.2;
    g.fillStyle = '#2b2b2e'; // the cradle
    g.fillRect(x - 0.15, 0.25, 2.1, wide - 0.5);
    g.fillStyle = shine;
    g.fillRect(x, 0.4, 1.8, wide - 0.8);
    g.fillStyle = 'rgba(40,44,50,.6)'; // two straps around it
    g.fillRect(x + 0.45, 0.4, 0.12, wide - 0.8);
    g.fillRect(x + 1.25, 0.4, 0.12, wide - 0.8);
  }
  return sprite;
}

// The train: an engine and six wagons, each with its length, width and look,
// and where it is now (filled in by placeTrain()).
export const TRAIN = [{len: 16, wide: 3, loco: true}]
  .concat(Array.from({length: 6}, () => ({len: 14, wide: 2.9, loco: false})))
  .map(v => ({
    ...v,
    spr: trainSprite(v.len, v.wide, v.loco),
    on: false,
    x: 0,
    y: 0,
    a: 0,
    poly: [0, 0, 0, 0, 0, 0, 0, 0],
  }));
const TRAIN_GAP = 0.8;
const TRAIN_LEN = TRAIN.reduce((sum, v) => sum + v.len + TRAIN_GAP, 0);
const TRAIN_SPEED = 6; // metres a second, some 22 km/h
// A day in the game lasts 20 minutes, and the train comes once in it: its
// engine enters the map this many seconds into the day.
export const DAY = 20 * 60;
export const TRAIN_DUE = 75;
let trainHead = -1;

/**
 * Puts the train where it is at a moment of the game.
 * @param {number} t Seconds of game time.
 * @return {number} How far the engine has come along the rail, or -1 while
 *     the train is not on the map.
 */
export function placeTrain(t) {
  const head = ((((t - TRAIN_DUE) % DAY) + DAY) % DAY) * TRAIN_SPEED;
  const on = RAIL_LEN > 0 && head < RAIL_LEN + TRAIN_LEN;
  let front = head;
  for (const v of TRAIN) {
    v.on = on && front > 0 && front - v.len < RAIL_LEN;
    if (v.on) {
      const [fx, fy] = railAt(clamp(front, 0, RAIL_LEN));
      const [bx, by] = railAt(clamp(front - v.len, 0, RAIL_LEN));
      v.a = Math.atan2(fy - by, fx - bx);
      // At the ends of the rail the line is cut short: keep the full length.
      v.x = (fx + bx) / 2;
      v.y = (fy + by) / 2;
      const ux = (Math.cos(v.a) * v.len) / 2;
      const uy = (Math.sin(v.a) * v.len) / 2;
      const nx = (-Math.sin(v.a) * v.wide) / 2;
      const ny = (Math.cos(v.a) * v.wide) / 2;
      v.poly[0] = v.x + ux + nx;
      v.poly[1] = v.y + uy + ny;
      v.poly[2] = v.x - ux + nx;
      v.poly[3] = v.y - uy + ny;
      v.poly[4] = v.x - ux - nx;
      v.poly[5] = v.y - uy - ny;
      v.poly[6] = v.x + ux - nx;
      v.poly[7] = v.y + uy - ny;
    }
    front -= v.len + TRAIN_GAP;
  }
  return on ? head : -1;
}

/**
 * Moves the train on, shuts the level crossings in front of it, sounds the
 * horn, and shoves aside whatever stands on the rail: cars get dented,
 * people are pushed off the track.
 */
export function moveTrain() {
  const head = placeTrain(state.t);
  const player = state.player;
  for (const k of CROSSINGS) {
    k.shut = head >= 0 && head > k.d - 90 && head - TRAIN_LEN < k.d + 8;
    // The horn, half a minute before the engine reaches the crossing
    const warn = k.d - 70;
    if (head >= warn && trainHead < warn && dist(k, player) < 400) {
      audio.play('train');
    }
  }
  trainHead = head;
  if (head < 0) {
    return;
  }
  for (const v of TRAIN) {
    if (!v.on) {
      continue;
    }
    const tvx = Math.cos(v.a) * TRAIN_SPEED;
    const tvy = Math.sin(v.a) * TRAIN_SPEED;
    const reach = v.len / 2 + 6;
    for (const c of state.cars) {
      if (Math.abs(c.x - v.x) > reach || Math.abs(c.y - v.y) > reach) {
        continue;
      }
      const fx = Math.cos(c.a);
      const fy = Math.sin(c.a);
      for (const off of c.type.offs) {
        const h = pushOut(c.x + fx * off, c.y + fy * off, c.type.r, v.poly);
        if (!h) {
          continue;
        }
        // The train does not give way: it hits like a wall that moves.
        c.vx -= tvx;
        c.vy -= tvy;
        const imp = bounce(c, h, off);
        c.vx += tvx;
        c.vy += tvy;
        damage(c, imp);
        c.awake = 2;
      }
    }
    const walkers =
      player.car || state.wasted ? state.peds : [...state.peds, player];
    for (const p of walkers) {
      if (Math.abs(p.x - v.x) > reach || Math.abs(p.y - v.y) > reach) {
        continue;
      }
      const h = pushOut(p.x, p.y, 0.6, v.poly);
      if (h) {
        p.x += h[0] * h[2];
        p.y += h[1] * h[2];
        p.flee = 0.6;
        p.a = Math.atan2(h[1], h[0]);
      }
    }
  }
}

/**
 * The train, with the shadow it throws.
 * @param {number} x0 The view, in metres.
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawTrain(x0, y0, x1, y1) {
  for (const v of TRAIN) {
    if (
      !v.on ||
      v.x < x0 - v.len ||
      v.x > x1 + v.len ||
      v.y < y0 - v.len ||
      v.y > y1 + v.len
    ) {
      continue;
    }
    stand(v.x, v.y);
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.a);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(-v.len / 2 + 0.5, -v.wide / 2 + 0.5, v.len, v.wide);
    ctx.drawImage(v.spr, -v.len / 2, -v.wide / 2, v.len, v.wide);
    ctx.restore();
  }
}

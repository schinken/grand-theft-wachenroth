/**
 * @fileoverview Pedestrians: they walk, dodge, fly and run away, unhurt.
 */

import * as audio from './audio.js';
import {float} from './effects.js';
import {NODES} from './land.js';
import {shove, waste} from './player.js';
import {state} from './state.js';
import {crime} from './traffic.js';
import {TAU, clamp, dist, pick, rand, wrap} from './util.js';

/**
 * A pedestrian, walking beside the road from one junction to the next.
 * @typedef {!Object}
 */
let Ped;

export const SHIRTS = [
  '#d9d4c8',
  '#b3372f',
  '#2f5fa8',
  '#3c8a4a',
  '#d8a31c',
  '#7a4a9a',
  '#22252b',
  '#d86a2a',
  '#e58fb0',
];
const HAIR = ['#2a1d12', '#4a3018', '#8a6a3a', '#c8c2b4', '#15151a', '#a8452a'];

/**
 * Puts a pedestrian on the pavement between two junctions.
 * @param {number} x
 * @param {number} y
 * @param {number} from
 * @param {number} to
 * @return {!Ped}
 */
export function spawnPed(x, y, from, to) {
  const p = {
    x,
    y,
    a: rand(0, TAU),
    from,
    to,
    next: nextWalk(from, to),
    side: pick([-1, 1]),
    sp: rand(1.1, 1.7),
    t: rand(0, 9),
    flee: 0,
    // While knocked over: seconds left in the air, of how many, the push and
    // how fast they turn over
    fly: 0,
    flyT: 1,
    vx: 0,
    vy: 0,
    spin: 0,
    spinV: 0,
    shirt: pick(SHIRTS),
    hair: pick(HAIR),
  };
  state.peds.push(p);
  return p;
}

/**
 * Where a walker goes on from a junction: any way but back, unless it is a
 * dead end.
 * @param {number} from The junction they come from.
 * @param {number} to The junction they walk to.
 * @return {number}
 */
function nextWalk(from, to) {
  const ways = NODES[to].walk.filter(n => n !== from);
  return ways.length ? pick(ways) : from;
}

/**
 * The point a pedestrian walks to: the corner of the pavement on their side
 * of the road, between the stretch they are on and the one they take next.
 * Aiming straight for the far end of every stretch took them across the
 * carriageway at each bend.
 * @param {!Ped} p
 * @return {!Array<number>} x and y.
 */
function pedCorner(p) {
  const a = NODES[p.from];
  const b = NODES[p.to];
  const c = p.next === p.from ? null : NODES[p.next];
  const len = dist(a, b) || 1;
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  // At a dead end they walk on to its end and turn there.
  const far = c ? dist(b, c) || 1 : 1;
  const ex = c ? (c.x - b.x) / far : dx;
  const ey = c ? (c.y - b.y) / far : dy;
  // Half the road and half the pavement to the side, more at a sharp corner
  const off = ((b.w / 2 + 0.9) * p.side) / Math.max(0.5, 1 + dx * ex + dy * ey);
  return [b.x - (dy + ey) * off, b.y + (dx + ex) * off];
}

/**
 * Walks one pedestrian along the pavement.
 * @param {!Ped} p
 * @param {number} dt
 */
export function stepPed(p, dt) {
  if (p.fly > 0) {
    // Knocked over: thrown through the air, turning over, slowing down
    p.fly -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const drag = Math.exp(-dt * 2.5);
    p.vx *= drag;
    p.vy *= drag;
    p.spin += p.spinV * dt;
    shove(p, 0.35);
    if (p.fly <= 0) {
      // Back on their feet, and off, the way they flew
      p.flee = 2.5;
      p.a = Math.atan2(p.vy, p.vx);
      p.spin = 0;
    }
    return;
  }
  let sp = p.sp;
  if (p.flee > 0) {
    p.flee -= dt;
    sp = 6.5;
  } else {
    const [tx, ty] = pedCorner(p);
    if (Math.hypot(tx - p.x, ty - p.y) < 0.9) {
      // Turning back at a dead end, they stay on their side of the road.
      p.side *= p.next === p.from ? -1 : 1;
      [p.from, p.to] = [p.to, p.next];
      p.next = nextWalk(p.from, p.to);
    } else {
      p.a += clamp(wrap(Math.atan2(ty - p.y, tx - p.x) - p.a), -6 * dt, 6 * dt);
    }
  }
  p.x += Math.cos(p.a) * sp * dt;
  p.y += Math.sin(p.a) * sp * dt;
  p.t += sp * dt;
  shove(p, 0.35);
}

/**
 * Knocks a pedestrian over: they fly a few metres, land, get up and run
 * away. Nobody gets run over in Wachenroth.
 * @param {!Ped} p
 * @param {number} vx The push, in metres a second.
 * @param {number} vy
 * @param {boolean=} byPlayer
 */
export function knockPed(p, vx, vy, byPlayer) {
  if (p.fly > 0) {
    return;
  }
  p.flyT = p.fly = clamp(0.3 + Math.hypot(vx, vy) * 0.025, 0.5, 0.85);
  p.vx = vx;
  p.vy = vy;
  p.spinV = rand(-1, 1) * 14;
  p.flee = 0;
  if (dist(p, state.player) < 80) {
    audio.play('scream');
  }
  if (byPlayer) {
    state.stats.peds++;
    float(p, pick(['HOPPLA!', 'AUTSCH!', 'HEY!', 'SPINNST DU?']), '#ff5a1f');
    crime(0.3);
  }
}

/**
 * Whether a walker is under a car.
 * @param {!Point} o
 * @param {!Car} c
 * @param {number} r
 * @return {boolean}
 */
function touching(o, c, r) {
  for (const off of c.type.offs) {
    if (
      Math.hypot(
        o.x - c.x - Math.cos(c.a) * off,
        o.y - c.y - Math.sin(c.a) * off
      ) <
      c.type.r + r
    ) {
      return true;
    }
  }
  return false;
}

// The box around all pedestrians: most cars are far away from it and have
// nothing to do with them. One box, used again in every round.
const pedBox = {x0: 0, y0: 0, x1: 0, y1: 0};

/**
 * Makes the box around the pedestrians hold one more of them.
 * @param {!Ped} p
 */
function widenBox(p) {
  pedBox.x0 = Math.min(pedBox.x0, p.x);
  pedBox.y0 = Math.min(pedBox.y0, p.y);
  pedBox.x1 = Math.max(pedBox.x1, p.x);
  pedBox.y1 = Math.max(pedBox.y1, p.y);
}

/**
 * A pedestrian near a car: jumps aside when it comes for them, is thrown
 * ahead when it hits them fast, and pushed away when it is slow.
 * @param {!Car} c
 * @param {!Ped} p
 * @param {number} sp The speed of the car, in metres a second.
 * @param {number} reach How far ahead of the car pedestrians see it.
 */
function carVsPed(c, p, sp, reach) {
  const player = state.player;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (Math.abs(dx) > reach || Math.abs(dy) > reach) {
    return;
  }
  // Which side of the car's path the walker is on
  const side = dx * c.vy - dy * c.vx;
  const coming =
    sp > 4 &&
    p.flee <= 0 &&
    dx * c.vx + dy * c.vy > 0 &&
    Math.abs(side) / sp < 1.9;
  if (coming) {
    p.flee = 0.8;
    // Everybody in the way of the car jumps aside
    p.a = Math.atan2(c.vy, c.vx) + ((side > 0 ? -1 : 1) * Math.PI) / 2;
    if (c === player.car && Math.random() < 0.5) {
      audio.play('scream');
    }
  }
  if (!touching(p, c, 0.35)) {
    return;
  }
  if (sp > 3) {
    // Thrown ahead of the car, faster than it, and to the side the walker
    // stood on, so it does not run them over in the air
    const away = Math.sign(dx * -c.vy + dy * c.vx) || 1;
    knockPed(
      p,
      c.vx * 1.15 - (c.vy / sp) * away * 9,
      c.vy * 1.15 + (c.vx / sp) * away * 9,
      c === player.car
    );
    c.vx *= 0.92; // the bump is felt
    c.vy *= 0.92;
    return;
  }
  const d = Math.hypot(dx, dy) || 1;
  p.x += (dx / d) * 0.2;
  p.y += (dy / d) * 0.2;
  widenBox(p); // it was pushed, maybe out of the box
}

/**
 * A car touches the player on foot: fast, and that is it; slow, and it
 * pushes them away.
 * @param {!Car} c
 * @param {number} sp The speed of the car, in metres a second.
 */
function carVsPlayer(c, sp) {
  const player = state.player;
  if (player.slide && player.slide.car === c) {
    return;
  }
  if (!touching(player, c, 0.35)) {
    return;
  }
  if (sp > 4) {
    waste();
    return;
  }
  const d = dist(player, c) || 1;
  player.x += ((player.x - c.x) / d) * 0.2;
  player.y += ((player.y - c.y) / d) * 0.2;
}

/** Pedestrians and the player on foot against cars. */
export function walkersVsCars() {
  const player = state.player;
  const peds = state.peds;
  pedBox.x0 = pedBox.y0 = Infinity;
  pedBox.x1 = pedBox.y1 = -Infinity;
  peds.forEach(widenBox);
  for (const c of state.cars) {
    if (c.alt > 0.3) {
      continue; // flying over their heads
    }
    const sp = Math.hypot(c.vx, c.vy);
    // Pedestrians see a car coming a second and a half ahead, and at least
    // within 12 m; one more for the box keeps rounding out of it
    const reach = Math.max(12, sp * 1.5 + 4);
    const far =
      c.x < pedBox.x0 - reach - 1 ||
      c.x > pedBox.x1 + reach + 1 ||
      c.y < pedBox.y0 - reach - 1 ||
      c.y > pedBox.y1 + reach + 1;
    // On foot and within 12 m, more than any car is long
    const afoot =
      state.mode === 'play' &&
      !player.car &&
      !state.wasted &&
      Math.abs(player.x - c.x) < 12 &&
      Math.abs(player.y - c.y) < 12;
    for (let i = 0; !far && i < peds.length; i++) {
      carVsPed(c, peds[i], sp, reach);
    }
    if (afoot) {
      carVsPlayer(c, sp);
    }
  }
}

/**
 * @fileoverview Cars: how they drive, crash, burn and sink.
 */

import * as audio from './audio.js';
import {buildingGrid} from './buildings.js';
import {decal, flash, float, puff} from './effects.js';
import {pushOut} from './geometry.js';
import {at} from './grid.js';
import {NODES, surfAt} from './land.js';
import {knockPed, spawnPed} from './people.js';
import {nearNode} from './places.js';
import {waste} from './player.js';
import {propGrid, treeGrid} from './scenery.js';
import {COLORS, PAINT, TRAILERS, TYPES, carSprite} from './sprites.js';
import {state} from './state.js';
import {crime} from './traffic.js';
import {clamp, dist, pick, rand, wrap} from './util.js';

/**
 * A vehicle: position x and y, heading a, velocity vx and vy, its `type` from
 * TYPES, health hp, and `ai` while the computer drives it.
 * @typedef {!Object}
 */
let Car;

/**
 * A car takes a lantern or a hydrant with it.
 * @param {!Prop} p
 * @param {!Car} c
 */
function knock(p, c) {
  if (Math.hypot(c.vx, c.vy) < 2.5) {
    return;
  }
  p.down = 1;
  p.fa = Math.atan2(c.vy, c.vx);
  c.vx *= 0.88;
  c.vy *= 0.88;
  damage(c, 8);
  for (let i = 0; i < 5; i++) {
    puff(p.x, p.y, 'spark');
  }
  if (p.k === 'hydrant') {
    state.sprays.push({x: p.x, y: p.y, t: 10});
    if (dist(p, state.player) < 90) {
      audio.play('splash');
    }
  }
  if (c === state.player.car) {
    float(p, p.k === 'hydrant' ? 'PLATSCH!' : 'KLONK!', '#ff5a1f');
  }
}

/**
 * Paints a car afresh after its colour or its extras changed.
 * @param {!Car} c
 */
export function repaint(c) {
  c.spr = carSprite(c.kind, c.col, c.frame, c.extras);
}

/**
 * Puts a vehicle into the world.
 * @param {number} x
 * @param {number} y
 * @param {number} a Heading, in radians.
 * @param {string} kind
 * @param {string=} col
 * @return {!Car}
 */
export function makeCar(x, y, a, kind, col = PAINT[kind] || pick(COLORS)) {
  const type = TYPES[kind];
  const c = {
    x,
    y,
    a,
    vx: 0,
    vy: 0,
    vf: 0,
    spin: 0,
    thr: 0,
    steer: 0,
    hb: false,
    type,
    kind,
    col,
    frame: kind === 'van' ? (Math.random() * 9) | 0 : 0, // the company stripe
    extras: '',
    spr: null,
    name: pick(type.name),
    hp: type.hp,
    burn: 0,
    dead: false,
    ai: null,
    // How many more rounds collideCars() looks at it; see there
    awake: 2,
    radio:
      kind === 'tractor'
        ? 1
        : Math.random() < 0.15
          ? -1
          : (Math.random() * 4) | 0,
  };
  repaint(c);
  state.cars.push(c);
  return c;
}
/**
 * Hangs a trailer on a vehicle.
 * @param {!Car} c
 * @param {string} kind
 * @return {!Car}
 */
export function hitch(c, kind) {
  c.tr = {kind, a: c.a, type: TRAILERS[kind]};
  return c;
}

/**
 * Pushes a car out of something it hit.
 * @param {!Car} c
 * @param {!Array<number>} h [nx, ny, depth].
 * @param {number} off Where along the car it was hit.
 * @return {number} The impact speed.
 */
export function bounce(c, h, off) {
  c.x += h[0] * h[2];
  c.y += h[1] * h[2];
  const vn = c.vx * h[0] + c.vy * h[1];
  if (vn >= 0) {
    return 0;
  }
  c.vx -= 1.3 * vn * h[0];
  c.vy -= 1.3 * vn * h[1];
  c.spin += off * (Math.cos(c.a) * h[1] - Math.sin(c.a) * h[0]) * -vn * 0.1;
  return -vn;
}

/**
 * Dents a car; enough of it sets the car on fire.
 * @param {!Car} c
 * @param {number} imp Impact speed.
 */
export function damage(c, imp) {
  if (imp < 5 || c.dead) {
    return;
  }
  if (dist(c, state.player) < 80 && state.t - state.crashT > 0.08) {
    state.crashT = state.t;
    audio.play('crash', imp);
    for (let i = 0; i < 6; i++) {
      puff(c.x, c.y, 'spark');
    }
  }
  c.hp -= ((imp - 5) * 0.55) / c.type.mass;
  if (c.ai) {
    c.ai.rage = 5;
  }
  const j = state.job;
  if (j && j.fragile && c === state.player.car) {
    // the load does not like this
    j.cargo -= (imp - 5) * 0.012;
    float(c, pick(['KLIRR!', 'SCHEPPER!', 'AUWEH!']), '#ff5a1f');
    audio.play('glass');
  }
  if (c.hp <= 0 && !c.burn) {
    c.burn = 4.5;
    bail(c);
    if (c === state.player.car) {
      flash('Raus hier!', 'Die Karre brennt');
    }
  }
}

/**
 * The driver jumps out and runs for it.
 * @param {!Car} c
 */
export function bail(c) {
  if (!c.ai) {
    return;
  }
  c.ai = null;
  c.thr = c.steer = 0;
  c.hb = false;
  const n = nearNode(c, 'walk');
  const p = spawnPed(
    c.x + Math.sin(c.a) * 2,
    c.y - Math.cos(c.a) * 2,
    n,
    pick(NODES[n].walk)
  );
  p.flee = 4;
  p.a = c.a - Math.PI / 2 + rand(-0.6, 0.6);
}

/**
 * Blows a car up, with everything standing next to it.
 * @param {!Car} c
 */
function explode(c) {
  c.burn = 0;
  c.dead = true;
  c.hp = 0;
  c.spr = carSprite(c.kind, 'wreck');
  bail(c);
  state.parts.push({
    x: c.x,
    y: c.y,
    vx: 0,
    vy: 0,
    kind: 'boom',
    life: 0,
    max: 0.45,
  });
  for (let i = 0; i < 26; i++) {
    puff(c.x + rand(-2, 2), c.y + rand(-2, 2), i % 2 ? 'fire' : 'smoke');
  }
  decal(c.x, c.y, 'scorch');
  const player = state.player;
  const far = dist(c, player);
  if (far < 150) {
    audio.play('boom');
    state.shake = Math.max(state.shake, clamp(1.2 - far / 60, 0, 1));
  }
  state.stats.wrecks++;
  for (const o of state.cars) {
    const d = dist(o, c);
    if (o === c || o.dead || d > 9) {
      continue;
    }
    o.vx += ((o.x - c.x) / (d || 1)) * 7;
    o.vy += ((o.y - c.y) / (d || 1)) * 7;
    o.hp -= 60;
    if (o.hp <= 0 && !o.burn) {
      o.burn = rand(0.6, 1.6);
      bail(o);
    }
  }
  for (const p of state.peds) {
    const d = dist(p, c);
    if (d < 8) {
      // The blast throws people off their feet, away from it
      knockPed(p, ((p.x - c.x) / (d || 1)) * 9, ((p.y - c.y) / (d || 1)) * 9);
    }
  }
  if (player.car === c || (!player.car && far < 7)) {
    waste();
  }
}

/**
 * Cars cannot swim.
 * @param {!Car} c
 */
function sink(c) {
  for (let i = 0; i < 30; i++) {
    puff(c.x + rand(-2, 2), c.y + rand(-2, 2), 'water');
  }
  if (dist(c, state.player) < 150) {
    audio.play('splash');
  }
  c.dead = c.gone = true;
  c.ai = null;
  if (state.player.car === c) {
    waste('Abgesoffen!');
  }
}

/**
 * A burning car burns down and blows up; a badly dented one smokes.
 * @param {!Car} c
 * @param {number} dt
 */
function smoulder(c, dt) {
  const type = c.type;
  if (c.burn > 0) {
    c.thr = 0;
    if (Math.random() < dt * 40) {
      puff(c.x + rand(-1, 1), c.y + rand(-1, 1), 'fire');
    }
    if ((c.burn -= dt) <= 0) {
      explode(c);
    }
    return;
  }
  const dented = !c.dead && c.hp < type.hp * 0.5;
  if (dented && Math.random() < dt * (c.hp < type.hp * 0.25 ? 16 : 6)) {
    puff(
      c.x + Math.cos(c.a) * type.length * 0.35,
      c.y + Math.sin(c.a) * type.length * 0.35,
      'smoke'
    );
  }
}

/**
 * Moves one vehicle: engine, steering, grip, walls, trees and street furniture.
 * @param {!Car} c
 * @param {number} dt
 */
export function stepCar(c, dt) {
  const type = c.type;
  smoulder(c, dt);
  if (c.dead) {
    c.thr = c.steer = 0;
  }
  c.a += c.spin * dt;
  c.spin *= Math.exp(-3 * dt);
  if (c.kind === 'heli') {
    // up when you give it gas, down when you brake it slow
    const up =
      c === state.player.car &&
      (c.thr > 0 || (c.alt > 0 && !(c.hb && Math.abs(c.vf) < 5)));
    c.alt = clamp((c.alt || 0) + (up ? 0.7 : -0.7) * dt, 0, 1);
  }
  // Up there no water, wall or tree can touch it.
  const air = c.alt > 0.3;
  const ground = surfAt(c.x, c.y);
  const road = ground & 1 || c.ai || air;
  if ((ground & 9) === 8 && !c.dead && !air) {
    sink(c);
    return;
  }
  let fx = Math.cos(c.a);
  let fy = Math.sin(c.a);
  let vf = c.vx * fx + c.vy * fy;
  c.a +=
    ((c.steer * (c.hb ? 3.5 : c.boost ? 3.2 : 2.8)) / (1 + Math.abs(vf) / 26)) *
    clamp(vf / 5, -1, 1) *
    dt;
  fx = Math.cos(c.a);
  fy = Math.sin(c.a);
  vf = c.vx * fx + c.vy * fy;
  let vl = c.vy * fx - c.vx * fy; // sideways slip
  // Tuned at the garage: faster, quicker off the mark, and it takes bends.
  // NoS on top: much more push and top speed while the bottle lasts, some six
  // seconds.
  const nos = c.boosting && c.nos > 0;
  if (nos) {
    c.nos = Math.max(0, c.nos - dt / 6);
    state.shake = Math.max(state.shake, 0.15);
    puff(
      c.x - Math.cos(c.a) * (type.length / 2 + 0.4),
      c.y - Math.sin(c.a) * (type.length / 2 + 0.4),
      'fire'
    );
  }
  const boost = (c.boost || 1) * (nos ? 1.45 : 1);
  const max =
    type.max *
    boost *
    (road ? 1 : 0.7) *
    (c.kind === 'heli' && !air ? 0.15 : 1);
  if (c.thr > 0 && vf < max) {
    vf +=
      type.acc *
      boost *
      (nos ? 1.5 : 1) *
      (vf < 0 ? 2.5 : 1 - (vf / max) ** 2) *
      c.thr *
      dt;
  } // punchy launch, tapering to top speed
  if (c.thr < 0 && vf > -max * 0.35) {
    vf += (vf > 0 ? 30 : type.acc * 0.7) * c.thr * dt;
  }
  const drag =
    (c.thr ? 0 : 4) +
    (c.hb ? 12 : 0) +
    (Math.abs(vf) > max ? 6 : 0) +
    (c.dead ? 8 : 0);
  vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
  vl *= Math.exp(-(c.hb ? 1.6 : road ? 8 : 4.5) * dt);
  if (!c.thr && Math.abs(vf) < 0.05 && Math.abs(vl) < 0.05) {
    vf = vl = 0;
    if (Math.abs(c.spin) < 0.02) {
      c.spin = 0;
    }
  }
  c.vx = fx * vf - fy * vl;
  c.vy = fy * vf + fx * vl;
  c.vf = vf;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  if (c.tr) {
    c.tr.a =
      c.a -
      clamp(
        wrap(
          c.a - c.tr.a - (vf / c.tr.type.length) * Math.sin(c.a - c.tr.a) * dt
        ),
        -1.3,
        1.3
      );
  } // the trailer swings in behind
  if (!air) {
    hitScenery(c, fx, fy);
  }
}

/**
 * Walls, tree trunks and street furniture are in the way of a car.
 * @param {!Car} c
 * @param {number} fx Its heading, as a vector of length 1.
 * @param {number} fy
 */
function hitScenery(c, fx, fy) {
  const type = c.type;
  for (const off of type.offs) {
    const px = c.x + fx * off;
    const py = c.y + fy * off;
    if (surfAt(px, py) & 2) {
      continue;
    }
    for (const b of at(buildingGrid, px, py)) {
      if (
        px < b.x0 - type.r ||
        px > b.x1 + type.r ||
        py < b.y0 - type.r ||
        py > b.y1 + type.r
      ) {
        continue;
      }
      const h = pushOut(c.x + fx * off, c.y + fy * off, type.r, b.p);
      if (h) {
        damage(c, bounce(c, h, off));
      }
    }
    for (const t of at(treeGrid, px, py)) {
      if (t.cut) {
        continue;
      }
      const dx = c.x + fx * off - t.x;
      const dy = c.y + fy * off - t.y;
      const d = Math.hypot(dx, dy);
      if (d && d < type.r + 0.4) {
        damage(c, bounce(c, [dx / d, dy / d, type.r + 0.4 - d], off));
      }
    }
    for (const p of at(propGrid, px, py)) {
      if (
        !p.down &&
        Math.hypot(c.x + fx * off - p.x, c.y + fy * off - p.y) < type.r + 0.2
      ) {
        knock(p, c);
      }
    }
  }
}

/**
 * What ramming a car means for the game: a thief knocks wood off the cart,
 * the police take it badly, and the getaway car counts the hit.
 * @param {!Car} other The car that met the player's.
 * @param {number} hit How hard, in metres a second.
 */
function ramRules(other, hit) {
  const player = state.player;
  const job = state.job;
  const thief = other.ai && other.ai.thief;
  const carting = job && job.logs > 0 && player.car === job.veh;
  if (hit > 4 && thief && carting && state.t - (other.ramT || 0) > 1.5) {
    // A thief rams the tractor: wood falls off the cart.
    const c = player.car;
    const back = c.type.length / 2 + c.tr.type.length / 2;
    other.ramT = state.t;
    job.logs--;
    decal(
      c.x - Math.cos(c.tr.a) * back,
      c.y - Math.sin(c.tr.a) * back,
      'stump'
    );
    float(
      c,
      job.logs ? `Holz weg! Noch ${job.logs}` : 'Der Hänger ist leer!',
      '#ff5a1f'
    );
  }
  if (!(hit > 7)) {
    return;
  }
  if (other.ai && other.ai.cop) {
    crime(0.4);
  } // ramming the police
  if (state.job && other === state.job.prey) {
    other.hits = (other.hits || 0) + 1;
    float(other, 'RUMMS!', '#ff5a1f');
  }
}

/**
 * Two vehicles that are near each other. Where their circles overlap they
 * are pushed apart, and if they were closing in they bounce, spin and dent.
 * @param {!Car} a
 * @param {!Car} b
 * @return {boolean} Whether they touch.
 */
function collidePair(a, b) {
  const player = state.player;
  const ma = a.type.mass * (a.dead ? 2 : 1);
  const mb = b.type.mass * (b.dead ? 2 : 1);
  const min = a.type.r + b.type.r;
  let touch = false;
  for (const oa of a.type.offs) {
    for (const ob of b.type.offs) {
      const dx = b.x + Math.cos(b.a) * ob - a.x - Math.cos(a.a) * oa;
      const dy = b.y + Math.sin(b.a) * ob - a.y - Math.sin(a.a) * oa;
      const d = Math.hypot(dx, dy);
      if (!d || d >= min) {
        continue;
      }
      touch = true;
      const nx = dx / d;
      const ny = dy / d;
      const pen = min - d;
      a.x -= (nx * pen * mb) / (ma + mb);
      a.y -= (ny * pen * mb) / (ma + mb);
      b.x += (nx * pen * ma) / (ma + mb);
      b.y += (ny * pen * ma) / (ma + mb);
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv >= 0) {
        continue;
      }
      const impulse = (-1.3 * rv) / (1 / ma + 1 / mb);
      a.vx -= (impulse / ma) * nx;
      a.vy -= (impulse / ma) * ny;
      b.vx += (impulse / mb) * nx;
      b.vy += (impulse / mb) * ny;
      a.spin -=
        ((oa * (Math.cos(a.a) * ny - Math.sin(a.a) * nx) * impulse) / ma) * 0.1;
      b.spin +=
        ((ob * (Math.cos(b.a) * ny - Math.sin(b.a) * nx) * impulse) / mb) * 0.1;
      damage(a, ((-rv * mb) / (ma + mb)) * 1.6);
      damage(b, ((-rv * ma) / (ma + mb)) * 1.6);
      const other = a === player.car ? b : b === player.car ? a : null;
      if (other) {
        ramRules(other, -rv);
      }
    }
  }
  return touch;
}

// Where in state.cars the cars are that collideCars() has to look at, in
// ascending order. Kept between rounds, to save the allocation.
const awakeCars = [];

/**
 * Vehicle against vehicle. Cars that have not moved cannot run into each
 * other, and most cars are parked: a pair is only tested when one of the two
 * is awake. That is a car update() has moved in this round or the one before,
 * a new one, and one that got shoved, by another car, in this round or the one
 * before. The pairs come in the same order as in a loop over all of them, so
 * the outcome is the same.
 */
export function collideCars() {
  const cs = state.cars;
  const awake = awakeCars;
  awake.length = 0;
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].awake) {
      awake.push(i);
    }
  }
  let next = 0; // awake[next] is the first car awake behind car i
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    while (next < awake.length && awake[next] <= i) {
      next++;
    }
    let k = next;
    for (let j = i + 1; j < cs.length; j++) {
      if (!a.awake) {
        // Skip the cars at rest, up to the next one that is awake
        while (k < awake.length && awake[k] < j) {
          k++;
        }
        if (k === awake.length) {
          break;
        }
        j = awake[k];
      }
      const b = cs[j];
      const apart =
        Math.abs(a.x - b.x) > 12 ||
        Math.abs(a.y - b.y) > 12 ||
        a.alt > 0.3 ||
        b.alt > 0.3;
      if (apart || !collidePair(a, b)) {
        continue;
      }
      if (!b.awake) {
        // Shoved out of its sleep: the cars behind have to look at it too
        awake.push(j);
        awake.sort((m, n) => m - n);
      }
      a.awake = b.awake = 2;
    }
  }
  for (const c of cs) {
    if (c.awake) {
      c.awake--;
    }
  }
}

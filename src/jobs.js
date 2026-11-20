/**
 * @fileoverview Flo's jobs: their steps, their cast and how they end.
 */

import {MAP} from '../map.js';
import * as audio from './audio.js';
import {BUILD} from './buildings.js';
import {bail, hitch, makeCar, repaint} from './cars.js';
import {decal, flash, float, info, page, puff} from './effects.js';
import {nearest} from './geometry.js';
import {onScreen} from './hills.js';
import {roadPoint} from './items.js';
import {NODES, SEGS, surfAt} from './land.js';
import {MISSIONS, TALK} from './missions.js';
import {
  HOME,
  SPOT,
  downhill,
  driveSpot,
  field,
  nearLink,
  nearNode,
  pathLength,
  routeLine,
} from './places.js';
import {shove, toggleCar} from './player.js';
import {TREES, blocked} from './scenery.js';
import {TRAILERS} from './sprites.js';
import {fmt, state, store} from './state.js';
import {crime, newAI} from './traffic.js';
import {TAU, clamp, dist, lerp, pick, rand, wrap} from './util.js';

// A new car at junction a, its nose towards junction b
export const carAt = (a, b, kind, col) =>
  makeCar(a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), kind, col);

/**
 * Parks a mission vehicle at a place.
 * @param {string} kind
 * @param {string} key
 * @param {string=} trailer
 * @return {!Car}
 */
function spawnAt(kind, key, trailer) {
  const s = SPOT[key];
  // Make room
  state.cars = state.cars.filter(c => c === state.player.car || dist(c, s) > 9);
  const c = makeCar(s.x, s.y, s.a, kind);
  if (trailer) {
    hitch(c, trailer);
  }
  return c;
}

/** Starts the next mission. */
export function startJob() {
  const m = MISSIONS[state.jobN];
  state.job = {
    m,
    i: -1,
    step: null,
    veh: null,
    prey: null,
    to: null,
    left: 0,
    timed: false,
    cargo: 1,
    fragile: false,
    hold: 0,
    got: 0,
    need: 0,
    // Every vehicle the job has handed out
    fleet: [],
  };
  const j = state.job;
  state.items = state.items.filter(v => !v.job);
  // What stands ready from the start does not appear out of thin air later,
  // next to you.
  for (const st of m.steps.filter(step => step.ready)) {
    j.fleet.push(spawnAt(st.veh, st.at, st.trailer));
  }
  if (m.walk) {
    gatherWalk(j, ...m.walk);
  }
  flash(m.title, `Auftrag ${state.jobN + 1} von ${MISSIONS.length}`);
  page(...m.intro);
  nextStep();
}

/**
 * A tree to cut near a place, one of the surveyed ones that is not too far
 * from a road or a track; the mark goes on the side of the road, clear of the
 * crown.
 * @param {!Point} c
 * @param {number} r
 * @return {?Object} The mark's x and y, and its tree.
 */
function treeSpot(c, r) {
  const taken = new Set(state.items.map(v => v.tree).filter(Boolean));
  const near = TREES.filter(
    t =>
      !t.cut &&
      !taken.has(t) &&
      t.h > 4 &&
      Math.hypot(t.x - c.x, t.y - c.y) < r &&
      ![...taken].some(o => Math.hypot(o.x - t.x, o.y - t.y) < 7)
  );
  for (let n = 0; n < 60 && near.length; n++) {
    const t = near.splice((Math.random() * near.length) | 0, 1)[0];
    let best = null;
    let bd = 15;
    for (const sg of SEGS) {
      if (Math.abs(sg[0] - t.x) > 60 || Math.abs(sg[1] - t.y) > 60) {
        continue;
      }
      const q = nearest(t.x, t.y, sg[0], sg[1], sg[2], sg[3]);
      const d = Math.hypot(q[0] - t.x, q[1] - t.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) {
      const k = Math.min(1, (t.r + 0.8) / (bd || 1));
      return {
        x: t.x + (best[0] - t.x) * k,
        y: t.y + (best[1] - t.y) * k,
        tree: t,
      };
    }
  }
  return null;
}

/**
 * A free spot near a place: not in a house, not in the water, not on the
 * road.
 * @param {!Point} c
 * @param {number} r
 * @param {function(number, number): boolean} ok
 * @return {?Point}
 */
function looseSpot(c, r, ok) {
  for (let n = 0; n < 300; n++) {
    const x = c.x + rand(-r, r);
    const y = c.y + rand(-r, r);
    if (ok(x, y) && !blocked(x, y, 0.8) && !(surfAt(x, y) & 12)) {
      return {x, y};
    }
  }
  return null;
}

/**
 * Whether a guard's lamp falls on a point.
 * @param {!Object} g With its facing a, reach r and half-angle fov.
 * @param {!Point} p
 * @param {number=} more Extra metres and a tenth as much angle, for caution.
 * @return {boolean}
 */
export function inSight(g, p, more = 0) {
  return (
    dist(g, p) < g.r + more &&
    Math.abs(wrap(Math.atan2(p.y - g.y, p.x - g.x) - g.a)) < g.fov + more / 10
  );
}

/**
 * A spot at the kerb in front of a house near a place, where people put out
 * what is to be fetched.
 * @param {!Point} c
 * @param {number} r
 * @param {function(number, number): boolean} ok
 * @return {?Point}
 */
function kerbSpot(c, r, ok) {
  const homes = BUILD.filter(
    b => b.rd && Math.hypot(b.mx - c.x, b.my - c.y) < r
  );
  while (homes.length) {
    const b = homes.splice((Math.random() * homes.length) | 0, 1)[0];
    const [qx, qy, seg, far] = b.rd;
    const kerb = seg[4] / 2 + 0.8;
    const x = qx + ((b.mx - qx) * kerb) / far;
    const y = qy + ((b.my - qy) * kerb) / far;
    if (far > kerb + 2 && ok(x, y) && !blocked(x, y, 0.8)) {
      return {x, y};
    }
  }
  return null;
}

/**
 * A customer's house somewhere in the village, not next door: where a
 * delivery stands on its drive, and the name of its street.
 * @param {!Point} from
 * @return {!Object}
 */
function houseSpot(from) {
  const homes = BUILD.filter(b => {
    const d = Math.hypot(b.mx - from.x, b.my - from.y);
    return b.rd && b.k === 'h' && b !== HOME && d > 150 && d < 600;
  });
  const b = homes[(Math.random() * homes.length) | 0] || HOME;
  return {...driveSpot(b), name: b.rd[2][6].n || 'Kunde'};
}

/**
 * Wood thieves: cars that come for you and ram you.
 * @param {number} n
 * @return {!Array<!Car>}
 */
function spawnThieves(n) {
  const player = state.player;
  // The nearest junctions at least 60 m off; from the wood that is far.
  const spots = NODES.filter(o => o.car.length && dist(o, player) > 60)
    .sort((p, q) => dist(p, player) - dist(q, player))
    .slice(0, 8);
  const out = [];
  for (let i = 0; i < n && spots.length; i++) {
    const a = spots.splice((Math.random() * spots.length) | 0, 1)[0];
    const to = a.car[0].n;
    const c = carAt(a, NODES[to], 'car', '#22242a');
    c.ai = newAI(NODES.indexOf(a), to, {thief: true});
    out.push(c);
  }
  return out;
}

/**
 * The thieves of a job give up and go back to being traffic.
 * @param {!Object} j
 */
function calmThieves(j) {
  for (const c of j.thieves || []) {
    if (c.ai) {
      c.ai.thief = false;
    }
  }
  j.thieves = [];
}

/**
 * The rivals of a race stop racing and go back to being traffic.
 * @param {!Object} j
 */
function calmRivals(j) {
  for (const c of j.rivals || []) {
    if (c.ai) {
      Object.assign(c.ai, {race: 0, f: null});
    }
  }
  j.rivals = [];
}

// The lantern walk: how fast the children go, in metres a second, and how
// long their line is, in metres.
const WALK = 2.8;
const COLUMN = 10;

/**
 * Puts something on a line, a number of metres from its start, facing along
 * it.
 * @param {!Array<number>} line A flat list of x, y pairs.
 * @param {number} d
 * @param {!Object} o Gets x, y and the heading a.
 */
function along(line, d, o) {
  let i = 0;
  let len = Math.hypot(line[2] - line[0], line[3] - line[1]);
  while ((d > len || !len) && i + 5 < line.length) {
    d -= len;
    i += 2;
    len = Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
  }
  const t = clamp(d / (len || 1), 0, 1);
  o.x = lerp(line[i], line[i + 2], t);
  o.y = lerp(line[i + 1], line[i + 3], t);
  o.a = Math.atan2(line[i + 3] - line[i + 1], line[i + 2] - line[i]);
}

/**
 * How many metres along a line the point of it lies that is nearest to a
 * place.
 * @param {!Array<number>} line A flat list of x, y pairs.
 * @param {!Point} o
 * @return {number}
 */
function wayAt(line, o) {
  let best = 1e9;
  let at = 0;
  let run = 0;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const q = nearest(o.x, o.y, line[i], line[i + 1], line[i + 2], line[i + 3]);
    const d = Math.hypot(o.x - q[0], o.y - q[1]);
    if (d < best) {
      best = d;
      at = run + Math.hypot(q[0] - line[i], q[1] - line[i + 1]);
    }
    run += Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
  }
  return at;
}

// Where a child of the walk is meant to be: one object, used for each in turn.
const slot = {x: 0, y: 0, a: 0};

/**
 * Where a child of the lantern walk belongs just now: in its row behind the
 * head of the line, on its side of the road, swaying a little.
 * @param {!Object} j
 * @param {!Object} k The child.
 * @return {!Object} x, y and the heading a.
 */
function kidSlot(j, k) {
  along(j.way, j.walked - k.back, slot);
  const side = k.side + Math.sin(state.t * 0.9 + k.n) * 0.2;
  slot.x -= Math.sin(slot.a) * side;
  slot.y += Math.cos(slot.a) * side;
  return slot;
}

/**
 * The lantern walk gathers where it starts: sixteen children in pairs, one
 * pair behind the other. They wait until a parade step sends them off.
 * @param {!Object} j
 * @param {string} from Where they wait.
 * @param {string} to Where they walk to.
 */
function gatherWalk(j, from, to) {
  // How far every junction is from where the walk ends
  j.far = field(SPOT[to]);
  j.way = routeLine(j.far, SPOT[from], SPOT[to]);
  j.wayLen = pathLength(j.way);
  // How far the head of the line has got, in metres
  j.walked = COLUMN;
  j.going = false;
  j.shoutT = 0;
  // The stretches of road that fire engines close, each as the junction
  // outside and the one inside; the junctions on the roads between them,
  // which are kept empty once the walk is under way; and the seconds a
  // driver who is still in there has left to get out.
  j.gates = [];
  j.zone = new Map();
  j.grace = 8;
  j.kids = Array.from({length: 16}, (v, n) => {
    const k = {n, t: n, back: (n >> 1) * 1.3, side: n % 2 ? 0.7 : -0.7};
    return Object.assign(k, kidSlot(j, k));
  });
}

/**
 * The lantern walk moves on, and the fire engines of the job that stand
 * about flash their blue lights. Who drives into the children has lost.
 * @param {!Object} j
 * @param {number} dt
 */
function moveWalk(j, dt) {
  const car = state.player.car;
  // The children walk only while nobody drives on their roads.
  const go = j.going && !clearRoads(j, dt) && j.walked < j.wayLen;
  if (go) {
    j.walked += WALK * dt;
  }
  // Each child eases into its place: that rounds the corners.
  const ease = Math.min(1, dt * 6);
  for (const k of j.kids) {
    const to = kidSlot(j, k);
    k.x += (to.x - k.x) * ease;
    k.y += (to.y - k.y) * ease;
    k.a += wrap(to.a - k.a) * ease;
    k.t += go ? WALK * dt : 0;
  }
  for (const c of j.fleet) {
    if (c !== car) {
      c.siren = true;
    }
  }
  // Behind the children you drive at their pace: come close faster than
  // that and they shout, closer still and the job is lost.
  const fast = car && Math.hypot(car.vx, car.vy) > 3;
  const within = r => fast && j.kids.find(k => dist(k, car) < r);
  const near = within(10);
  j.shoutT -= dt;
  if (within(4.5)) {
    j.caught = 'kids';
  } else if (near && j.shoutT < 0) {
    j.shoutT = 1.2;
    float(near, 'VORSICHT!', '#ff5a1f');
  }
}

/**
 * How loud the children of the lantern walk are heard singing where the
 * player is.
 * @return {number} From 0 to 1.
 */
export function walkSong() {
  const j = state.job;
  return j && j.going
    ? clamp(1.25 - dist(state.player, j.kids[0]) / 80, 0, 1)
    : 0;
}

/**
 * The stretch of road a fire engine closes at its post.
 * @param {string} key The post.
 * @param {!Float32Array} f How far every junction is from where the walk
 *     ends: the nearer end of the stretch lies inside.
 * @return {!Array<number>} The junction outside, and the one inside.
 */
function gateAt(key, f) {
  const [l] = nearLink(SPOT[key]);
  return f[l[0]] < f[l[1]] ? [l[1], l[0]] : [l[0], l[1]];
}

/**
 * The junctions on the roads that fire engines close off for the lantern
 * walk: all that cars reach from the walk without passing a post.
 * @param {!Array<string>} keys The posts.
 * @param {!Float32Array} f How far every junction is from where the walk
 *     ends.
 * @return {!Map<number, number>} For each of them, how many junctions it is
 *     to the nearest way out, counting itself.
 */
export function enclosed(keys, f) {
  const gates = keys.map(k => gateAt(k, f));
  const shut = (a, b) => gates.some(g => g.includes(a) && g.includes(b));
  const todo = gates.map(g => g[1]);
  const zone = new Map(todo.map(n => [n, 1]));
  for (let i = 0; i < todo.length; i++) {
    const n = todo[i];
    for (const e of NODES[n].car) {
      if (!zone.has(e.n) && !shut(n, e.n)) {
        zone.set(e.n, zone.get(n) + 1);
        todo.push(e.n);
      }
    }
  }
  return zone;
}

/**
 * Keeps the roads that are closed for the lantern walk empty. Who drives in
 * there out of sight is gone at once. Who is in sight drives out by the
 * shortest way (see nextNode() in traffic.js) and has a few seconds for it.
 * @param {!Object} j
 * @param {number} dt
 * @return {boolean} Whether somebody is still on the way out.
 */
function clearRoads(j, dt) {
  let busy = false;
  for (const c of state.cars) {
    const ai = c.ai;
    if (!ai || ai.home || !j.zone.has(ai.from) || !j.zone.has(ai.to)) {
      continue;
    }
    if (j.grace > 0 && onScreen(c)) {
      busy = true;
    } else {
      c.gone = true;
    }
  }
  j.grace = busy ? j.grace - dt : 8;
  return busy;
}

/**
 * Which way a vehicle goes home along the road it stands on.
 * @param {!Car} c
 * @param {!Float32Array} f How far every junction is from home.
 * @return {!Array<number>} The junction behind it, and the one ahead.
 */
function homeward(c, f) {
  const [link] = nearLink(c);
  return f[link[0]] > f[link[1]] ? link : [link[1], link[0]];
}

/**
 * Colleagues drive vehicles of a job home, with blue lights. The one you sit
 * in stays yours.
 * @param {!Object} j
 * @param {!Array<!Car>} cars
 */
function relieve(j, cars) {
  const f = field(SPOT[j.m.home]);
  for (const c of cars) {
    if (c === state.player.car || c.ai || c.dead || c.burn) {
      continue;
    }
    const [from, to] = homeward(c, f);
    c.ai = newAI(from, to, {f, home: true});
    c.duty = false;
    c.siren = true;
  }
}

/**
 * Fire engines close the roads at other posts from now on: no car gets past
 * one into the roads of the lantern walk. Once the walk is under way, those
 * roads are kept empty too. Where no fire engine stands yet, colleagues have
 * put one, and the engines on duty at posts that are not needed any more go
 * home.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function closeRoads(j, st) {
  const at = c => st.shut.some(k => dist(c, SPOT[k]) < 15);
  j.gates = st.shut.map(k => gateAt(k, j.far));
  j.zone = j.going ? enclosed(st.shut, j.far) : new Map();
  for (const k of st.shut) {
    if (j.fleet.some(c => dist(c, SPOT[k]) < 15)) {
      continue;
    }
    const c = spawnAt('fire', k);
    // Half across the road, the nose towards home: it gets away later
    // without turning round.
    const [from, to] = homeward(c, field(SPOT[j.m.home])).map(n => NODES[n]);
    c.a = Math.atan2(to.y - from.y, to.x - from.x) + 0.5;
    c.duty = true;
    j.fleet.push(c);
  }
  const free = j.fleet.filter(c => c.duty && !at(c));
  relieve(j, free);
}

/**
 * The lantern walk sets off, or walks on.
 * @param {!Object} j
 */
function beginParade(j) {
  j.going = true;
  // The line has to be this far before the step is done: all of it past the
  // place, with room for a fire engine behind it.
  j.mark = Math.min(wayAt(j.way, j.to) + 10, j.wayLen - COLUMN);
}

/**
 * The vehicle has reached its post: you get out, and a colleague minds it.
 * @param {!Object} j
 */
function standGuard(j) {
  const c = j.veh;
  c.vx = c.vy = 0;
  if (state.player.car === c) {
    toggleCar();
  }
  c.duty = true;
  float(c, 'Ein Kamerad übernimmt', '#ffe9a0');
}

// How fast the strays of a job run from you, in metres a second. A rocker
// is slower than a hen: he is moshing.
const FLEE = {hen: 2.6, rocker: 2.1};

const afoot = () => !state.player.car && !state.wasted;

/**
 * A hen flees when you come close, zigzagging; otherwise it pecks about. A
 * rocker does the same.
 * @param {!Object} v The hen or the rocker.
 * @param {!Object} j
 * @param {number} dt
 */
function moveStray(v, j, dt) {
  const player = state.player;
  const st = j.step;
  let a = v.ph + state.t * 0.5;
  let sp = 0.8;
  if (afoot() && Math.hypot(v.x - player.x, v.y - player.y) < 6) {
    a =
      Math.atan2(v.y - player.y, v.x - player.x) + Math.sin(state.t * 6 + v.ph);
    sp = FLEE[v.kind];
  } else if (!(Math.sin(state.t * 1.3 + v.ph * 3) > 0.7)) {
    return; // it stays where it is
  }
  const home = st.near && SPOT[st.near];
  const x = v.x + Math.cos(a) * sp * dt;
  const y = v.y + Math.sin(a) * sp * dt;
  const inside = !home || Math.hypot(x - home.x, y - home.y) < st.r + 15;
  // Hens keep off the road and out of the water
  if (inside && !blocked(x, y, 0.4) && !(surfAt(x, y) & 12)) {
    v.x = x;
    v.y = y;
    return;
  }
  v.ph += 1.7; // blocked: turn away
}

/**
 * A guard walks up and down his line, with a look around at each end.
 * @param {!Object} g
 * @param {!Object} j
 * @param {number} dt
 */
function moveGuard(g, j, dt) {
  g.t += dt;
  if (g.wait > 0) {
    g.wait -= dt;
    g.a += dt * 1.6;
  } else {
    const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    g.u += (g.dir * 1.4 * dt) / len;
    if (g.u <= 0 || g.u >= 1) {
      g.u = clamp(g.u, 0, 1);
      g.dir = -g.dir;
      g.wait = 2.5;
    }
    g.a = Math.atan2(g.y1 - g.y0, g.x1 - g.x0) + (g.dir < 0 ? Math.PI : 0);
  }
  g.x = lerp(g.x0, g.x1, g.u);
  g.y = lerp(g.y0, g.y1, g.u);
  if (inSight(g, state.player)) {
    j.caught = 'seen';
  }
}

/**
 * A dog that smells you comes running, for a while.
 * @param {!Object} d
 * @param {!Object} j
 * @param {number} dt
 */
function moveDog(d, j, dt) {
  const player = state.player;
  const near = dist(d, player);
  if (afoot() && near < 14 && d.chase <= 0) {
    d.chase = 4;
    float(d, 'WUFF!', '#ff5a1f');
  }
  const to = d.chase > 0 ? player : {x: d.hx, y: d.hy};
  const far = dist(d, to);
  if (far > 0.5) {
    d.a = Math.atan2(to.y - d.y, to.x - d.x);
    const sp = d.chase > 0 ? 5.6 : 2;
    d.x += Math.cos(d.a) * Math.min(far, sp * dt);
    d.y += Math.sin(d.a) * Math.min(far, sp * dt);
    d.t += dt * sp;
  }
  d.chase -= dt;
  if (Math.hypot(d.x - d.hx, d.y - d.hy) > 28) {
    d.chase = 0;
  }
  if (afoot() && near < 0.9) {
    j.caught = 'dog';
  }
}

/**
 * Mama Doris guards her yard: she does not chase cars, nor anybody who has
 * left it, and then she goes home.
 * @param {!Object} j
 * @param {number} dt
 */
function moveDoris(j, dt) {
  const player = state.player;
  const st = j.step;
  const dz = j.doris;
  if (dz.rest > 0) {
    dz.rest -= dt;
    return;
  }
  const home = SPOT[st.near];
  const d = dist(dz, player);
  const chase = afoot() && dist(player, home) < st.r;
  const to = chase ? player : home;
  if (dist(dz, to) > 0.8) {
    dz.a = Math.atan2(to.y - dz.y, to.x - dz.x);
    dz.x += Math.cos(dz.a) * 3 * dt; // slower than you
    dz.y += Math.sin(dz.a) * 3 * dt;
    dz.t += 3 * dt;
    shove(dz, 0.35);
  }
  if (!chase || d >= 1.1) {
    return;
  }
  // The broom: you are pushed back, and one hen gets away again
  player.x += Math.cos(dz.a) * 3.5;
  player.y += Math.sin(dz.a) * 3.5;
  shove(player, 0.4);
  state.shake = 0.6;
  float(player, 'AUA! DER BESEN!', '#ff5a1f');
  audio.play('crash', 8);
  dz.rest = 5;
  if (j.got > 0) {
    j.got--;
    const spot = looseSpot(home, st.r, () => true) || home;
    state.items.push({...spot, kind: 'hen', job: true, ph: rand(0, TAU)});
    float(spot, 'GACK!', '#ffe9a0');
  }
}

/**
 * The cast of a job moves: the hens run from you, the guards walk their
 * lines, the dogs and Mama Doris run after you, the thieves find their way
 * to you, and the lantern walk goes its way.
 * @param {!Object} j
 * @param {number} dt
 */
export function jobCast(j, dt) {
  if (j.thieves.length && (j.thiefT = (j.thiefT || 0) - dt) <= 0) {
    j.thiefT = 1;
    state.thiefF = field(state.player);
  }
  for (const v of state.items) {
    if (v.job && FLEE[v.kind]) {
      moveStray(v, j, dt);
    }
  }
  for (const g of j.guards) {
    moveGuard(g, j, dt);
  }
  for (const d of j.dogs) {
    moveDog(d, j, dt);
  }
  if (j.doris) {
    moveDoris(j, dt);
  }
  if (j.kids) {
    moveWalk(j, dt);
  }
}

/**
 * What the step that is done leaves behind: a vehicle at its post, a word,
 * and a tip.
 * @param {!Object} j
 * @param {!Object} done The step.
 */
function payOff(j, done) {
  if (done.post) {
    standGuard(j);
  }
  if (done.got) {
    float(state.player, done.got, '#ffe9a0');
  }
  if (done.tip && j.timed) {
    // quick delivery, generous customer
    const tip = Math.round(j.left) * 2;
    state.money += tip;
    float(state.player, `Trinkgeld +${fmt(tip)}`);
    audio.play('coin');
  }
}

/** The workers: out of the digger, a few slaps, and you see stars. */
function beatUp() {
  const p = state.player;
  if (p.car) {
    p.car.vx = p.car.vy = 0;
    toggleCar();
  }
  state.shake = 0.9;
  state.drunk = Math.max(state.drunk, 25);
  state.hicT = 3;
  audio.play('bonk');
  ['BATSCH!', 'KLATSCH!', 'AUA!'].forEach((word, i) =>
    float({x: p.x + (i - 1) * 2, y: p.y - i}, word, '#ff5a1f')
  );
}

/**
 * What a step changes as it starts: the clock, the load, the police, how
 * drunk you are.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function setTerms(j, st) {
  if (st.time) {
    j.left = st.time;
    j.timed = true;
  } else if (st.time === 0) {
    j.timed = false;
  }
  if (st.fragile != null) {
    j.fragile = st.fragile;
    j.cargo = 1;
  }
  if (st.drop) {
    j.veh = null;
  }
  if (st.wanted) {
    crime(st.wanted);
    audio.play('alarm');
  }
  if (st.drunk) {
    state.drunk = Math.max(state.drunk, st.drunk);
    state.hicT = 1;
  }
  j.logs = st.logs || 0;
  if (st.load && j.veh && j.veh.tr) {
    j.veh.tr.kind = st.load;
    j.veh.tr.type = TRAILERS[st.load];
  } else if (st.load !== undefined && j.veh) {
    // a bucket full of earth, or empty again
    j.veh.extras = st.load ? 'e' : '';
    repaint(j.veh);
  }
  if (st.beat) {
    beatUp();
  }
}

/**
 * Who a step brings along: thieves, guards who walk their lines with a
 * lamp, shepherd dogs that lie in wait, and Mama Doris.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function setCast(j, st) {
  calmThieves(j);
  calmRivals(j);
  j.thieves = st.thieves ? spawnThieves(st.thieves) : [];
  j.guards = (st.guards || []).map(([x0, y0, x1, y1]) => ({
    ...{x0, y0, x1, y1, x: x0, y: y0, a: Math.atan2(y1 - y0, x1 - x0)},
    ...{u: Math.random(), dir: 1, wait: 0, t: 0, r: 12, fov: 0.5},
  }));
  j.dogs = (st.dogs || []).map(([x, y]) => ({
    hx: x,
    hy: y,
    x,
    y,
    a: 0,
    t: 0,
    chase: 0,
  }));
  j.caught = '';
  j.doris = null;
  if (st.doris) {
    // Mama Doris comes out of the house with her broom
    const home = SPOT[st.near];
    j.doris = {x: home.x, y: home.y, a: 0, t: 0, rest: 4};
  }
}

/**
 * Where a thing to collect lies: trees to cut stand where they stand, loose
 * things lie anywhere off the road, kerb things in front of houses, and the
 * rest on the roads.
 * @param {!Object} st The step.
 * @param {!Point} c The place it is near.
 * @param {function(number, number): boolean} free
 * @return {!Object}
 */
function itemSpot(st, c, free) {
  if (st.exact) {
    return {x: MAP.pois[st.near][0], y: MAP.pois[st.near][1]};
  }
  if (st.item === 'tree') {
    return treeSpot(c, st.r) || c;
  }
  if (st.loose) {
    return looseSpot(c, st.r, free) || c;
  }
  if (st.kerb) {
    return kerbSpot(c, st.r, free) || c;
  }
  return roadPoint(free) || c;
}

/**
 * A vehicle to get into waits at its place: one of the job's that stands
 * there already, ready from the start or left at its post, or else a new
 * one.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function beginSteal(j, st) {
  const there = j.fleet.find(c => dist(c, SPOT[st.at]) < 15);
  j.veh = there || spawnAt(st.veh, st.at, st.trailer);
  j.veh.hp *= st.armour || 1;
  j.veh.duty = false; // the colleague at its post hands it back
  if (!there) {
    j.fleet.push(j.veh);
  }
  j.to = j.veh;
}

/**
 * A getaway car sets off near a place.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function beginChase(j, st) {
  const from = nearNode(SPOT[st.at], 'car');
  const to = NODES[from].car[0].n;
  j.prey = carAt(NODES[from], NODES[to], st.veh);
  if (st.trailer) {
    hitch(j.prey, st.trailer);
  }
  j.prey.ai = newAI(from, to, {flee: true});
  j.to = j.prey;
}

/**
 * A race begins: the rivals stand on the road ahead, one behind the other,
 * and set off for the first checkpoint.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function beginRace(j, st) {
  const player = state.player;
  const f = field(SPOT[st.via[0]]);
  const from = nearNode(player, 'gps');
  const a = NODES[from];
  const next = downhill(f, from);
  const to = next < 0 ? a.car[0].n : next;
  const b = NODES[to];
  j.rivals = st.rivals.map((col, i) => {
    const t = Math.min(0.9, (9 + i * 7) / dist(a, b));
    const at = {x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)};
    // Make room
    state.cars = state.cars.filter(c => c === player.car || dist(c, at) > 6);
    const c = makeCar(
      at.x,
      at.y,
      Math.atan2(b.y - a.y, b.x - a.x),
      'sport',
      col
    );
    c.ai = newAI(from, to, {race: 1.85, f, cp: 0});
    return c;
  });
  j.cp = 0;
  j.place = st.rivals.length + 1;
  j.to = SPOT[st.via[0]];
}

/**
 * Runs a race: who has passed which checkpoint, the place you are in, and
 * the police, who turn up after the first checkpoint. A rival who is ahead
 * of you takes it easy and one who is behind steps on it, so it stays close.
 * @param {!Object} j
 * @param {!Object} st The step.
 * @return {boolean} Whether you are through the last checkpoint.
 */
function raceDone(j, st) {
  const player = state.player;
  const last = st.via.length;
  // How far somebody has got: checkpoints count most, then how near the
  // next one is.
  // ponytail: nearness is as the crow flies, not along the road. Right
  // behind a bend the place can be off by one for a moment.
  const far = (o, cp) => cp * 1e4 - dist(o, SPOT[st.via[cp]]);
  const mine = far(player, j.cp);
  j.place = 1;
  for (const c of j.rivals) {
    const ai = c.ai;
    if (!ai || c.dead) {
      continue; // out of the race
    }
    if (dist(c, SPOT[st.via[ai.cp]]) < 14) {
      if (++ai.cp >= last) {
        j.caught = 'race';
        return false;
      }
      ai.f = field(SPOT[st.via[ai.cp]]);
    }
    const ahead = far(c, ai.cp) > mine;
    j.place += ahead;
    ai.race = ahead ? 1.85 : 2.3;
  }
  if (j.cp >= 1) {
    if (!j.cops) {
      j.cops = true;
      audio.play('alarm');
      page('Blaulicht! Die Polizei hat das Rennen spitzgekriegt. Fahr weiter!');
    }
    state.wanted = Math.max(state.wanted, 2);
    state.seen = 8;
  }
  if (!player.car || dist(player, j.to) > 12) {
    return false;
  }
  if (++j.cp >= last) {
    return true;
  }
  j.to = SPOT[st.via[j.cp]];
  state.gps = null;
  float(player, `${j.cp} von ${last}`, '#ffd23e');
  audio.play('step');
  return false;
}

/**
 * The car that was just stopped is the one to get into.
 * @param {!Object} j
 */
function beginTake(j) {
  j.veh = j.prey;
  j.prey = null;
  j.to = j.veh;
}

/**
 * The things to collect are put out near their place.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function beginCollect(j, st) {
  const c = SPOT[st.near];
  j.got = 0;
  j.need = st.n;
  const free = (x, y) =>
    Math.hypot(x - c.x, y - c.y) < st.r &&
    !state.items.some(v => Math.hypot(v.x - x, v.y - y) < (st.loose ? 5 : 25));
  for (let i = 0; i < st.n; i++) {
    const spot = itemSpot(st, c, free);
    state.items.push({
      x: spot.x,
      y: spot.y,
      tree: spot.tree,
      kind: st.item,
      job: true,
      ph: rand(0, TAU),
      hair: pick(['#2a1d14', '#15151a', '#d8c08a', '#6b3a1e']),
    });
  }
}

/**
 * What a step sets up as it starts, by its kind.
 * @param {!Object} j
 * @param {!Object} st The step.
 */
function beginStep(j, st) {
  switch (st.do) {
    case 'steal':
      beginSteal(j, st);
      break;
    case 'chase':
      beginChase(j, st);
      break;
    case 'take':
      beginTake(j);
      break;
    case 'collect':
      beginCollect(j, st);
      break;
    case 'race':
      beginRace(j, st);
      break;
    case 'bring':
      if (j.veh) {
        j.veh.duty = false; // the colleague at its post hands it back
      }
      break;
    case 'parade':
      beginParade(j);
      break;
    default: // the other kinds need nothing
  }
}

/** Moves the mission on to its next step, or ends it. */
export function nextStep() {
  const j = state.job;
  const done = j.step;
  const st = j.m.steps[++j.i];
  if (done) {
    payOff(j, done);
  }
  if (!st) {
    endJob();
    return;
  }
  if (j.i) {
    audio.play('step');
  }
  j.step = st;
  j.hold = 0;
  j.need = 0; // only a collect step counts things
  j.told = false;
  j.to = st.to ? SPOT[st.to] : st.house ? houseSpot(state.player) : null;
  const fill = text => text.replace('{street}', j.to && j.to.name);
  setTerms(j, st);
  setCast(j, st);
  if (st.say) {
    page(fill(st.say));
  }
  state.pager.idle = fill(st.obj);
  beginStep(j, st);
  if (st.shut) {
    closeRoads(j, st);
  }
  state.gps = null;
}

/**
 * Water from the hose, between the player and the target.
 * @param {!Object} j
 * @param {number} dt
 */
function sprayWater(j, dt) {
  const player = state.player;
  for (let i = 0; i < 3; i++) {
    puff(
      lerp(player.x, j.to.x, Math.random()),
      lerp(player.y, j.to.y, Math.random()),
      'water'
    );
  }
  if (Math.random() < dt * 5) {
    audio.play('spray');
  }
}

/**
 * The digger throws up dirt: the garden gets dug up, not the street.
 * @param {!Object} j
 * @param {number} dt
 */
function digEarth(j, dt) {
  const player = state.player;
  puff(player.x + rand(-2, 2), player.y + rand(-2, 2), 'dirt');
  const x = j.to.x + rand(-12, 12);
  const y = j.to.y + rand(-12, 12);
  if (Math.random() < dt * 8 && !(surfAt(x, y) & 4) && !blocked(x, y, 0.5)) {
    decal(x, y, 'dirt');
  }
}

/** Dung flies off the cart. */
function spreadDung() {
  const player = state.player;
  for (let i = 0; i < 3; i++) {
    puff(player.x + rand(-3, 3), player.y + rand(-3, 3), 'dung');
  }
}

/**
 * How fast the player drives, in metres a second.
 * @return {number}
 */
function speed() {
  const c = state.player.car;
  return c ? Math.hypot(c.vx, c.vy) : 0;
}

/**
 * Whether a goto step is done: you are there, on foot if it says so, and
 * the police have let go if it says so.
 * @param {!Object} j
 * @param {!Object} st The step.
 * @param {function(number): boolean} near Whether the target is that close.
 * @return {boolean}
 */
function gotoDone(j, st, near) {
  const car = state.player.car;
  if (st.foot && car && near(14) && !j.told) {
    j.told = true;
    info('Aussteigen und zu Fuß reingehen');
  }
  const there = st.foot ? !car && near(3.5) : near(st.r || 7) && speed() < 9;
  return there && !(st.fix && state.wanted >= 1);
}

/**
 * Counts the seconds of a hold step while you stay at its place, and shows
 * what it does there.
 * @param {!Object} j
 * @param {!Object} st The step.
 * @param {function(number): boolean} near Whether the target is that close.
 * @param {number} dt
 * @return {boolean} Whether it is done.
 */
function holdDone(j, st, near, dt) {
  if (!near(st.r || 10) || (st.veh && state.player.car !== j.veh)) {
    j.hold = Math.max(0, j.hold - dt);
    return false;
  }
  j.hold += dt;
  if (st.fx === 'water') {
    sprayWater(j, dt);
  }
  if (st.fx === 'dig') {
    digEarth(j, dt);
  }
  if (st.fx === 'spread') {
    spreadDung();
  }
  return j.hold >= st.secs;
}

/**
 * Whether the getaway car has been rammed often enough, or is badly dented:
 * then its driver runs.
 * @param {!Object} j
 * @param {!Object} st The step.
 * @return {boolean}
 */
function chaseDone(j, st) {
  const prey = j.prey;
  const stopped = (prey.hits || 0) >= st.hits || prey.hp < prey.type.hp * 0.35;
  if (stopped) {
    bail(prey);
    Object.assign(prey, {thr: 0, hb: true});
  }
  return stopped;
}

/**
 * Whether the current step is done, by its kind.
 * @param {!Object} j
 * @param {number} dt
 * @return {boolean}
 */
function stepDone(j, dt) {
  const st = j.step;
  const player = state.player;
  const near = r => j.to && dist(player, j.to) < r;
  switch (st.do) {
    case 'steal':
    case 'take':
      return player.car === j.veh;
    case 'bring':
      return player.car === j.veh && near(7) && speed() < 8;
    case 'goto':
      return gotoDone(j, st, near);
    case 'hold':
      return holdDone(j, st, near, dt);
    case 'collect':
      return j.got >= j.need;
    case 'lose':
      return state.wanted < 1;
    case 'chase':
      return chaseDone(j, st);
    case 'race':
      return raceDone(j, st);
    case 'parade':
      return j.walked - COLUMN >= j.mark;
    default:
      throw new Error(`unknown step: ${st.do}`);
  }
}

/**
 * Why the mission is lost, or '' while it is not. The clock runs here.
 * @param {!Object} j
 * @param {number} dt
 * @return {string}
 */
function lostBy(j, dt) {
  const gone = c => c && (c.dead || c.burn > 0 || c.gone);
  if (j.caught) {
    return j.caught;
  }
  if (gone(j.veh) || gone(j.prey)) {
    return j.prey && j.prey.gone ? 'gone' : 'wreck';
  }
  if (j.timed && (j.left -= dt) <= 0) {
    return 'time';
  }
  if (j.fragile && j.cargo <= 0) {
    return 'cargo';
  }
  if (j.step.logs && j.logs <= 0) {
    return 'wood';
  }
  return '';
}

/**
 * Checks whether the current step is done or the mission lost.
 * @param {number} dt
 */
export function jobRules(dt) {
  const j = state.job;
  const why = lostBy(j, dt);
  if (why) {
    failJob(why);
    return;
  }
  if (stepDone(j, dt)) {
    nextStep();
  }
}

/** Mission accomplished. */
function endJob() {
  const j = state.job;
  const m = j.m;
  state.job = null;
  state.jobN++;
  state.nextJob = 8;
  state.money += m.reward;
  state.stats.missions++;
  state.pager.idle = '';
  state.items = state.items.filter(v => !v.job);
  calmThieves(j);
  calmRivals(j);
  if (m.home) {
    relieve(j, j.fleet);
  }
  if (m.sober) {
    state.drunk = 0; // slept it off
  }
  if (m.drunk) {
    state.drunk = Math.max(state.drunk, m.drunk); // a parting drink
    state.hicT = 1;
  }
  flash('Mission erfüllt!', `+${fmt(m.reward)}`);
  audio.play('win');
  store();
  page(...m.outro);
  if (state.jobN >= MISSIONS.length) {
    state.nextJob = 1e9;
    state.finale = 9;
  }
}

// What the flash says about why a job is lost.
const LOST = {
  time: 'Zeit abgelaufen',
  wreck: 'Fahrzeug Schrott',
  cargo: 'Ladung kaputt',
  wood: 'Kein Holz mehr am Hänger',
  seen: 'Die Wache hat dich gesehen',
  dog: 'Der Schäferhund hat dich gestellt',
  gone: 'Entkommen',
  race: 'Ein anderer war schneller',
  kids: 'Mitten in den Laternenumzug gefahren',
  busted: '',
  wasted: '',
};

/**
 * Mission failed.
 * @param {string} why
 */
export function failJob(why) {
  const j = state.job;
  state.job = null;
  calmThieves(j);
  calmRivals(j);
  if (j.m.home) {
    relieve(j, j.fleet);
  }
  state.nextJob = 10;
  state.pager.idle = '';
  state.items = state.items.filter(v => !v.job);
  if (j.prey) {
    j.prey.ai = newAI(
      j.prey.ai ? j.prey.ai.from : 0,
      j.prey.ai ? j.prey.ai.to : 0
    );
    j.prey.gone = !j.prey.ai.to;
  }
  flash('Mission gescheitert!', LOST[why]);
  audio.play('fail');
  if (why !== 'busted') {
    page(pick(TALK.scold));
  }
}

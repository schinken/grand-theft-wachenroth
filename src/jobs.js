/**
 * @fileoverview Flo's jobs: their steps, their cast and how they end.
 */

import {MAP} from '../map.js';
import * as audio from './audio.js';
import {BUILD} from './buildings.js';
import {bail, hitch, makeCar, repaint} from './cars.js';
import {decal, flash, float, info, page, puff} from './effects.js';
import {nearest} from './geometry.js';
import {roadPoint} from './items.js';
import {NODES, SEGS, surfAt} from './land.js';
import {MISSIONS, TALK} from './missions.js';
import {HOME, SPOT, driveSpot, field, nearNode} from './places.js';
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
  };
  state.items = state.items.filter(v => !v.job);
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
 * The hens run from you, Mama Doris runs after you, and the thieves find
 * their way to you.
 * @param {!Object} j
 * @param {number} dt
 */
export function jobCast(j, dt) {
  const player = state.player;
  const st = j.step;
  const afoot = !player.car && !state.wasted;
  if (j.thieves.length && (j.thiefT = (j.thiefT || 0) - dt) <= 0) {
    j.thiefT = 1;
    state.thiefF = field(player);
  }
  const home = st.near && SPOT[st.near];
  for (const v of state.items) {
    if ((v.kind !== 'hen' && v.kind !== 'rocker') || !v.job) {
      continue;
    }
    // A hen flees when you come close, zigzagging; otherwise it pecks about.
    // A rocker does the same, only slower: he is moshing.
    const d = Math.hypot(v.x - player.x, v.y - player.y);
    let a = v.ph;
    let sp = 0;
    if (afoot && d < 6) {
      a =
        Math.atan2(v.y - player.y, v.x - player.x) +
        Math.sin(state.t * 6 + v.ph);
      sp = v.kind === 'rocker' ? 2.1 : 2.6;
    } else if (Math.sin(state.t * 1.3 + v.ph * 3) > 0.7) {
      a = v.ph + state.t * 0.5;
      sp = 0.8;
    }
    const x = v.x + Math.cos(a) * sp * dt;
    const y = v.y + Math.sin(a) * sp * dt;
    const inside = !home || Math.hypot(x - home.x, y - home.y) < st.r + 15;
    // Hens keep off the road and out of the water
    if (sp && inside && !blocked(x, y, 0.4) && !(surfAt(x, y) & 12)) {
      v.x = x;
      v.y = y;
    } else if (sp) {
      v.ph += 1.7; // blocked: turn away
    }
  }
  for (const g of j.guards) {
    // up and down the line, a look around at each end
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
    if (inSight(g, player)) {
      j.caught = 'seen';
    }
  }
  for (const d of j.dogs) {
    // a dog that smells you comes running, for a while
    const near = dist(d, player);
    if (afoot && near < 14 && d.chase <= 0) {
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
    if (afoot && near < 0.9) {
      j.caught = 'dog';
    }
  }
  const dz = j.doris;
  if (!dz) {
    return;
  }
  if (dz.rest > 0) {
    dz.rest -= dt;
    return;
  }
  const d = dist(dz, player);
  // She guards her yard: she does not chase cars, nor anybody who has left
  // it, and then she goes home
  const chase = afoot && dist(player, home) < st.r;
  const to = chase ? player : home;
  if (dist(dz, to) > 0.8) {
    dz.a = Math.atan2(to.y - dz.y, to.x - dz.x);
    dz.x += Math.cos(dz.a) * 3 * dt; // slower than you
    dz.y += Math.sin(dz.a) * 3 * dt;
    dz.t += 3 * dt;
    shove(dz, 0.35);
  }
  if (chase && d < 1.1) {
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
}

/** Moves the mission on to its next step, or ends it. */
export function nextStep() {
  const j = state.job;
  const done = j.step;
  const st = j.m.steps[++j.i];
  if (done && done.got) {
    float(state.player, done.got, '#ffe9a0');
  }
  if (done && done.tip && j.timed) {
    // quick delivery, generous customer
    const tip = Math.round(j.left) * 2;
    state.money += tip;
    float(state.player, `Trinkgeld +${fmt(tip)}`);
    audio.play('coin');
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
    // The workers: out of the digger, a few slaps, and you see stars.
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
  calmThieves(j);
  j.thieves = st.thieves ? spawnThieves(st.thieves) : [];
  // Guards walk their lines with a lamp; shepherd dogs lie in wait.
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
  if (st.say) {
    page(fill(st.say));
  }
  state.pager.idle = fill(st.obj);
  if (st.do === 'steal') {
    j.veh = spawnAt(st.veh, st.at, st.trailer);
    j.to = j.veh;
  }
  if (st.do === 'chase') {
    const from = nearNode(SPOT[st.at], 'car');
    const to = NODES[from].car[0].n;
    j.prey = carAt(NODES[from], NODES[to], st.veh);
    if (st.trailer) {
      hitch(j.prey, st.trailer);
    }
    j.prey.ai = newAI(from, to, {flee: true});
    j.to = j.prey;
  }
  if (st.do === 'take') {
    j.veh = j.prey;
    j.prey = null;
    j.to = j.veh;
  }
  if (st.do === 'collect') {
    const c = SPOT[st.near];
    j.got = 0;
    j.need = st.n;
    const free = (x, y) =>
      Math.hypot(x - c.x, y - c.y) < st.r &&
      !state.items.some(
        v => Math.hypot(v.x - x, v.y - y) < (st.loose ? 5 : 25)
      );
    for (let i = 0; i < st.n; i++) {
      // Trees to cut stand where they stand; loose things lie anywhere off
      // the road, kerb things in front of houses; the rest lie on roads.
      const spot =
        (st.exact
          ? {x: MAP.pois[st.near][0], y: MAP.pois[st.near][1]}
          : st.item === 'tree'
            ? treeSpot(c, st.r)
            : st.loose
              ? looseSpot(c, st.r, free)
              : st.kerb
                ? kerbSpot(c, st.r, free)
                : roadPoint(free)) || c;
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
  state.gps = null;
}

/**
 * Checks whether the current step is done or the mission lost.
 * @param {number} dt
 */
export function jobRules(dt) {
  const j = state.job;
  const player = state.player;
  const st = j.step;
  const sp = player.car ? Math.hypot(player.car.vx, player.car.vy) : 0;
  const lost = c => c && (c.dead || c.burn > 0 || c.gone);
  if (j.caught) {
    failJob(j.caught);
    return;
  }
  if (lost(j.veh) || lost(j.prey)) {
    failJob(j.prey && j.prey.gone ? 'gone' : 'wreck');
    return;
  }
  if (j.timed && (j.left -= dt) <= 0) {
    failJob('time');
    return;
  }
  if (j.fragile && j.cargo <= 0) {
    failJob('cargo');
    return;
  }
  if (st.logs && j.logs <= 0) {
    failJob('wood');
    return;
  }
  const near = r => j.to && dist(player, j.to) < r;
  switch (st.do) {
    case 'steal':
    case 'take':
      if (player.car === j.veh) {
        nextStep();
      }
      break;
    case 'bring':
      if (player.car === j.veh && near(7) && sp < 8) {
        nextStep();
      }
      break;
    case 'goto':
      if (st.foot && player.car && near(14) && !j.told) {
        j.told = true;
        info('Aussteigen und zu Fuß reingehen');
      }
      if (
        (st.foot ? !player.car && near(3.5) : near(st.r || 7) && sp < 9) &&
        !(st.fix && state.wanted >= 1)
      ) {
        nextStep();
      }
      break;
    case 'hold':
      if (near(st.r || 10) && (!st.veh || player.car === j.veh)) {
        j.hold += dt;
        if (st.fx === 'water') {
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
        if (st.fx === 'dig') {
          puff(player.x + rand(-2, 2), player.y + rand(-2, 2), 'dirt');
          // the garden gets dug up, not the street
          const x = j.to.x + rand(-12, 12);
          const y = j.to.y + rand(-12, 12);
          if (
            Math.random() < dt * 8 &&
            !(surfAt(x, y) & 4) &&
            !blocked(x, y, 0.5)
          ) {
            decal(x, y, 'dirt');
          }
        }
        if (st.fx === 'spread') {
          for (let i = 0; i < 3; i++) {
            puff(player.x + rand(-3, 3), player.y + rand(-3, 3), 'dung');
          }
        }
        if (j.hold >= st.secs) {
          nextStep();
        }
      } else {
        j.hold = Math.max(0, j.hold - dt);
      }
      break;
    case 'collect':
      if (j.got >= j.need) {
        nextStep();
      }
      break;
    case 'lose':
      if (state.wanted < 1) {
        nextStep();
      }
      break;
    case 'chase':
      if ((j.prey.hits || 0) >= st.hits || j.prey.hp < j.prey.type.hp * 0.35) {
        bail(j.prey);
        Object.assign(j.prey, {thr: 0, hb: true});
        nextStep();
      }
      break;
    default:
      throw new Error(`unknown step: ${st.do}`);
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

/**
 * Mission failed.
 * @param {string} why
 */
export function failJob(why) {
  const j = state.job;
  state.job = null;
  calmThieves(j);
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
  flash(
    'Mission gescheitert!',
    {
      time: 'Zeit abgelaufen',
      wreck: 'Fahrzeug Schrott',
      cargo: 'Ladung kaputt',
      wood: 'Kein Holz mehr am Hänger',
      seen: 'Die Wache hat dich gesehen',
      dog: 'Der Schäferhund hat dich gestellt',
      gone: 'Entkommen',
      busted: '',
      wasted: '',
    }[why]
  );
  audio.play('fail');
  if (why !== 'busted') {
    page(pick(TALK.scold));
  }
}

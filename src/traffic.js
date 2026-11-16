/**
 * @fileoverview Traffic and police: the cars the computer drives.
 */

import * as audio from './audio.js';
import {hitch, makeCar} from './cars.js';
import {flash, page} from './effects.js';
import {pip} from './geometry.js';
import {at} from './grid.js';
import {failJob} from './jobs.js';
import {AREAS, NODES, SEGS, surfAt, town} from './land.js';
import {TALK} from './missions.js';
import {spawnPed} from './people.js';
import {MODELLED, SPOT, downhill, field} from './places.js';
import {ROOFS, fromFrame} from './roofs.js';
import {blocked, treeGrid} from './scenery.js';
import {COLORS} from './sprites.js';
import {fmt, state} from './state.js';
import {CROSSINGS} from './train.js';
import {WORLD_H, WORLD_W, clamp, dist, lerp, pick, rng, wrap} from './util.js';

/**
 * Where an AI car turns next; wide roads and gentle turns are more likely.
 * @param {number} from
 * @param {number} to
 * @param {!Object} ai
 * @return {number} The junction index, or -1 when the road leaves the map.
 */
function nextNode(from, to, ai) {
  const a = NODES[from];
  const b = NODES[to];
  const chase = ai.cop ? state.copF : ai.thief ? state.thiefF : null;
  if (chase) {
    const n = downhill(chase, to);
    if (n >= 0) {
      return n;
    }
  }
  let opts = b.car.filter(e => e.n !== from);
  if (ai.flee) {
    // the getaway driver stays in the village
    const stay = opts.filter(e => {
      const n = NODES[e.n];
      return n.x > 40 && n.y > 40 && n.x < WORLD_W - 40 && n.y < WORLD_H - 40;
    });
    opts = stay.length ? stay : b.car.filter(e => e.n === from);
  }
  if (!opts.length) {
    return -1;
  }
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  let total = 0;
  for (const e of opts) {
    const c = NODES[e.n];
    total += e.k =
      e.w * e.w * (1.3 + Math.cos(Math.atan2(c.y - b.y, c.x - b.x) - dir));
  }
  let r = Math.random() * total;
  return (opts.find(e => (r -= e.k) < 0) || opts[0]).n;
}

/**
 * Steers a computer-driven car: traffic, police and getaway drivers.
 * @param {!Car} c
 * @param {number} dt
 */
export function driveAI(c, dt) {
  const ai = c.ai;
  const a = NODES[ai.from];
  const b = NODES[ai.to];
  const player = state.player;
  const hunt = ((ai.cop && state.wanted >= 1) || ai.thief) && !state.wasted;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const along = (c.x - a.x) * dx + (c.y - a.y) * dy;
  const lane = Math.min(a.w, b.w) / 4; // drive on the right
  if (along > len - 2) {
    const n = nextNode(ai.from, ai.to, ai);
    if (n < 0) {
      c.gone = true;
    } // left the map
    else {
      ai.from = ai.to;
      ai.to = n;
    }
    return;
  }
  const s = Math.min(len, along + 5 + c.vf * 0.4);
  const near = hunt && dist(c, player) < 45;
  let tx = a.x + dx * s - dy * lane;
  let ty = a.y + dy * s + dx * lane;
  if (near) {
    tx = player.x + (player.car ? player.car.vx * 0.4 : 0);
    ty = player.y + (player.car ? player.car.vy * 0.4 : 0);
  } // close enough: go straight for the player
  const err = wrap(Math.atan2(ty - c.y, tx - c.x) - c.a);
  const fast = hunt || ai.flee || ai.rage > 0;
  const want =
    (2 + Math.min(a.w, b.w) * 1.6) *
    (hunt || ai.flee ? 2 : ai.rage > 0 ? 1.6 : 1) *
    (1 - 0.7 * Math.min(1, Math.abs(err)));
  const fx = Math.cos(c.a);
  const fy = Math.sin(c.a);
  const reach = 5 + c.vf * 0.9;
  const ahead = o => {
    const rx = o.x - c.x;
    const ry = o.y - c.y;
    const f = rx * fx + ry * fy;
    return f > 0 && f < reach && Math.abs(ry * fx - rx * fy) < 1.7;
  };
  // A level crossing ahead is shut while the train passes: everybody waits,
  // the police too, and nobody gets tired of waiting.
  const gate = CROSSINGS.some(k => {
    const rx = k.x - c.x;
    const ry = k.y - c.y;
    const f = rx * fx + ry * fy;
    return k.shut && f > 0 && f < reach + 6 && Math.abs(ry * fx - rx * fy) < 4;
  });
  const block =
    gate ||
    (!fast &&
      !(ai.push > 0) &&
      (state.cars.some(o => o !== c && ahead(o)) ||
        state.peds.some(ahead) ||
        (state.mode === 'play' && !player.car && ahead(player))));
  ai.wait = block && !gate ? ai.wait + dt : 0;
  if (ai.wait > 5) {
    ai.push = 2;
  } // tired of waiting: shove through
  ai.push -= dt;
  ai.rage -= dt;
  c.thr = block
    ? c.vf > 0.3
      ? -1
      : 0
    : c.vf < want
      ? fast
        ? 1
        : 0.7
      : c.vf > want + 2
        ? -0.4
        : 0;
  c.hb = block && c.vf < 1;
  c.steer = clamp(err * 2.2, -1, 1);
  if (
    near &&
    dist(c, player) < 9 &&
    (player.car ? Math.abs(player.car.vf) : 0) < 4
  ) {
    c.thr = c.vf > 1 ? -1 : 0;
    c.hb = true;
  } // box the player in
  if (!block && !c.hb && Math.abs(c.vf) < 0.5) {
    ai.stuck += dt;
  } else if (c.vf > 1.5) {
    ai.stuck = 0;
  }
  if (ai.stuck > 1.5) {
    ai.stuck = 0;
    ai.rev = 1.3;
    ai.jams++;
  } // nose against something: back up
  if (ai.rev > 0) {
    ai.rev -= dt;
    c.thr = -1;
    c.steer = -c.steer;
  }
}
export const newAI = (from, to, more) =>
  Object.assign(
    {from, to, wait: 0, push: 0, rage: 0, stuck: 0, rev: 0, jams: 0},
    more
  );

/**
 * Raises the wanted level.
 * @param {number} heat
 */
export function crime(heat) {
  state.wanted = Math.min(4, state.wanted + heat);
  state.seen = 8;
}

/**
 * Runs the wanted level, the patrol cars and arrests.
 * @param {number} dt
 */
export function police(dt) {
  const player = state.player;
  let cops = 0; // patrol cars on duty
  let close = 1e9; // and how far away the nearest one is
  for (const c of state.cars) {
    if (c.ai && c.ai.cop && !c.dead) {
      cops++;
      close = Math.min(close, dist(c, player));
    }
  }
  if (state.wanted > 0) {
    state.seen -= dt;
    state.wanted = Math.max(
      0,
      state.wanted - dt * (close < 90 ? 0.012 : state.seen > 0 ? 0.04 : 0.14)
    ); // heat cools off once nobody is looking
  }
  if (cops && state.wanted < 1) {
    for (const c of state.cars) {
      if (c.ai && c.ai.cop && !c.dead) {
        c.ai.cop = false;
        c.siren = false;
      }
    }
  } // off duty: back to normal traffic
  audio.siren(
    state.wanted >= 1 && close < 170 && state.mode === 'play' && !state.paused
  );
  if (state.wanted < 1 || state.mode !== 'play') {
    state.bust = 0;
    return;
  }
  if ((state.copT -= dt) <= 0) {
    state.copT = 1;
    state.copF = field(player);
  }
  if (
    cops < Math.min(3, Math.floor(state.wanted)) &&
    Math.random() < dt * 1.2
  ) {
    const spots = NODES.filter(n => {
      const d = dist(n, player);
      return (
        d > 110 &&
        d < 230 &&
        n.gps.length &&
        n.x > 0 &&
        n.y > 0 &&
        n.x < WORLD_W &&
        n.y < WORLD_H
      );
    });
    const a = pick(spots);
    if (a) {
      const i = NODES.indexOf(a);
      const to = downhill(state.copF, i);
      if (to >= 0) {
        const c = makeCar(
          a.x,
          a.y,
          Math.atan2(NODES[to].y - a.y, NODES[to].x - a.x),
          'police'
        );
        c.ai = newAI(i, to, {cop: true});
        c.siren = true;
      }
    }
  }
  // caught: a patrol car right next to you while you are slow
  const slow = (player.car ? Math.hypot(player.car.vx, player.car.vy) : 0) < 3;
  state.bust =
    close < (player.car ? 7 : 5) && slow && !state.wasted
      ? state.bust + dt
      : Math.max(0, state.bust - dt * 2);
  if (state.bust > 1.6) {
    busted();
  }
}

/** The police got you: a fine, and back to the town hall on foot. */
function busted() {
  const player = state.player;
  const fine = Math.round((state.money * 0.1) / 5) * 5;
  const r = SPOT.townhall;
  state.stats.busted++;
  state.money -= fine;
  state.wanted = 0;
  state.bust = 0;
  if (player.car) {
    Object.assign(player.car, {thr: 0, steer: 0});
    player.car = null;
    audio.radio(-1);
  }
  flash(
    'Erwischt!',
    fine ? `Strafzettel: ${fmt(fine)}` : 'Nochmal Glück gehabt'
  );
  audio.play('fail');
  if (state.job) {
    failJob('busted');
  }
  for (const c of state.cars) {
    if (c.ai && c.ai.cop) {
      c.gone = true;
    }
  }
  Object.assign(player, {x: r.x, y: r.y, a: r.a});
  page(pick(TALK.busted));
}

/**
 * Keeps the streets around the player busy.
 * @param {number} dt
 * @param {number} near How close things may appear.
 */
export function populate(dt, near) {
  const player = state.player;
  const f = state.mode === 'play' ? player : state.cam;
  const j = state.job;
  // Both lists are thinned out in place, in order, without a new list each
  // update
  const cars = state.cars;
  let n = 0;
  for (const c of cars) {
    const keep = c === player.car || (j && (c === j.veh || c === j.prey));
    if (
      (keep && !c.gone) ||
      !(
        c.gone ||
        ((c.ai || c.dead) && dist(c, f) > 300) ||
        (c.ai && c.ai.jams > 4 && dist(c, f) > 110)
      )
    ) {
      cars[n++] = c;
    }
  }
  cars.length = n;
  const peds = state.peds;
  n = 0;
  for (const p of peds) {
    if (dist(p, f) < 230) {
      peds[n++] = p;
    }
  }
  peds.length = n;
  if ((state.spawnT -= dt) > 0) {
    return;
  }
  state.spawnT = 0.3;
  const spots = NODES.filter(n => {
    const d = dist(n, f);
    return d > near && d < 250;
  });
  if (state.cars.filter(c => c.ai).length < 13) {
    const a = pick(spots.filter(n => n.car.length));
    if (a && !state.cars.some(c => dist(c, a) < 14)) {
      const to = pick(a.car).n;
      const b = NODES[to];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const r = Math.random();
      const c = makeCar(
        a.x - (Math.sin(ang) * a.w) / 4,
        a.y + (Math.cos(ang) * a.w) / 4,
        ang,
        r < 0.6
          ? 'car'
          : r < 0.78
            ? 'van'
            : r < 0.86
              ? 'sport'
              : r < 0.93
                ? 'tractor'
                : r < 0.97
                  ? 'truck'
                  : 'tipper'
      );
      c.ai = newAI(NODES.indexOf(a), to);
      if (c.kind === 'tractor' && Math.random() < 0.5) {
        hitch(c, 'grain');
      }
    }
  }
  if (state.peds.length < 24) {
    const a = pick(spots.filter(n => n.walk.length));
    if (a) {
      // On the pavement, not in the middle of the road
      const p = spawnPed(a.x, a.y, NODES.indexOf(a), pick(a.walk));
      const b = NODES[p.to];
      const off = ((a.w / 2 + 0.9) * p.side) / (dist(a, b) || 1);
      p.x -= (b.y - a.y) * off;
      p.y += (b.x - a.x) * off;
    }
  }
}

/** Fills the car parks in tidy rows and lines the kerbs. */
export function parkCars() {
  const r = rng(11);
  for (const a of AREAS) {
    if (a.k === 'park') {
      const ca = Math.cos(a.ang);
      const sa = Math.sin(a.ang);
      const radius = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2;
      for (let u = -radius; u < radius; u += 2.8) {
        for (let v = -radius; v < radius; v += 5.8) {
          const x = a.mx + ca * u - sa * v;
          const y = a.my + sa * u + ca * v;
          const ex = -sa * 2.7;
          const ey = ca * 2.7;
          const take = r() < 0.42;
          const flip = r() < 0.5;
          const kind = r();
          const free = (px, py) =>
            pip(px, py, a.p) &&
            !(surfAt(px, py) & 4) &&
            !at(treeGrid, px, py).some(t => Math.hypot(t.x - px, t.y - py) < 3);
          if (
            !take ||
            !free(x, y) ||
            !free(x + ex, y + ey) ||
            !free(x - ex, y - ey)
          ) {
            continue;
          }
          if (blocked(x, y, 3)) {
            continue;
          }
          makeCar(
            x,
            y,
            a.ang + Math.PI / 2 + (flip ? Math.PI : 0),
            kind < 0.8 ? 'car' : kind < 0.93 ? 'van' : 'sport',
            COLORS[(r() * COLORS.length) | 0]
          );
        }
      }
    }
  }
  // What belongs to a place stands there, mission or not, ready to be taken.
  const fleet = [
    ['fire', 'firestation'],
    ['mixer', 'depot'],
    ['truck', 'drinks'],
    ['pizza', 'lavite'],
    ['tractor', 'farmyard'],
  ];
  for (const [kind, key] of fleet) {
    makeCar(SPOT[key].x, SPOT[key].y, SPOT[key].a, kind);
  }
  for (const b of MODELLED) {
    // The cars of a modelled house, on its drive: nose to the north of the
    // house, turned by the angle given
    for (const [u, v, turn, col, kind = 'car'] of ROOFS[b.poi].cars || []) {
      const [x, y] = fromFrame(b, u, v);
      makeCar(x, y, Math.atan2(-b.ca, b.sa) + turn, kind, col);
    }
  }
  for (let i = 0; i < 46; i++) {
    // and a few along the kerb in the village
    const s = SEGS[(r() * SEGS.length) | 0];
    const t = r();
    const kind = r();
    const flip = r() < 0.5;
    const col = COLORS[(r() * COLORS.length) | 0];
    if (!town(s[6]) || s[5] < 14) {
      continue;
    }
    const off = s[4] / 2 + 0.2;
    const x = lerp(s[0], s[2], t) - ((s[3] - s[1]) / s[5]) * off;
    const y = lerp(s[1], s[3], t) + ((s[2] - s[0]) / s[5]) * off;
    if (
      blocked(x, y, 2.6) ||
      state.cars.some(c => Math.hypot(c.x - x, c.y - y) < 7) ||
      NODES.some(n => n.car.length > 2 && Math.hypot(n.x - x, n.y - y) < 12)
    ) {
      continue;
    }
    makeCar(
      x,
      y,
      Math.atan2(s[3] - s[1], s[2] - s[0]) + (flip ? Math.PI : 0),
      kind < 0.85 ? 'car' : kind < 0.95 ? 'van' : 'sport',
      col
    );
  }
}

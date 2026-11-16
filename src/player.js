/**
 * @fileoverview The player: steering, getting in and out, the horn, and wasted.
 */

import * as audio from './audio.js';
import {buildingGrid} from './buildings.js';
import {bail} from './cars.js';
import {decal, flash, info, page, puff} from './effects.js';
import {pushOut} from './geometry.js';
import {at} from './grid.js';
import {carAt, failJob} from './jobs.js';
import {NODES, surfAt} from './land.js';
import {TALK} from './missions.js';
import {nearNode} from './places.js';
import {fmt, state} from './state.js';
import {crime} from './traffic.js';
import {clamp, dist, pick, wrap} from './util.js';

export const keys = {};
export const pad = {x: 0, y: 0, brake: false, horn: false, nos: false};
const axis = (neg, pos) =>
  (pos.some(k => keys[k]) ? 1 : 0) - (neg.some(k => keys[k]) ? 1 : 0);

/**
 * Keeps a walker out of buildings.
 * @param {!Point} o
 * @param {number} r
 */
export function shove(o, r) {
  if (surfAt(o.x, o.y) & 2) {
    return;
  }
  for (const b of at(buildingGrid, o.x, o.y)) {
    if (o.x < b.x0 - r || o.x > b.x1 + r || o.y < b.y0 - r || o.y > b.y1 + r) {
      continue; // too far to touch
    }
    const h = pushOut(o.x, o.y, r, b.p);
    if (h) {
      o.x += h[0] * h[2];
      o.y += h[1] * h[2];
    }
  }
}

/**
 * Turns keys and the thumb stick into driving and walking.
 * @param {number} dt
 */
export function controlPlayer(dt) {
  const player = state.player;
  const c = player.car;
  const stick = Math.hypot(pad.x, pad.y);
  if (state.wasted) {
    if ((state.wasted -= dt) <= 0) {
      respawn();
    }
    return;
  }
  let thr = axis(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']);
  let steer = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
  const wet = (surfAt(player.x, player.y) & 9) === 8;
  if (c) {
    if (stick > 0.15) {
      // thumb stick: point where you want to go
      const err = wrap(Math.atan2(pad.y, pad.x) - c.a);
      steer = clamp(err * 2.2, -1, 1) * (c.vf < -1 ? -1 : 1);
      thr = Math.min(1, stick * 1.3) * (Math.abs(err) > 1.4 ? 0.55 : 1);
    }
    if (pad.brake) {
      thr = -1;
    }
    const tipsy = clamp(state.drunk / 4, 0, 1);
    if (tipsy) {
      // drunk: the wheel wanders
      steer +=
        (Math.sin(state.t * 1.7) * 0.4 + Math.sin(state.t * 4.3) * 0.15) *
        tipsy;
    }
    c.thr = thr;
    c.steer = clamp(steer, -1, 1);
    // NoS from Bernhard's garage: Shift, or the NOS button, while on the gas
    const nos = !!(keys.ShiftLeft || keys.ShiftRight || pad.nos);
    const firing = nos && c.nos > 0 && thr > 0;
    if (firing && !c.boosting) {
      audio.play('nos');
    }
    c.boosting = firing;
    c.hb = !!keys.Space;
    c.siren =
      (c.kind === 'police' || c.kind === 'fire') && (keys.KeyH || pad.horn);
    return;
  }
  // Shift, or the brake button on a phone, makes you run
  const run = keys.ShiftLeft || keys.ShiftRight || pad.brake ? 1.7 : 1;
  let sp = thr * (thr > 0 ? 4.5 * run : 2);
  if (stick > 0.15) {
    player.a = Math.atan2(pad.y, pad.x);
    sp = Math.min(1, stick * 1.3) * 4.5 * run;
  } else {
    player.a += steer * 3.5 * dt;
  }
  if (wet) {
    sp *= 0.4;
    if (sp && Math.random() < dt * 8) {
      puff(player.x, player.y, 'water');
    }
  } // wading
  player.x += Math.cos(player.a) * sp * dt;
  player.y += Math.sin(player.a) * sp * dt;
  const lurch = clamp(state.drunk / 4, 0, 1) * Math.sin(state.t * 2.4) * 2;
  if (sp && lurch) {
    // drunk: a step to the side now and then
    player.x -= Math.sin(player.a) * lurch * dt;
    player.y += Math.cos(player.a) * lurch * dt;
  }
  player.t += Math.abs(sp) * dt;
  shove(player, 0.4);
}

/** Gets into the nearest car, or out of this one. */
export function toggleCar() {
  const player = state.player;
  const c = player.car;
  if (state.wasted || state.paused || state.mode !== 'play') {
    return;
  }
  if (c) {
    if (Math.hypot(c.vx, c.vy) > 5 && !c.burn) {
      return;
    } // jump out of a burning car at any speed
    const side = c.type.width / 2 + 0.8; // driver's door is on the left
    Object.assign(player, {
      x: c.x + Math.sin(c.a) * side,
      y: c.y - Math.cos(c.a) * side,
      a: c.a,
      car: null,
    });
    c.thr = c.steer = 0;
    c.alt = 0; // a helicopter sets down at once
    c.hb = false;
    c.siren = false;
    c.boosting = false;
    audio.radio(-1);
    audio.play('door');
    return;
  }
  let best = null;
  let bd = 4.2;
  for (const o of state.cars) {
    // the nearest car; the one Flo wants counts as closer
    const d =
      dist(o, player) -
      o.type.length / 4 -
      (state.job && o === state.job.veh ? 2.5 : 0);
    if (!o.dead && !o.burn && d < bd) {
      bd = d;
      best = o;
    }
  }
  if (!best) {
    return;
  }
  if (best.ai) {
    if (best.ai.cop) {
      crime(1);
    } else if (!(state.job && best === state.job.prey)) {
      crime(0.35);
    }
    bail(best);
    state.stats.stolen++;
  }
  player.car = best;
  audio.play('door');
  audio.radio(best.radio);
  info(
    best.name + (best.radio >= 0 ? ` · ♪ ${audio.stations[best.radio]}` : '')
  );
}

/** Turns the radio dial. */
export function nextStation() {
  const c = state.player.car;
  if (!c) {
    return;
  }
  c.radio = c.radio >= audio.stations.length - 1 ? -1 : c.radio + 1;
  audio.radio(c.radio);
  info(c.radio < 0 ? 'Radio aus' : `♪ ${audio.stations[c.radio]}`);
}
/** Sounds the horn; pedestrians jump. */
export function honk() {
  const c = state.player.car;
  if (!c || c.kind === 'police' || c.kind === 'fire') {
    return;
  }
  audio.play('horn');
  for (const p of state.peds) {
    if (dist(p, c) < 14 && p.flee <= 0) {
      p.flee = 1.2;
      p.a = Math.atan2(p.y - c.y, p.x - c.x);
    }
  }
}

/**
 * The player dies.
 * @param {string=} title
 */
export function waste(title = 'Erledigt!') {
  const player = state.player;
  if (state.wasted || state.mode !== 'play') {
    return;
  }
  const lost = Math.round((state.money * 0.1) / 5) * 5;
  state.wasted = 3.2;
  state.money -= lost;
  state.stats.wasted++;
  state.wanted = 0;
  if (player.car) {
    player.car.thr = player.car.steer = 0;
    player.car = null;
    audio.radio(-1);
  }
  flash(title, lost ? `Krankenhaus Höchstadt: ${fmt(lost)}` : '');
  audio.play('fail');
  for (let i = 0; i < 12; i++) {
    puff(player.x, player.y, 'blood');
  }
  decal(player.x, player.y, 'blood');
  if (state.job) {
    failJob('wasted');
  }
  page(pick(TALK.wasted));
}

/** Back on the road in a fresh car, at the nearest junction. */
function respawn() {
  const player = state.player;
  const best = NODES[nearNode(player, 'car')];
  player.car = carAt(best, NODES[best.car[0].n], 'car', '#e0b21c');
  audio.radio(player.car.radio);
  state.wasted = 0;
}

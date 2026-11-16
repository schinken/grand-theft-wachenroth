/**
 * @fileoverview What you see and hear of what happens: puffs, decals, floating
 * words, the flash, the info line and the pager.
 */

import * as audio from './audio.js';
import {state} from './state.js';
import {TAU, byId, rand} from './util.js';

/**
 * Emits one particle.
 * @param {number} x
 * @param {number} y
 * @param {string} kind
 */
export function puff(x, y, kind) {
  if (state.parts.length > 400) {
    return;
  }
  const a = rand(0, TAU);
  const sp =
    kind === 'spark'
      ? rand(4, 12)
      : kind === 'blood' ||
          kind === 'water' ||
          kind === 'dung' ||
          kind === 'dirt'
        ? rand(1, 6)
        : rand(0.2, 1.5);
  state.parts.push({
    x,
    y,
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp,
    kind,
    life: 0,
    max: {
      spark: 0.3,
      smoke: 1.4,
      blood: 0.35,
      fire: 0.5,
      water: 0.6,
      dung: 0.6,
      dirt: 0.6,
    }[kind],
  });
}
/**
 * Leaves a stain on the ground.
 * @param {number} x
 * @param {number} y
 * @param {string} kind
 */
export function decal(x, y, kind) {
  for (let i = 0; i < (kind === 'stump' ? 1 : 3); i++) {
    state.decals.push({
      x: x + rand(-0.8, 0.8),
      y: y + rand(-0.8, 0.8),
      r:
        kind === 'blood'
          ? rand(0.4, 1)
          : kind === 'stump'
            ? 0.55
            : kind === 'dirt'
              ? rand(0.5, 1.1)
              : rand(1.5, 2.6),
      kind,
    });
  }
  if (state.decals.length > 120) {
    state.decals.splice(0, 3);
  }
}
export const float = (o, s, col = '#ffd23e') =>
  state.texts.push({x: o.x, y: o.y, s, life: 1.5, col});
/**
 * Shows an element and restarts its CSS animation.
 * @param {!Element} el
 */
export function replay(el) {
  el.hidden = false;
  el.style.animation = 'none';
  el.offsetWidth;
  el.style.animation = '';
}
/**
 * Big letters across the screen.
 * @param {string} big
 * @param {string=} small
 */
export function flash(big, small = '') {
  const el = byId('flash');
  el.firstElementChild.textContent = big;
  el.lastElementChild.textContent = small;
  replay(el);
}
/**
 * The small line at the bottom: car names, radio stations.
 * @param {string} text
 */
export function info(text) {
  byId('info').textContent = text;
  replay(byId('info'));
}

/**
 * Flo is calling: queues his messages for the pager.
 * @param {...string} msgs
 */
export function page(...msgs) {
  const pg = state.pager;
  if (!pg.q.length && !pg.cur) {
    replay(byId('pager').firstElementChild);
    byId('pager').classList.add('ring');
    audio.play('pager');
  }
  pg.q.push(...msgs);
}

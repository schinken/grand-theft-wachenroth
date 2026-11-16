/**
 * @fileoverview Things lying around: money on the street, and what a job wants.
 */

import * as audio from './audio.js';
import {decal, float, puff} from './effects.js';
import {NODES, SEGS, SEG_MAX, surfAt} from './land.js';
import {knockPed, spawnPed} from './people.js';
import {nearNode} from './places.js';
import {fmt, state} from './state.js';
import {TAU, WORLD_H, WORLD_W, lerp, pick, rand} from './util.js';

/**
 * A random spot on a road, uniform by length.
 * @param {function(number, number):} ok boolean
 * @return {({x: number, y: number}|undefined)}
 */
export function roadPoint(ok) {
  for (let n = 0; n < 600; n++) {
    const s = pick(SEGS);
    if (Math.random() * SEG_MAX > s[5]) {
      continue;
    }
    const t = Math.random();
    const o = rand(-0.3, 0.3) * s[4];
    const x = lerp(s[0], s[2], t) - ((s[3] - s[1]) / s[5]) * o;
    const y = lerp(s[1], s[3], t) + ((s[2] - s[0]) / s[5]) * o;
    if (
      x > 15 &&
      y > 15 &&
      x < WORLD_W - 15 &&
      y < WORLD_H - 15 &&
      !(surfAt(x, y) & 10) &&
      ok(x, y)
    ) {
      return {x, y};
    }
  }
}
/** Leaves a banknote somewhere on a road. */
export function dropCash() {
  const spot = roadPoint(
    (x, y) =>
      Math.hypot(x - state.player.x, y - state.player.y) > 30 &&
      !state.items.some(v => Math.hypot(v.x - x, v.y - y) < 20)
  );
  if (spot) {
    state.items.push({
      ...spot,
      kind: 'cash',
      val: pick([5, 10, 10, 20, 20, 50, 100]),
      ph: rand(0, TAU),
    });
  }
}
/**
 * Picks something up.
 * @param {!Object} v
 */
export function grab(v) {
  audio.play('coin');
  if (v.kind === 'cash') {
    state.money += v.val;
    float(v, `+${fmt(v.val)}`);
    dropCash();
    return;
  }
  const j = state.job;
  if (v.tree) {
    // The saw: down comes the tree, a stump is left
    v.tree.cut = true;
    decal(v.tree.x, v.tree.y, 'stump');
    for (let i = 0; i < 12; i++) {
      puff(v.tree.x + rand(-2, 2), v.tree.y + rand(-2, 2), 'smoke');
    }
    float(v.tree, 'RATSCH!', '#ff5a1f');
    audio.play('saw');
  }
  if (v.kind === 'hen') {
    audio.play('cluck');
  }
  if (v.kind === 'rocker') {
    // BONK: he flies a bit, then runs home, unhurt and a lot quieter
    const n = nearNode(v, 'walk');
    const p = spawnPed(v.x, v.y, n, NODES[n].walk[0]);
    const away = Math.atan2(v.y - state.player.y, v.x - state.player.x);
    Object.assign(p, {shirt: '#16161a', hair: v.hair, mane: true});
    knockPed(p, Math.cos(away) * 9, Math.sin(away) * 9);
    audio.play('bonk');
    state.shake = 0.35;
  }
  const left = state.items.filter(o => o.job).length;
  const gift = {xmas: ' · Spende +20 €', rocker: ' · BONK! -10 dB'}[v.kind];
  float(v, `${left ? `noch ${left}` : 'Alles da!'}${gift || ''}`);
  if (j) {
    j.got++;
  }
}

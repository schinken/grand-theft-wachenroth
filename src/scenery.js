/**
 * @fileoverview Trees and street furniture: lanterns, hydrants and the like.
 */

import {MAP} from '../map.js';
import {BUILD, buildingGrid} from './buildings.js';
import {nearest, pip, pushOut} from './geometry.js';
import {at, grid, gridAdd} from './grid.js';
import {AREAS, DRIVE, NODES, SEGS, surfAt, town} from './land.js';
import {ROOFS, fromFrame} from './roofs.js';
import {EDGE, WORLD_H, WORLD_W, clamp, rng} from './util.js';

/**
 * A lantern or a hydrant: kind k, position, and whether it is knocked down.
 * @typedef {!Object}
 */
let Prop;

export const TREES = [];
export const treeGrid = grid();
{
  const r = rng(3);
  // `gap` is how far a trunk keeps from walls and from the ground it must
  // not stand on: `off`, as bits of the ground lookup.
  const add = (tx, ty, size, tall = 4 + r() * 5, gap = 3, off = 15) => {
    if (
      [
        [0, 0],
        [gap, 0],
        [-gap, 0],
        [0, gap],
        [0, -gap],
      ].some(o => surfAt(tx + o[0], ty + o[1]) & off)
    ) {
      return;
    }
    if (at(buildingGrid, tx, ty).some(b => pushOut(tx, ty, gap, b.p))) {
      return;
    }
    const t = {
      x: tx,
      y: ty,
      r: size + r() * 1.8,
      h: tall,
      s: (r() * 3) | 0,
    };
    TREES.push(t);
    gridAdd(treeGrid, t, tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6);
  };
  const plant = (a, step, chance, size, jitter = 1) => {
    for (
      let y = Math.max(a.y0, -EDGE);
      y < Math.min(a.y1, WORLD_H + EDGE);
      y += step
    ) {
      for (
        let x = Math.max(a.x0, -EDGE);
        x < Math.min(a.x1, WORLD_W + EDGE);
        x += step
      ) {
        const tx = x + r() * step * jitter;
        const ty = y + r() * step * jitter;
        if (r() < chance && pip(tx, ty, a.p)) {
          add(tx, ty, size);
        }
      }
    }
  };
  for (const a of AREAS) {
    // Bushes and fruit trees are too low for the tree survey: made up.
    if (a.k === 'scrub') {
      plant(a, 11, 0.6, 1.6);
    }
    if (a.k === 'orchard') {
      plant(a, 8, 1, 1.4, 0.2);
    }
  }
  // Every surveyed tree: x, y and its height, which decides how wide and how
  // high it is drawn. A height of 0 means nobody measured it. They stand
  // where they really stand: close to a road or a wall, and in yards and car
  // parks, only not on the road itself or in the water.
  for (let i = 0; i < MAP.trees.length; i += 3) {
    const tall = MAP.trees[i + 2] || 12;
    add(
      MAP.trees[i],
      MAP.trees[i + 1],
      clamp(tall * 0.12, 1, 3),
      clamp(tall * 0.35, 3.5, 9.5),
      1.5,
      12
    );
  }
  for (const b of BUILD) {
    // The trees of the modelled places come last, so that adding some does
    // not change how the other trees look.
    for (const [u, v, size, tall] of (ROOFS[b.poi] && ROOFS[b.poi].trees) ||
      []) {
      const [x, y] = fromFrame(b, u, v);
      add(x, y, size, tall, 1);
    }
  }
}
export const blocked = (x, y, r) =>
  at(buildingGrid, x, y).some(b => pushOut(x, y, r, b.p));

// Street furniture: lanterns and hydrants give way when a car hits them.
export const streetProps = [];
export const propGrid = grid();
{
  const r = rng(5);
  const crossings = NODES.filter(n => n.gps.length > 2);
  const put = (k, x, y, a) => {
    if (
      blocked(x, y, 0.9) ||
      x < 6 ||
      y < 6 ||
      x > WORLD_W - 6 ||
      y > WORLD_H - 6 ||
      crossings.some(n => Math.hypot(n.x - x, n.y - y) < 8)
    ) {
      return;
    }
    const o = {k, x, y, a, down: 0, fa: 0};
    streetProps.push(o);
    gridAdd(propGrid, o, x - 1, y - 1, x + 1, y + 1);
  };
  for (const road of MAP.roads) {
    if (DRIVE.includes(road.t) && town(road)) {
      // a lantern every 36 m, changing sides; now and then a hydrant
      let run = r() * 30;
      let n = (r() * 5) | 0;
      for (let i = 0; i + 3 < road.p.length; i += 2) {
        const ax = road.p[i];
        const ay = road.p[i + 1];
        const len = Math.hypot(road.p[i + 2] - ax, road.p[i + 3] - ay) || 1;
        const dx = (road.p[i + 2] - ax) / len;
        const dy = (road.p[i + 3] - ay) / len;
        for (; run < len; run += 36, n++) {
          const side = n % 2 ? 1 : -1;
          const off = road.w / 2 + 1.1;
          put(
            'lamp',
            ax + dx * run - dy * off * side,
            ay + dy * run + dx * off * side,
            Math.atan2(-dx * side, dy * side)
          );
          if (n % 4 === 1 && run + 15 < len) {
            put(
              'hydrant',
              ax + dx * (run + 15) + dy * (off - 0.2) * side,
              ay + dy * (run + 15) - dx * (off - 0.2) * side,
              0
            );
          }
        }
        run -= len;
      }
    }
  }
}

/**
 * Where you pull up for a place: at the edge of the nearest road, on the side
 * the place is on.
 * @param {number} x
 * @param {number} y
 * @return {{x: number, y: number, a: number}}
 */
export function roadside(x, y) {
  let best = 1e9;
  let q = null;
  let seg = null;
  for (const s of SEGS) {
    const p = nearest(x, y, s[0], s[1], s[2], s[3]);
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < best) {
      best = d;
      q = p;
      seg = s;
    }
  }
  const a = Math.atan2(seg[3] - seg[1], seg[2] - seg[0]);
  for (let off = Math.min(best, seg[4] / 2 + 2); off > 0; off -= 1) {
    const sx = q[0] + ((x - q[0]) / (best || 1)) * off;
    const sy = q[1] + ((y - q[1]) / (best || 1)) * off;
    if (!blocked(sx, sy, 2.2)) {
      return {x: sx, y: sy, a};
    }
  }
  return {x: q[0], y: q[1], a};
}

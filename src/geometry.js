/**
 * @fileoverview Points, segments and outlines. World units are metres.
 */

import {clamp} from './util.js';

/**
 * A point in the world, in metres.
 * @typedef {{x: number, y: number}}
 */
let Point;

/**
 * An outline as a flat list of x, y pairs, clockwise.
 * @typedef {!Array<number>}
 */
let Polygon;

/**
 * The closest point to (x, y) on the segment a-b.
 * @param {number} x
 * @param {number} y
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @return {!Array<number>}
 */
export function nearest(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(
    ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
    0,
    1
  );
  return [ax + dx * t, ay + dy * t];
}

/**
 * Whether a point lies inside a polygon.
 * @param {number} x
 * @param {number} y
 * @param {!Polygon} p
 * @return {boolean}
 */
export function pip(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (
      p[i + 1] > y !== p[j + 1] > y &&
      x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Circle against polygon.
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {!Polygon} p
 * @return {?Array<number>} [nx, ny, depth] that pushes the circle out, or null
 *     when they do not touch.
 */
export function pushOut(x, y, r, p) {
  let best = 1e9;
  let qx = 0;
  let qy = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const q = nearest(x, y, p[j], p[j + 1], p[i], p[i + 1]);
    const d = (x - q[0]) ** 2 + (y - q[1]) ** 2;
    if (d < best) {
      best = d;
      qx = q[0];
      qy = q[1];
    }
  }
  const d = Math.sqrt(best);
  const inside = pip(x, y, p);
  if (!inside && d >= r) {
    return null;
  }
  const nx = (x - qx) / (d || 1);
  const ny = (y - qy) / (d || 1);
  return inside ? [-nx, -ny, d + r] : [nx, ny, r - d];
}

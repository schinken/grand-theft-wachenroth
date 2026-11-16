/**
 * @fileoverview A uniform grid of buckets over the world, for finding
 * buildings, trees and street furniture near a point.
 */

import {WORLD_H, WORLD_W, clamp} from './util.js';

/**
 * A uniform grid of buckets, for finding buildings, trees and street
 * furniture near a point.
 * @typedef {!Array<!Array<!Object>>}
 */
let Grid;

// Uniform grid for buildings and trees.
const CELL = 40;
const GRID_W = Math.ceil(WORLD_W / CELL) + 4;
const GRID_H = Math.ceil(WORLD_H / CELL) + 4;
const cell = (v, n) => clamp(Math.floor(v / CELL) + 2, 0, n - 1);
export const grid = () => Array.from({length: GRID_W * GRID_H}, () => []);
export const at = (g, x, y) => g[cell(y, GRID_H) * GRID_W + cell(x, GRID_W)];
/**
 * Files an object under every grid cell its bounding box touches.
 * @param {!Grid} g
 * @param {!Object} o
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function gridAdd(g, o, x0, y0, x1, y1) {
  for (let y = cell(y0, GRID_H); y <= cell(y1, GRID_H); y++) {
    for (let x = cell(x0, GRID_W); x <= cell(x1, GRID_W); x++) {
      g[y * GRID_W + x].push(o);
    }
  }
}
let stamp = 0;
/**
 * Everything filed under the cells of a rectangle, each object once.
 * @param {!Grid} g
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @return {!Array<!Object>}
 */
export function gridFind(g, x0, y0, x1, y1) {
  const out = [];
  stamp++;
  for (let y = cell(y0, GRID_H); y <= cell(y1, GRID_H); y++) {
    for (let x = cell(x0, GRID_W); x <= cell(x1, GRID_W); x++) {
      for (const o of g[y * GRID_W + x]) {
        if (o.stamp !== stamp) {
          o.stamp = stamp;
          out.push(o);
        }
      }
    }
  }
  return out;
}

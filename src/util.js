/**
 * @fileoverview Small helpers and the numbers every module shares.
 */

import {MAP} from '../map.js';

/**
 * A seeded random number generator.
 * @typedef {function(): number}
 */
let Rng;

export const byId = id => document.getElementById(id);

export const TAU = Math.PI * 2;
export const PX_PER_M = 8;
export const WORLD_W = MAP.w;
export const WORLD_H = MAP.h;
export const EDGE = 80;
export const DEBUG = location.search.includes('debug');

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = a => a[(Math.random() * a.length) | 0];
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const canvas = (w, h) =>
  Object.assign(document.createElement('canvas'), {width: w, height: h});
export const shade = (hex, f) =>
  `#${[1, 3, 5]
    .map(i =>
      clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * f), 0, 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

/**
 * Mulberry32 random numbers, so the scenery is the same on every load.
 * @param {number} seed
 * @return {function():} number
 */
export function rng(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick2 = (a, r) => a[(r() * a.length) | 0];

export const metres = d =>
  d < 950
    ? `${Math.round(d / 10) * 10} m`
    : `${(d / 1000).toFixed(1).replace('.', ',')} km`;

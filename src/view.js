/**
 * @fileoverview The game canvas and its size.
 */

import {byId} from './util.js';

export const gameCanvas = byId('game');
export const ctx = gameCanvas.getContext('2d');

export let viewW = 800;
export let viewH = 450;

/**
 * Gives the view a size, in pixels.
 * @param {number} w
 * @param {number} h
 */
export function sizeView(w, h) {
  viewW = gameCanvas.width = w;
  viewH = gameCanvas.height = h;
  ctx.imageSmoothingEnabled = false;
}

/** Fits the canvas to the window. */
export function resize() {
  const a = innerWidth / innerHeight;
  if (a >= 1) {
    sizeView(Math.round(450 * Math.min(a, 2.6)), 450);
    return;
  }
  sizeView(400, Math.round(400 / Math.max(a, 0.42)));
}

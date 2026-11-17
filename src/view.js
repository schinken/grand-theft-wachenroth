/**
 * @fileoverview The game canvas and its size.
 */

import {byId, canvas} from './util.js';

export const gameCanvas = byId('game');
export const ctx = gameCanvas.getContext('2d');
// The ground is drawn flat, on a canvas of its own, and then laid over the
// hills (see hills.js). It has room for more than the screen shows: where
// the land falls away, more of it comes into sight.
export const ROOM = 1.3;
export const flatCtx = canvas(1, 1).getContext('2d');

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
  flatCtx.canvas.width = Math.ceil(w * ROOM);
  flatCtx.canvas.height = Math.ceil(h * ROOM);
  ctx.imageSmoothingEnabled = flatCtx.imageSmoothingEnabled = false;
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

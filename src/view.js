/**
 * @fileoverview The game canvas and its size.
 */

import {byId, canvas} from './util.js';

export const gameCanvas = byId('game');
// What the player sees: render() lays the picture of the world over the hills.
export const screenCtx = gameCanvas.getContext('2d');
// The world is drawn flat, on a canvas of its own with room for more than the
// screen shows: where the land falls away, more of it comes into sight.
export const ROOM = 1.3;
export const ctx = canvas(1, 1).getContext('2d');

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
  ctx.canvas.width = Math.ceil(w * ROOM);
  ctx.canvas.height = Math.ceil(h * ROOM);
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

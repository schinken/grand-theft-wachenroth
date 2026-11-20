/**
 * @fileoverview The hills, as the camera sees them: higher ground is nearer
 * and looks bigger. The ground is drawn flat and laid over the hills; what
 * stands on it is put on its spot and keeps its shape.
 */

import {STEEP, heightAt} from './land.js';
import {ctx, flatCtx, viewH, viewW} from './view.js';

// The camera of the frame being drawn: over (x, y), `h` above the ground
// there, which lies `base` high. A point of the world shows at pixel
// x * z + ox, y * z + oy. The picture of the whole map is `flat`, as a map is.
const cam = {x: 0, y: 0, h: 1, base: 0, z: 1, ox: 0, oy: 0, flat: false};
// The ground is laid over the hills in squares of about this many pixels.
const MESH = 50;
// The ground that shows at the corners of those squares: x, y in metres.
let mesh = new Float64Array(0);
// How stand() last set the canvas: pixels per metre, and where the world
// begins.
export const put = {z: 1, e: 0, f: 0};

/**
 * Says where the camera is for this frame.
 * @param {!Object} to Its x, y and height h in metres, the zoom z, where the
 *     world begins on the screen (ox, oy), and whether the hills are left out.
 */
export function look(to) {
  Object.assign(cam, to);
  cam.base = heightAt(cam.x, cam.y);
}

/**
 * How much bigger the ground at a point looks than the ground below the
 * camera: higher ground is nearer, as a roof is.
 * @param {number} x
 * @param {number} y
 * @return {number}
 */
export function near(x, y) {
  if (cam.flat) {
    return 1;
  }
  // No hill comes nearer than this, and no valley lies deeper: the flat
  // ground has room for no more (see ROOM).
  const reach = cam.h * 0.2;
  const up = STEEP * (heightAt(x, y) - cam.base);
  return cam.h / (cam.h - reach * Math.tanh(up / reach));
}

/**
 * Where a point on the ground shows on the screen.
 * @param {{x: number, y: number}} o
 * @return {!Array<number>} x and y, in pixels.
 */
export function shown(o) {
  const k = near(o.x, o.y);
  return [
    (cam.x + (o.x - cam.x) * k) * cam.z + cam.ox,
    (cam.y + (o.y - cam.y) * k) * cam.z + cam.oy,
  ];
}

/**
 * Whether a point on the ground is on the screen, or nearly.
 * @param {{x: number, y: number}} o
 * @return {boolean}
 */
export function onScreen(o) {
  const [x, y] = shown(o);
  return x > -80 && y > -80 && x < viewW + 80 && y < viewH + 80;
}

/**
 * Stands what is drawn next on the ground at a point: nearer and bigger the
 * higher that ground is. A house keeps its shape, all of it stands as high
 * as this one point.
 * @param {number} x
 * @param {number} y
 * @return {number} How high the camera is above that ground, for what leans
 *     away from it.
 */
export function stand(x, y) {
  const k = near(x, y);
  put.z = cam.z * k;
  put.e = cam.x * (1 - k) * cam.z + cam.ox;
  put.f = cam.y * (1 - k) * cam.z + cam.oy;
  ctx.setTransform(put.z, 0, 0, put.z, put.e, put.f);
  return cam.h / k;
}

/**
 * Finds the ground that shows at every corner of the mesh, and so how much
 * of the world has to be drawn.
 * @return {!Array<number>} x0, y0, x1 and y1, in metres.
 */
export function layMesh() {
  const nx = Math.ceil(viewW / MESH);
  const ny = Math.ceil(viewH / MESH);
  if (mesh.length !== (nx + 1) * (ny + 1) * 2) {
    mesh = new Float64Array((nx + 1) * (ny + 1) * 2);
  }
  const view = [1e9, 1e9, -1e9, -1e9];
  for (let j = 0, n = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++, n += 2) {
      // Where the corner is in the world as the screen shows it: the ground
      // seen there lies nearer to the camera's foot the higher it is. Each
      // turn takes the height of the last guess.
      const sx = ((i * viewW) / nx - cam.ox) / cam.z;
      const sy = ((j * viewH) / ny - cam.oy) / cam.z;
      let x = sx;
      let y = sy;
      for (let turn = 0; turn < 4; turn++) {
        const k = near(x, y);
        x = cam.x + (sx - cam.x) / k;
        y = cam.y + (sy - cam.y) / k;
      }
      mesh[n] = x;
      mesh[n + 1] = y;
      view[0] = Math.min(view[0], x);
      view[1] = Math.min(view[1], y);
      view[2] = Math.max(view[2], x);
      view[3] = Math.max(view[3], y);
    }
  }
  return view;
}

/**
 * Lays the flat ground over the hills: every square of the screen gets the
 * slanted patch of the ground that shows there.
 * @param {number} fx Where the world begins on the flat ground, in pixels.
 * @param {number} fy
 */
export function layOverHills(fx, fy) {
  const flat = flatCtx.canvas;
  const nx = Math.ceil(viewW / MESH);
  const ny = Math.ceil(viewH / MESH);
  const w = viewW / nx;
  const h = viewH / ny;
  const z = cam.z;
  // Smoothed: with hard pixels every line crawls when the camera moves.
  ctx.imageSmoothingEnabled = true;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // The corners of the patch on the flat ground, in pixels
      const a = (j * (nx + 1) + i) * 2;
      const c = a + (nx + 1) * 2;
      const ax = mesh[a] * z + fx;
      const ay = mesh[a + 1] * z + fy;
      const bx = mesh[a + 2] * z + fx;
      const by = mesh[a + 3] * z + fy;
      const cx = mesh[c] * z + fx;
      const cy = mesh[c + 1] * z + fy;
      const dx = mesh[c + 2] * z + fx;
      const dy = mesh[c + 3] * z + fy;
      // How far the patch runs for one pixel of the screen, across and down
      const ux = (bx - ax + dx - cx) / 2 / w;
      const uy = (by - ay + dy - cy) / 2 / w;
      const vx = (cx - ax + dx - bx) / 2 / h;
      const vy = (cy - ay + dy - by) / 2 / h;
      const det = ux * vy - uy * vx;
      // The other way round, from the patch to the screen
      const ma = vy / det;
      const mb = -uy / det;
      const mc = -vx / det;
      const md = ux / det;
      const mx = (ax + bx + cx + dx) / 4;
      const my = (ay + by + cy + dy) / 4;
      ctx.setTransform(
        ma,
        mb,
        mc,
        md,
        (i + 0.5) * w - (ma * mx + mc * my),
        (j + 0.5) * h - (mb * mx + md * my)
      );
      // A pixel more all round, so the squares leave no gaps between them
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx, dx)) - 1);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy, dy)) - 1);
      const x1 = Math.min(flat.width, Math.ceil(Math.max(ax, bx, cx, dx)) + 1);
      const y1 = Math.min(flat.height, Math.ceil(Math.max(ay, by, cy, dy)) + 1);
      ctx.drawImage(flat, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.imageSmoothingEnabled = false;
}

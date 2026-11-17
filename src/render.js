/**
 * @fileoverview Draws one frame, its labels and pointers, and the poster.
 */

import {OPEN_ROOFS, buildingGrid} from './buildings.js';
import {
  drawBuildings,
  drawFurniture,
  drawShadows,
  drawTrees,
} from './draw-buildings.js';
import {drawGround} from './draw-ground.js';
import {drawAir, drawParticles, drawSprites} from './draw-sprites.js';
import {gridFind} from './grid.js';
import {changed} from './hud.js';
import {STEEP, heightAt} from './land.js';
import {SPOT} from './places.js';
import {propGrid, treeGrid} from './scenery.js';
import {state} from './state.js';
import {
  DEBUG,
  WORLD_H,
  WORLD_W,
  canvas,
  clamp,
  dist,
  metres,
  rand,
} from './util.js';
import {
  ctx,
  gameCanvas,
  resize,
  screenCtx,
  sizeView,
  viewH,
  viewW,
} from './view.js';

// Where the camera looks from, when not from above the middle of the
// screen: for the picture of the whole map.
let eye = null;
// The camera of the frame being drawn: over (x, y), `h` above the ground
// there, which lies `base` high. A point of the world shows at pixel
// x * z + ox, y * z + oy.
const cam = {x: 0, y: 0, h: 1, base: 0, z: 1, ox: 0, oy: 0};
// The hills are laid over the picture in squares of about this many pixels.
const MESH = 50;
// The ground that shows at the corners of those squares: x, y in metres.
let mesh = new Float64Array(0);

/**
 * How much bigger the ground at a point looks than the ground below the
 * camera: higher ground is nearer, as a roof is. The picture of the whole map
 * stays flat, as a map is.
 * @param {number} x
 * @param {number} y
 * @return {number}
 */
function near(x, y) {
  if (eye) {
    return 1;
  }
  // No hill comes nearer than this, and no valley lies deeper: the flat
  // picture has room for no more (see ROOM).
  const reach = cam.h * 0.2;
  const up = STEEP * (heightAt(x, y) - cam.base);
  return cam.h / (cam.h - reach * Math.tanh(up / reach));
}

/**
 * Where a point on the ground shows on the screen.
 * @param {{x: number, y: number}} o
 * @return {!Array<number>} x and y, in pixels.
 */
function shown(o) {
  const k = near(o.x, o.y);
  return [
    (cam.x + (o.x - cam.x) * k) * cam.z + cam.ox,
    (cam.y + (o.y - cam.y) * k) * cam.z + cam.oy,
  ];
}

/**
 * Finds the ground that shows at every corner of the mesh, and so how much
 * of the world the flat picture needs.
 * @param {number} nx How many squares the mesh has across.
 * @param {number} ny And down.
 * @return {!Array<number>} x0, y0, x1 and y1, in metres.
 */
function layMesh(nx, ny) {
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
 * Lays the flat picture of the world over the hills: every square of the
 * screen gets the slanted patch of the picture that shows there.
 * @param {number} nx How many squares the mesh has across.
 * @param {number} ny And down.
 * @param {number} fx Where the world begins on the flat picture, in pixels.
 * @param {number} fy
 */
function layOverHills(nx, ny, fx, fy) {
  const flat = ctx.canvas;
  const w = viewW / nx;
  const h = viewH / ny;
  const z = cam.z;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // The corners of the patch on the flat picture, in pixels
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
      screenCtx.setTransform(
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
      screenCtx.drawImage(
        flat,
        x0,
        y0,
        x1 - x0,
        y1 - y0,
        x0,
        y0,
        x1 - x0,
        y1 - y0
      );
    }
  }
  screenCtx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Draws one frame. */
export function render() {
  const z = state.cam.z;
  // Drunk: the world sways, fading out in the last seconds
  const tipsy = clamp(state.drunk / 4, 0, 1);
  const cx =
    state.cam.x +
    rand(-1, 1) * state.shake +
    Math.sin(state.t * 1.1) * 1.6 * tipsy;
  const cy =
    state.cam.y +
    rand(-1, 1) * state.shake +
    Math.cos(state.t * 0.83) * 1.2 * tipsy;
  const tilt = tipsy
    ? `rotate(${(Math.sin(state.t * 0.7) * 1.6 * tipsy).toFixed(2)}deg) scale(${1 + 0.05 * tipsy})`
    : '';
  if (changed('tilt', tilt)) {
    gameCanvas.style.transform = tilt;
  }
  // The eye: x, y and the camera height hc, in metres
  const ex = eye ? eye.x : cx;
  const ey = eye ? eye.y : cy;
  const hc = eye ? eye.h : 520 / z;
  Object.assign(cam, {x: ex, y: ey, h: hc, base: heightAt(ex, ey), z});
  cam.ox = Math.round(viewW / 2 - cx * z);
  cam.oy = Math.round(viewH / 2 - cy * z);
  // The world is drawn flat, as much of it as shows between the hills, and
  // two pixels more all round.
  const nx = Math.ceil(viewW / MESH);
  const ny = Math.ceil(viewH / MESH);
  const view = layMesh(nx, ny);
  const x0 = view[0] - 2 / z;
  const y0 = view[1] - 2 / z;
  const x1 = view[2] + 2 / z;
  const y1 = view[3] + 2 / z;
  const fx = Math.round(-x0 * z);
  const fy = Math.round(-y0 * z);
  ctx.setTransform(z, 0, 0, z, fx, fy);
  ctx.lineJoin = ctx.lineCap = 'round';
  const builds = gridFind(buildingGrid, x0 - 30, y0 - 30, x1 + 30, y1 + 30);
  for (const b of OPEN_ROOFS) {
    if (b.x1 > x0 - 30 && b.x0 < x1 + 30 && b.y1 > y0 - 30 && b.y0 < y1 + 30) {
      builds.push(b);
    }
  }
  const trees = gridFind(treeGrid, x0 - 12, y0 - 12, x1 + 12, y1 + 12);
  drawGround(x0, y0, x1, y1);
  drawShadows(builds, trees, x0, y0, x1, y1);
  drawSprites(x0, y0, x1, y1);
  drawBuildings(builds, ex, ey, hc, x0, y0, x1, y1);
  drawFurniture(gridFind(propGrid, x0 - 9, y0 - 9, x1 + 9, y1 + 9), ex, ey, hc);
  drawParticles();
  drawTrees(trees, ex, ey, hc, x0, y0, x1, y1);
  drawAir();
  // the world ends here
  ctx.fillStyle = 'rgba(8,10,14,.7)';
  const m = v => Math.max(0, v);
  ctx.fillRect(x0, y0, x1 - x0, m(-y0));
  ctx.fillRect(x0, WORLD_H, x1 - x0, m(y1 - WORLD_H));
  ctx.fillRect(x0, 0, m(-x0), WORLD_H);
  ctx.fillRect(WORLD_W, 0, m(x1 - WORLD_W), WORLD_H);
  if (tipsy) {
    ctx.fillStyle = `rgba(255,205,40,${(0.22 * tipsy).toFixed(3)})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  layOverHills(nx, ny, fx, fy);
  if (state.mode === 'play') {
    drawOverlay();
  }
}

/** Labels and pointers, in screen pixels. */
function drawOverlay() {
  const z = cam.z;
  const player = state.player;
  const j = state.job;
  const label = (s, x, y, col) => {
    screenCtx.fillStyle = '#000';
    screenCtx.fillText(s, x + 1, y + 1);
    screenCtx.fillStyle = col;
    screenCtx.fillText(s, x, y);
  };
  const arrow = (px, py, a, col, size = 1) => {
    screenCtx.save();
    screenCtx.translate(px, py);
    screenCtx.rotate(a);
    screenCtx.scale(size, size);
    for (const [grow, fill] of [
      [3, '#000'],
      [0, col],
    ]) {
      screenCtx.fillStyle = fill;
      screenCtx.beginPath();
      screenCtx.moveTo(10 + grow, 0);
      screenCtx.lineTo(-6 - grow, -8 - grow);
      screenCtx.lineTo(-6 - grow, 8 + grow);
      screenCtx.fill();
    }
    screenCtx.restore();
  };
  const pointer = (o, col, text) => {
    // arrow on the screen edge towards something out of view
    const [x, y] = shown(o);
    const pad = 26;
    if (x > pad && x < viewW - pad && y > pad && y < viewH - pad) {
      return false;
    }
    const a = Math.atan2(y - viewH / 2, x - viewW / 2);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = Math.min(
      (viewW / 2 - pad) / Math.abs(ca || 1e-6),
      (viewH / 2 - pad) / Math.abs(sa || 1e-6)
    );
    const px = viewW / 2 + ca * k;
    const py = viewH / 2 + sa * k;
    arrow(px, py, a, col);
    // Keep the whole label on the screen
    const half = text ? screenCtx.measureText(text).width / 2 + 4 : 0;
    if (text) {
      label(
        text,
        clamp(px - ca * 30, half, viewW - half),
        clamp(py - sa * 22, 14, viewH - 10),
        col
      );
    }
    return true;
  };
  screenCtx.setTransform(1, 0, 0, 1, 0, 0);
  screenCtx.font = 'bold 11px "Courier New", monospace';
  screenCtx.textAlign = 'center';
  screenCtx.textBaseline = 'middle';
  for (const v of state.items) {
    if (v.job) {
      pointer(v, '#ffd23e');
    }
  }
  if (j && j.to) {
    const to = j.to;
    const far = dist(player, to);
    pointer(
      to,
      '#ffd23e',
      `${(to.name || 'ZIEL').toUpperCase()} · ${metres((state.gps && state.gps.far) || far)}`
    );
    if (to === j.veh || to === j.prey) {
      // the car you are after
      const bob = Math.sin(state.t * 6) * 3;
      const [x, y] = shown(to);
      arrow(
        x,
        y - 3.2 * z - 12 + bob,
        Math.PI / 2,
        to === j.prey ? '#ff5a1f' : '#ffd23e',
        0.8
      );
    }
    const wp = state.gps && state.gps.wp;
    if (wp && far > 12) {
      // the yellow arrow by the player shows the way along the roads
      const a = Math.atan2(wp.y - player.y, wp.x - player.x);
      const r = 3.4 * z + 14;
      const [x, y] = shown(player);
      arrow(x + Math.cos(a) * r, y + Math.sin(a) * r, a, '#ffd23e', 0.75);
    }
  }
  if (DEBUG) {
    for (const k of Object.keys(SPOT)) {
      const [x, y] = shown(SPOT[k]);
      label(k, x, y - 8, '#f0f');
    }
  }
  screenCtx.font = 'bold 14px "Courier New", monospace';
  for (const t of state.texts) {
    label(t.s, ...shown(t), t.col);
  }
}

/**
 * Offers a picture of the whole map as a download: seen from high above its
 * middle, like an aerial photo. It is drawn in pieces, all from the same eye,
 * so they fit together.
 * @param {number=} z Pixels per metre.
 * @param {number=} height How high the eye is, in metres.
 */
export async function poster(z = 4, height = 1000) {
  const big = canvas(Math.round(WORLD_W * z), Math.round(WORLD_H * z));
  const g = big.getContext('2d');
  const piece = 1024;
  const mode = state.mode;
  state.mode = 'poster'; // no labels, no arrows, no player
  eye = {x: WORLD_W / 2, y: WORLD_H / 2, h: height};
  sizeView(piece, piece);
  for (let y = 0; y < big.height; y += piece) {
    for (let x = 0; x < big.width; x += piece) {
      Object.assign(state.cam, {
        x: (x + piece / 2) / z,
        y: (y + piece / 2) / z,
      });
      state.cam.z = z;
      state.shake = 0;
      render();
      g.drawImage(gameCanvas, x, y);
    }
  }
  eye = null;
  state.mode = mode;
  resize();
  const blob = await new Promise(done => big.toBlob(done, 'image/jpeg', 0.9));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'grand-theft-wachenroth.jpg';
  link.click();
}

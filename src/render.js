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
import {layMesh, layOverHills, look, shown} from './hills.js';
import {changed} from './hud.js';
import {dusk, nightFall} from './night.js';
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
  flatCtx,
  gameCanvas,
  resize,
  sizeView,
  viewH,
  viewW,
} from './view.js';

// Where the camera looks from, when not from above the middle of the
// screen: for the picture of the whole map.
let eye = null;

/**
 * Darkens what lies beyond the edge of the world. The edge runs over the
 * hills, so it is followed point by point where it is in sight.
 * @param {number} x0 The ground in view, in metres.
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function drawEdge(x0, y0, x1, y1) {
  if (x0 > 0 && y0 > 0 && x1 < WORLD_W && y1 < WORLD_H) {
    return;
  }
  const steps = (from, to, end) => {
    const at = [0];
    for (let v = Math.max(8, from); v < Math.min(end, to); v += 8) {
      at.push(v);
    }
    return [...at, end];
  };
  const xs = steps(x0, x1, WORLD_W);
  const ys = steps(y0, y1, WORLD_H);
  // Once round the world: north, east, south and west edge
  const ring = [
    ...xs.map(x => ({x, y: 0})),
    ...ys.map(y => ({x: WORLD_W, y})),
    ...xs.map(x => ({x, y: WORLD_H})).reverse(),
    ...ys.map(y => ({x: 0, y})).reverse(),
  ];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, viewW, viewH);
  for (const o of ring) {
    ctx.lineTo(...shown(o));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,10,14,.7)';
  ctx.fill('evenodd'); // the screen, without the world
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
  const ox = Math.round(viewW / 2 - cx * z);
  const oy = Math.round(viewH / 2 - cy * z);
  look({x: ex, y: ey, h: hc, z, ox, oy, flat: !!eye});
  // The ground is drawn flat, as much of it as shows between the hills and
  // two pixels more all round, and then laid over the hills.
  const view = layMesh();
  const x0 = view[0] - 2 / z;
  const y0 = view[1] - 2 / z;
  const x1 = view[2] + 2 / z;
  const y1 = view[3] + 2 / z;
  const fx = Math.round(-x0 * z);
  const fy = Math.round(-y0 * z);
  flatCtx.setTransform(z, 0, 0, z, fx, fy);
  flatCtx.lineJoin = flatCtx.lineCap = 'round';
  const builds = gridFind(buildingGrid, x0 - 30, y0 - 30, x1 + 30, y1 + 30);
  for (const b of OPEN_ROOFS) {
    if (b.x1 > x0 - 30 && b.x0 < x1 + 30 && b.y1 > y0 - 30 && b.y0 < y1 + 30) {
      builds.push(b);
    }
  }
  const trees = gridFind(treeGrid, x0 - 12, y0 - 12, x1 + 12, y1 + 12);
  drawGround(x0, y0, x1, y1);
  drawShadows(builds, trees, x0, y0, x1, y1);
  layOverHills(fx, fy);
  const props = gridFind(propGrid, x0 - 9, y0 - 9, x1 + 9, y1 + 9);
  dusk([x0, y0, x1, y1], props);
  // What stands or moves is put on its spot on the hills, thing by thing.
  ctx.setTransform(z, 0, 0, z, ox, oy);
  ctx.lineJoin = ctx.lineCap = 'round';
  drawSprites(x0, y0, x1, y1);
  drawBuildings(builds, ex, ey, hc, x0, y0, x1, y1);
  drawFurniture(props, ex, ey);
  drawParticles();
  drawTrees(trees, ex, ey, hc, x0, y0, x1, y1);
  drawAir();
  nightFall();
  drawEdge(x0, y0, x1, y1); // the world ends here
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (tipsy) {
    ctx.fillStyle = `rgba(255,205,40,${(0.22 * tipsy).toFixed(3)})`;
    ctx.fillRect(0, 0, viewW, viewH);
  }
  if (state.mode === 'play') {
    drawOverlay(z);
  }
}

/**
 * Labels and pointers, in screen pixels.
 * @param {number} z Zoom, in pixels per metre.
 */
function drawOverlay(z) {
  const player = state.player;
  const j = state.job;
  const label = (s, x, y, col) => {
    ctx.fillStyle = '#000';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  };
  const arrow = (px, py, a, col, size = 1) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.scale(size, size);
    for (const [grow, fill] of [
      [3, '#000'],
      [0, col],
    ]) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(10 + grow, 0);
      ctx.lineTo(-6 - grow, -8 - grow);
      ctx.lineTo(-6 - grow, 8 + grow);
      ctx.fill();
    }
    ctx.restore();
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
    const half = text ? ctx.measureText(text).width / 2 + 4 : 0;
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
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
    // The car you are after, or the one you got out of and have to bring on
    const left = j.step.do === 'bring' && player.car !== j.veh ? j.veh : null;
    const car = to === j.veh || to === j.prey ? to : left;
    if (left) {
      pointer(left, '#ffd23e', left.name.toUpperCase());
    }
    if (car) {
      const bob = Math.sin(state.t * 6) * 3;
      const [x, y] = shown(car);
      arrow(
        x,
        y - 3.2 * z - 12 + bob,
        Math.PI / 2,
        car === j.prey ? '#ff5a1f' : '#ffd23e',
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
  ctx.font = 'bold 14px "Courier New", monospace';
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

/**
 * @fileoverview Draws the ground: areas, roads, yards and fields, painted into
 * tiles that are kept.
 */

import {MAP} from '../map.js';
import {BUILD} from './buildings.js';
import {pip} from './geometry.js';
import {AREAS, ROADS} from './land.js';
import {MODELLED, NEW_HOUSES, SPOT} from './places.js';
import {ROOFS, fromFrame} from './roofs.js';
import {state} from './state.js';
import {textures} from './textures.js';
import {DEBUG, PX_PER_M, TAU, WORLD_W, canvas} from './util.js';
import {ctx} from './view.js';
import {GROUNDS} from './yards.js';

/**
 * Strokes every path of a road layer.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Array<!Array>} l
 * @param {(string|!CanvasPattern)} style
 * @param {number=} w One width for all, instead of each road's own.
 * @param {number=} grow
 */
function strokeLayer(g, l, style, w, grow = 0) {
  g.strokeStyle = style;
  for (const [rw, path] of l) {
    g.lineWidth = (w || rw) + grow;
    g.stroke(path);
  }
}

/**
 * Paints a football pitch, tennis or volleyball court.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Object} a
 */
function drawPitch(g, a) {
  const length = a.u1 - a.u0;
  const width = a.v1 - a.v0;
  const line = (x0, y0, x1, y1) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  g.save();
  g.transform(a.ca, a.sa, -a.sa, a.ca, a.mx, a.my);
  g.strokeStyle = '#e8efe0';
  g.lineWidth = 0.28;
  g.lineCap = 'butt';
  if (a.s === 'soccer') {
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 ? '#3f8a35' : '#49983d';
      g.fillRect(a.u0 + (length / 10) * i, a.v0, length / 10 + 0.05, width);
    }
    g.strokeRect(a.u0 + 1.5, a.v0 + 1.5, length - 3, width - 3);
    line(0, a.v0 + 1.5, 0, a.v1 - 1.5);
    g.beginPath();
    g.arc(0, 0, Math.min(9.15, width * 0.18), 0, TAU);
    g.stroke();
    for (const s of [-1, 1]) {
      const x = s * (length / 2 - 1.5);
      const bw = Math.min(40, width * 0.6);
      const sw = Math.min(18, width * 0.3);
      g.strokeRect(Math.min(x, x - s * 16.5), -bw / 2, 16.5, bw);
      g.strokeRect(Math.min(x, x - s * 5.5), -sw / 2, 5.5, sw);
      g.fillStyle = '#f4f4ef';
      g.fillRect(Math.min(x, x + s * 1.6), -3.7, 1.6, 7.4);
    }
  } else {
    g.fillStyle = a.s === 'tennis' ? textures.clay : textures.play;
    g.fill(a.lpath);
    const n = Math.max(1, Math.round(width / 18));
    const ch = width / n; // courts side by side
    for (let i = 0; i < n; i++) {
      const y = a.v0 + ch * i + ch / 2;
      const cl = Math.min(length - 6, 23.8);
      const cw = Math.min(ch - 5, 11);
      g.strokeRect(-cl / 2, y - cw / 2, cl, cw);
      g.strokeStyle = '#30343a';
      line(0, y - cw / 2 - 0.8, 0, y + cw / 2 + 0.8);
      g.strokeStyle = '#e8efe0';
    }
  }
  g.restore();
  g.lineCap = 'round';
}

/**
 * A hatched apron that has to stay clear: the fire engines come out here.
 * @param {!CanvasRenderingContext2D} g
 */
function paintFireApron(g) {
  g.fillStyle = '#5e5e64';
  g.fillRect(-10, 0.5, 20, 8);
  g.strokeStyle = '#e8c21c';
  g.lineWidth = 0.22;
  g.beginPath();
  for (let x = -10; x < 10; x += 1.6) {
    g.moveTo(x, 0.5);
    g.lineTo(x + 1.6, 8.5);
  }
  g.rect(-10, 0.5, 20, 8);
  g.stroke();
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? '#f4f4ef' : '#c8201c';
    g.fillRect(-10 + i * 2, 0, 2, 0.5);
  }
}

/**
 * Stacks of crates in the yard of the drinks shop.
 * @param {!CanvasRenderingContext2D} g
 */
function paintCrates(g) {
  const crates = ['#d99a1a', '#2f8f4a', '#c8322b', '#2b62c8', '#d99a1a'];
  crates.forEach((crate, i) => {
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(-6.7 + i * 2.2, 1.5, 1.8, 2.6);
    g.fillStyle = crate;
    g.fillRect(-7 + i * 2.2, 1.2, 1.8, 2.6);
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.fillRect(-7 + i * 2.2, 2.4, 1.8, 0.12);
    g.fillRect(-6.15 + i * 2.2, 1.2, 0.12, 2.6);
  });
}

/**
 * Paints what stands on the ground in front of a landmark, if it is in the
 * view. The painter draws in a frame whose origin is the kerb in front of
 * the place, x along the street and y towards the building, in metres.
 * @param {!CanvasRenderingContext2D} g
 * @param {string} key The place.
 * @param {function(!CanvasRenderingContext2D)} paint
 * @param {!Array<number>} view x0, y0, x1 and y1.
 */
function paintInFront(g, key, paint, [x0, y0, x1, y1]) {
  const s = SPOT[key];
  if (s.x < x0 - 30 || s.x > x1 + 30 || s.y < y0 - 30 || s.y > y1 + 30) {
    return;
  }
  const [px, py] = MAP.pois[key];
  g.save();
  g.translate(s.x, s.y);
  g.rotate(Math.atan2(py - s.y, px - s.x) - Math.PI / 2);
  g.lineCap = 'butt';
  paint(g);
  g.restore();
}

/**
 * Paints what stands in front of the landmarks.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function paintDecor(g, x0, y0, x1, y1) {
  paintInFront(g, 'firestation', paintFireApron, [x0, y0, x1, y1]);
  paintInFront(g, 'drinks', paintCrates, [x0, y0, x1, y1]);
}

const GRAVE_BEDS = ['#4a3a2a', '#8f897d', '#2f6a2a', '#5a4632', '#3c7a30'];
const GRAVE_STONES = ['#2b2b2e', '#8f8f8a', '#d9d6cc', '#6a5a4a'];
const GRAVE_FLOWERS = ['#d83a3a', '#f2d23e', '#f4f4ef', '#c85aa8'];

/**
 * Paints the walks, graves and hedge of a cemetery.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Object} a
 */
function paintCemetery(g, a) {
  g.save();
  g.clip(a.path); // the walks end at the hedge
  g.lineCap = 'butt';
  g.strokeStyle = textures.gravel;
  g.lineWidth = 1.1;
  g.stroke(a.walks);
  g.lineWidth = 2.2;
  g.stroke(a.mainWalk);
  g.restore();
  g.save();
  g.transform(a.ca, a.sa, -a.sa, a.ca, 0, 0);
  for (const [x, y, stone, bed, flower] of a.graves) {
    // The same rotation for every grave, so only the position changes.
    const u = x * a.ca + y * a.sa;
    const v = y * a.ca - x * a.sa;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(u - 0.38, v - 0.88, 1, 2.1);
    g.fillStyle = '#b5b1a6';
    g.fillRect(u - 0.5, v - 1, 1, 2.1);
    g.fillStyle = GRAVE_BEDS[bed];
    g.fillRect(u - 0.38, v - 0.62, 0.76, 1.6);
    g.fillStyle = GRAVE_STONES[stone];
    g.fillRect(u - 0.42, v - 1.08, 0.84, 0.36);
    g.fillStyle = GRAVE_FLOWERS[flower];
    g.fillRect(u - 0.22, v - 0.3, 0.24, 0.24);
    g.fillRect(u + 0.06, v + 0.3, 0.24, 0.24);
  }
  g.restore();
  g.lineJoin = 'round';
  g.strokeStyle = '#2a5a22';
  g.lineWidth = 1.5;
  g.stroke(a.path);
  g.strokeStyle = '#3b7d2e';
  g.lineWidth = 0.8;
  g.stroke(a.path);
}

/**
 * Paints one area of land: water is left as a hole, a field is filled along
 * its furrows, a cemetery gets its graves and a car park its bays.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Object} a
 */
function paintArea(g, a) {
  g.fillStyle = a.fill;
  if (a.k === 'water') {
    g.globalCompositeOperation = 'destination-out';
    g.fill(a.path);
    g.globalCompositeOperation = 'source-over';
  } else if (a.k === 'farm') {
    g.save();
    g.transform(a.ca, a.sa, -a.sa, a.ca, a.mx, a.my);
    g.fill(a.lpath);
    g.restore();
  } else {
    g.fill(a.path);
  }
  if (a.k === 'cem') {
    paintCemetery(g, a);
  }
  if (a.bays) {
    g.save();
    g.clip(a.path);
    g.strokeStyle = 'rgba(236,236,226,.5)';
    g.lineWidth = 0.14;
    g.lineCap = 'butt';
    g.stroke(a.bays);
    g.restore();
  }
}

/**
 * The bare earth around the houses of the new estate.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function paintPlots(g, x0, y0, x1, y1) {
  for (const b of NEW_HOUSES) {
    if (b.x1 < x0 - 30 || b.x0 > x1 + 30 || b.y1 < y0 - 30 || b.y0 > y1 + 30) {
      continue;
    }
    g.save();
    g.transform(b.ca, b.sa, -b.sa, b.ca, b.mx, b.my);
    g.fillStyle = textures.constr;
    g.fillRect(b.u0 - 6, b.v0 - 6, b.u1 - b.u0 + 12, b.v1 - b.v0 + 12);
    g.restore();
  }
}

/**
 * Garden pools: a pale rim around the water.
 * @param {!CanvasRenderingContext2D} g
 */
function paintPools(g) {
  for (let i = 0; i < MAP.pools.length; i += 4) {
    const [px, py, across, down] = MAP.pools.slice(i, i + 4);
    g.fillStyle = '#d9d6cc';
    g.fillRect(
      px - across / 2 - 0.4,
      py - down / 2 - 0.4,
      across + 0.8,
      down + 0.8
    );
    g.fillStyle = '#3fb2d6';
    g.fillRect(px - across / 2, py - down / 2, across, down);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(px - across / 2 + 0.5, py - down / 2 + 0.5, across * 0.4, 0.3);
  }
}

/**
 * The yards that are painted by hand: those of the modelled buildings, and
 * those of places without one.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function paintYards(g, x0, y0, x1, y1) {
  for (const b of MODELLED) {
    if (b.x1 < x0 - 40 || b.x0 > x1 + 40 || b.y1 < y0 - 40 || b.y0 > y1 + 40) {
      continue;
    }
    g.save();
    g.transform(b.ca, b.sa, -b.sa, b.ca, b.mx, b.my);
    g.translate(b.at[0], b.at[1]);
    ROOFS[b.poi].ground(g, b);
    g.restore();
  }
  for (const [key, paint] of Object.entries(GROUNDS)) {
    const [px, py] = MAP.pois[key];
    if (px > x0 - 130 && px < x1 + 130 && py > y0 - 130 && py < y1 + 130) {
      g.save();
      paint(g);
      g.restore();
    }
  }
}

/**
 * The paved drives of the new estate, from each house down to the street.
 * @param {!CanvasRenderingContext2D} g
 */
function paintDrives(g) {
  g.lineCap = 'butt';
  g.strokeStyle = textures.school;
  for (const b of NEW_HOUSES) {
    if (MODELLED.includes(b)) {
      continue;
    }
    g.lineWidth = 4.5;
    g.beginPath();
    g.moveTo(b.mx, b.my);
    g.lineTo(b.rd[0], b.rd[1]);
    g.stroke();
  }
  g.lineCap = 'round';
}

/**
 * Streams and the river, the rail, then tracks, paths and roads, one layer
 * over the other.
 * @param {!CanvasRenderingContext2D} g
 */
function paintWays(g) {
  strokeLayer(g, ROADS.stream, '#3a72a2');
  strokeLayer(g, ROADS.bank, '#3c6829');
  g.globalCompositeOperation = 'destination-out';
  strokeLayer(g, ROADS.river, '#000');
  g.globalCompositeOperation = 'source-over';
  g.lineCap = 'butt';
  strokeLayer(g, ROADS.rail, textures.gravel, 3.4);
  g.setLineDash([0.35, 0.9]);
  strokeLayer(g, ROADS.rail, '#4a3420', 2.4);
  g.setLineDash([]);
  strokeLayer(g, ROADS.rail, '#a8a8a2', 1.5);
  strokeLayer(g, ROADS.rail, '#6c675d', 1.15);
  g.lineCap = 'round';
  strokeLayer(g, ROADS.dirt, textures.dirt);
  strokeLayer(g, ROADS.foot, '#b9ad8a');
  strokeLayer(g, ROADS.kerb, '#3a3d36');
  strokeLayer(g, ROADS.walk, textures.sidewalk);
  strokeLayer(g, ROADS.road, '#2f3135', 0, 0.5);
  strokeLayer(g, ROADS.cobble, '#5d5a53', 0, 0.5); // kerbstones
  strokeLayer(g, ROADS.lane, textures.cobble);
  strokeLayer(g, ROADS.road, textures.asphalt);
  strokeLayer(g, ROADS.cobble, textures.cobble);
  g.setLineDash([3, 5]);
  g.lineCap = 'butt';
  strokeLayer(g, ROADS.line, '#d8d4c0', 0.28);
  g.setLineDash([]);
  g.lineCap = 'round';
}

/**
 * The building site in Schulstraße: torn-up road, barriers, a heap of
 * gravel.
 * @param {!CanvasRenderingContext2D} g
 */
function paintRoadworks(g) {
  const b = SPOT.roadworks;
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.a);
  g.fillStyle = textures.constr;
  g.fillRect(-16, -1, 32, 7);
  g.fillStyle = '#6f6a60';
  g.beginPath();
  g.arc(11, 3.4, 2.4, 0, TAU);
  g.fill();
  g.fillStyle = '#8f897d';
  g.beginPath();
  g.arc(10.5, 3, 1.5, 0, TAU);
  g.fill();
  for (const x of [-16, 15.4]) {
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 ? '#f4f4ef' : '#c8201c';
      g.fillRect(x, -1 + i, 0.6, 1);
    }
  }
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#f4f4ef' : '#c8201c';
    g.fillRect(-16 + i * 2, 5.6, 2, 0.5);
  }
  g.restore();
}

/**
 * The hedges and garden fences of one tile, along the borders of the
 * parcels.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x0 Where the tile begins.
 * @param {number} y0
 */
function paintBorders(g, x0, y0) {
  const tile = tileKey(Math.round(x0 / TILE_M), Math.round(y0 / TILE_M));
  const hedges = HEDGE_TILES.get(tile);
  if (hedges) {
    g.strokeStyle = '#2a5a22';
    g.lineWidth = 1.7;
    g.stroke(hedges);
    g.strokeStyle = '#3b7d2e';
    g.lineWidth = 0.9;
    g.stroke(hedges);
  }
  const fences = FENCE_TILES.get(tile);
  if (!fences) {
    return;
  }
  // Garden fences: a rail with pale pickets, and a thin shadow
  g.lineCap = 'butt';
  g.save();
  g.translate(0.25, 0.25);
  g.strokeStyle = 'rgba(0,0,0,.22)';
  g.lineWidth = 0.3;
  g.stroke(fences);
  g.restore();
  g.strokeStyle = '#4a3826';
  g.lineWidth = 0.24;
  g.stroke(fences);
  g.setLineDash([0.2, 0.5]);
  g.strokeStyle = '#dccfae';
  g.lineWidth = 0.44;
  g.stroke(fences);
  g.setLineDash([]);
  g.lineCap = 'round';
}

/**
 * Paints land, roads, hedges and fences: everything on the ground that never
 * changes. Water is left as a hole, so the drifting water shows through.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function paintGround(g, x0, y0, x1, y1) {
  g.fillStyle = textures.grass;
  g.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  const seen = a => a.x1 > x0 && a.x0 < x1 && a.y1 > y0 && a.y0 < y1;
  for (const a of AREAS) {
    if (seen(a) && a.fill) {
      paintArea(g, a);
    }
  }
  fieldMasks.forEach((mask, i) => {
    paintMask(g, mask, 0.5, textures[`field${i + 1}`], FURROWS[i], x0, y0);
  });
  paintMask(g, yardMask, 1, textures.yard, 0, x0, y0);
  for (const a of AREAS) {
    if (seen(a) && a.k === 'pitch') {
      drawPitch(g, a);
    }
  }
  paintPlots(g, x0, y0, x1, y1);
  paintPools(g);
  paintYards(g, x0, y0, x1, y1);
  paintDrives(g);
  paintWays(g);
  paintRoadworks(g);
  paintDecor(g, x0, y0, x1, y1);
  paintBorders(g, x0, y0);
}

// The ground never changes, so it is painted once into tiles of 64 m and the
// tiles are copied to the screen. Painting it afresh every frame was the
// biggest single cost of a frame.
const TILE_M = 64;
const TILE_PX = TILE_M * PX_PER_M;
const TILE_LIMIT = 40;

// Tile canvases by position, least recently used first.
const groundTiles = new Map();
const tileKey = (tx, ty) => (ty + 512) * 4096 + tx + 512;

/**
 * Sorts lines into the ground tiles they cross: there are kilometres of
 * fences, and painting a tile should stroke only its own.
 * @param {!Array<!Array<number>>} lines Each as x, y, x, y and so on.
 * @return {!Map<number, !Path2D>} A path for every tile that has some.
 */
function byTile(lines) {
  const tiles = new Map();
  for (const l of lines) {
    for (let i = 2; i < l.length; i += 2) {
      // A stretch goes to every tile its box touches, with room for the
      // width of a hedge.
      const tx1 = Math.floor((Math.max(l[i - 2], l[i]) + 1) / TILE_M);
      const ty1 = Math.floor((Math.max(l[i - 1], l[i + 1]) + 1) / TILE_M);
      for (
        let tx = Math.floor((Math.min(l[i - 2], l[i]) - 1) / TILE_M);
        tx <= tx1;
        tx++
      ) {
        for (
          let ty = Math.floor((Math.min(l[i - 1], l[i + 1]) - 1) / TILE_M);
          ty <= ty1;
          ty++
        ) {
          const key = tileKey(tx, ty);
          const path = tiles.get(key) || new Path2D();
          tiles.set(key, path);
          path.moveTo(l[i - 2], l[i - 1]);
          path.lineTo(l[i], l[i + 1]);
        }
      }
    }
  }
  return tiles;
}
/**
 * Hedges or fences for the ground tiles: those of the map, without the ones
 * on the plot of a modelled building, which brings its own.
 * @param {string} kind 'hedges' or 'fences'.
 * @return {!Map<number, !Path2D>}
 */
function borderTiles(kind) {
  let lines = MAP[kind];
  for (const b of BUILD) {
    const spec = ROOFS[b.poi];
    if (!spec || !spec.plot) {
      continue;
    }
    const onMap = l => {
      const out = [];
      for (let i = 0; i < l.length; i += 2) {
        out.push(...fromFrame(b, l[i], l[i + 1]));
      }
      return out;
    };
    const plot = onMap(spec.plot);
    lines = lines
      .filter(l => !l.some((v, i) => i % 2 === 0 && pip(v, l[i + 1], plot)))
      .concat((spec[kind] || []).map(onMap));
  }
  return byTile(lines);
}
// Hedges and garden fences, from OpenStreetMap and along the parcel borders
const HEDGE_TILES = borderTiles('hedges');
export const FENCE_TILES = borderTiles('fences');

// Paved and gravelled ground in the village, read off the aerial photo: a
// see-through picture with one pixel per metre. Tiles painted before it has
// loaded are painted again.
const yardMask = new Image();
yardMask.onload = () => groundTiles.clear();
yardMask.src = MAP.yards;
// What grows on the fields, read off the same photo parcel by parcel: one
// such picture for each kind of field, with a pixel every 2 m.
export const fieldMasks = MAP.fields.map(src => {
  const mask = new Image();
  mask.onload = () => groundTiles.clear();
  mask.src = src;
  return mask;
});
// Which way the furrows run on each kind of field
export const FURROWS = [0.35, -0.9, 1.25, -0.2, 0.75];
const yardTile = canvas(TILE_PX, TILE_PX);
// Kept in memory, not on the graphics card, so reading it back is cheap.
const probe = canvas(TILE_M + 4, TILE_M + 4).getContext('2d', {
  willReadFrequently: true,
});

/**
 * Whether a see-through picture marks anything in one ground tile, with two
 * pixels to spare for the smoothing when it is scaled up. Most tiles have no
 * field of a kind, and painting them would draw nothing.
 * @param {!HTMLImageElement} mask
 * @param {number} k The pixels the picture has for a metre.
 * @param {number} x0 The tile's corner, in metres.
 * @param {number} y0
 * @return {boolean}
 */
function marks(mask, k, x0, y0) {
  const n = TILE_M * k + 4;
  probe.clearRect(0, 0, n, n);
  probe.drawImage(mask, x0 * k - 2, y0 * k - 2, n, n, 0, 0, n, n);
  const d = probe.getImageData(0, 0, n, n).data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]) {
      return true;
    }
  }
  return false;
}

/**
 * Paints what a see-through picture marks in one ground tile: the picture
 * cuts its shape out of a texture.
 * @param {!CanvasRenderingContext2D} g
 * @param {!HTMLImageElement} mask
 * @param {number} perMetre The pixels the picture has for a metre.
 * @param {!CanvasPattern} fill
 * @param {number} turn The angle the texture is turned by.
 * @param {number} x0 The tile's corner, in metres.
 * @param {number} y0
 */
function paintMask(g, mask, perMetre, fill, turn, x0, y0) {
  if (!mask.naturalWidth || !marks(mask, perMetre, x0, y0)) {
    return;
  }
  const y = yardTile.getContext('2d');
  const k = perMetre;
  y.setTransform(1, 0, 0, 1, 0, 0);
  y.globalCompositeOperation = 'source-over';
  y.clearRect(0, 0, TILE_PX, TILE_PX);
  y.drawImage(
    mask,
    x0 * k,
    y0 * k,
    TILE_M * k,
    TILE_M * k,
    0,
    0,
    TILE_PX,
    TILE_PX
  );
  // Scaling up leaves a soft rim a metre wide; laying the picture over
  // itself twice makes it crisp.
  y.drawImage(yardTile, 0, 0);
  y.drawImage(yardTile, 0, 0);
  y.globalCompositeOperation = 'source-in';
  y.setTransform(PX_PER_M, 0, 0, PX_PER_M, -x0 * PX_PER_M, -y0 * PX_PER_M);
  // Turned about the corner of the world, so furrows run on from tile to
  // tile.
  y.rotate(turn);
  y.fillStyle = fill;
  y.fillRect(-2 * WORLD_W, -2 * WORLD_W, 4 * WORLD_W, 4 * WORLD_W);
  g.drawImage(yardTile, x0, y0, TILE_M, TILE_M);
}

/**
 * The ground tile at a tile position, painted on first use.
 * @param {number} tx
 * @param {number} ty
 * @param {boolean} paint Whether to paint the tile if it is missing.
 * @param {number} room How many tiles to keep.
 * @return {?HTMLCanvasElement}
 */
function groundTile(tx, ty, paint, room) {
  const key = tileKey(tx, ty);
  let tile = groundTiles.get(key);
  if (tile) {
    groundTiles.delete(key); // back to the young end of the queue
  } else if (!paint) {
    return null;
  } else {
    tile = canvas(TILE_PX, TILE_PX);
    const g = tile.getContext('2d');
    const x = tx * TILE_M;
    const y = ty * TILE_M;
    g.setTransform(PX_PER_M, 0, 0, PX_PER_M, -x * PX_PER_M, -y * PX_PER_M);
    g.lineJoin = g.lineCap = 'round';
    paintGround(g, x, y, x + TILE_M, y + TILE_M);
    if (groundTiles.size >= room) {
      groundTiles.delete(groundTiles.keys().next().value);
    }
  }
  groundTiles.set(key, tile);
  return tile;
}

/**
 * Draws the ground: drifting water, the cached tiles over it, and the marker
 * of the current mission target.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawGround(x0, y0, x1, y1) {
  const view = ctx.getTransform();
  const z = view.a;
  textures.water.setTransform({
    a: 1 / PX_PER_M,
    d: 1 / PX_PER_M,
    e: ((state.t * 5) % 64) / PX_PER_M,
    f: ((state.t * 2) % 64) / PX_PER_M,
  });
  ctx.fillStyle = textures.water;
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  // Tiles go down in whole screen pixels, so neighbours meet without a seam.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const tx0 = Math.floor(x0 / TILE_M);
  const ty0 = Math.floor(y0 / TILE_M);
  const tx1 = Math.floor(x1 / TILE_M);
  const ty1 = Math.floor(y1 / TILE_M);
  // One tile beyond the view is painted ahead of time, one per frame, so
  // driving into it does not stutter.
  let ahead = 1;
  // Never fewer tiles than one screen needs, or they would be repainted
  // every frame.
  const room = Math.max(TILE_LIMIT, (tx1 - tx0 + 3) * (ty1 - ty0 + 3));
  for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
    for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      const visible = tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1;
      const known = groundTiles.has((ty + 512) * 4096 + tx + 512);
      const paint = visible || (!known && ahead-- > 0);
      const tile = groundTile(tx, ty, paint, room);
      if (!tile || !visible) {
        continue;
      }
      const sx = Math.round(tx * TILE_M * z + view.e);
      const sy = Math.round(ty * TILE_M * z + view.f);
      const sw = Math.round((tx + 1) * TILE_M * z + view.e) - sx;
      const sh = Math.round((ty + 1) * TILE_M * z + view.f) - sy;
      ctx.drawImage(tile, sx, sy, sw, sh);
    }
  }
  ctx.setTransform(z, 0, 0, z, view.e, view.f);
  const j = state.job;
  const to = j && j.to;
  if (to && to !== j.veh && to !== j.prey) {
    // where to go: a pulsing ring on the ground
    const pulse = Math.sin(state.t * 5);
    ctx.fillStyle = 'rgba(255,210,62,.3)';
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(to.x, to.y, 3.4 + pulse * 0.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (j.step.do === 'hold') {
      ctx.beginPath();
      ctx.arc(to.x, to.y, j.step.r || 10, 0, TAU);
      ctx.stroke();
    }
  }
  if (DEBUG) {
    for (const k of Object.keys(SPOT)) {
      ctx.fillStyle = '#f0f';
      ctx.beginPath();
      ctx.arc(SPOT[k].x, SPOT[k].y, 1.5, 0, TAU);
      ctx.fill();
    }
  }
}

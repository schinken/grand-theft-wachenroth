/**
 * @fileoverview Grand Theft Wachenroth: a top-down crime caper on the real
 * street map of Wachenroth. World units are metres, y points south. The map
 * is baked by tools/osm2map.py.
 */

import * as audio from './audio.js';
import {MAP} from './map.js';
import {MISSIONS, PLACES, RANKS, SIGNS, TALK} from './missions.js';

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
 * A seeded random number generator.
 * @typedef {function(): number}
 */
let Rng;

/**
 * A uniform grid of buckets, for finding buildings, trees and street
 * furniture near a point.
 * @typedef {!Array<!Array<!Object>>}
 */
let Grid;

/**
 * A vehicle: position x and y, heading a, velocity vx and vy, its `type` from
 * TYPES, health hp, and `ai` while the computer drives it.
 * @typedef {!Object}
 */
let Car;

/**
 * A pedestrian, walking beside the road from one junction to the next.
 * @typedef {!Object}
 */
let Ped;

/**
 * A building from the map: outline p, height h, walls and roof.
 * @typedef {!Object}
 */
let Building;

/**
 * A lantern or a hydrant: kind k, position, and whether it is knocked down.
 * @typedef {!Object}
 */
let Prop;

const byId = id => document.getElementById(id);
const gameCanvas = byId('game');
const ctx = gameCanvas.getContext('2d');
const TAU = Math.PI * 2;
const PX_PER_M = 8;
const WORLD_W = MAP.w;
const WORLD_H = MAP.h;
const EDGE = 80;
const DEBUG = location.search.includes('debug');
let viewW = 800;
let viewH = 450;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const canvas = (w, h) =>
  Object.assign(document.createElement('canvas'), {width: w, height: h});
const shade = (hex, f) =>
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
function rng(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- geometry

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
function nearest(x, y, ax, ay, bx, by) {
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
function pip(x, y, p) {
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
function pushOut(x, y, r, p) {
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

// Uniform grid for buildings and trees.
const CELL = 40;
const GRID_W = Math.ceil(WORLD_W / CELL) + 4;
const GRID_H = Math.ceil(WORLD_H / CELL) + 4;
const cell = (v, n) => clamp(Math.floor(v / CELL) + 2, 0, n - 1);
const grid = () => Array.from({length: GRID_W * GRID_H}, () => []);
const at = (g, x, y) => g[cell(y, GRID_H) * GRID_W + cell(x, GRID_W)];
/**
 * Files an object under every grid cell its bounding box touches.
 * @param {!Grid} g
 * @param {!Object} o
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function gridAdd(g, o, x0, y0, x1, y1) {
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
function gridFind(g, x0, y0, x1, y1) {
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

// ---------- textures (all drawn here, 8 px per metre)

/**
 * A repeating ground or roof texture, 8 pixels per metre.
 * @param {string} base Hex colour; it also seeds the random numbers.
 * @param {function(!CanvasRenderingContext2D, !Rng, number)=} draw Paints the
 *     details.
 * @param {number=} n Pixels square; the big ground textures use 128 so they
 *     repeat less.
 * @return {!CanvasPattern}
 */
function tex(base, draw, n = 64) {
  const c = canvas(n, n);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  if (draw) {
    draw(g, rng(parseInt(base.slice(1), 16)), n);
  }
  const p = ctx.createPattern(c, 'repeat');
  p.setTransform(new DOMMatrix().scaleSelf(1 / PX_PER_M));
  return p;
}
/**
 * Speckles a texture with short dashes in random colours.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number=} w
 * @param {number=} size
 */
function dots(g, r, n, cols, w = 1, size = 64) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.fillRect((r() * size) | 0, (r() * size) | 0, w + ((r() * 2) | 0), 1);
  }
}
/**
 * Soft patches, so lawns and tarmac are not one flat colour.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number} size
 */
function blots(g, r, n, cols, size) {
  g.globalAlpha = 0.35;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    const x = r() * size;
    const y = r() * size;
    const rad = 4 + r() * 9;
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, rad * 0.7, r() * 3, 0, TAU);
      g.fill();
    } // wraps at the edges
  }
  g.globalAlpha = 1;
}
/**
 * Blades of grass, two pixels tall.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number} size
 */
function tufts(g, r, n, cols, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.fillRect((r() * size) | 0, (r() * size) | 0, 1, 2);
  }
}
const lawn = (base, blot, speck, tuft, flowers) =>
  tex(
    base,
    (g, r, n) => {
      blots(g, r, 26, blot, n);
      dots(g, r, 2600, speck, 1, n);
      tufts(g, r, 110, tuft, n);
      if (flowers) {
        dots(g, r, flowers, ['#e8e06a', '#f2f2e6', '#d86a8a', '#f2f2e6'], 1, n);
      }
    },
    128
  );
const rows = (base, line, speck, plants) =>
  tex(
    base,
    (g, r, n) => {
      // a field: furrows, and the lanes the tractor leaves
      blots(g, r, 16, [shade(base, 0.92), shade(base, 1.07)], n);
      for (let y = 0; y < n; y += 4) {
        g.fillStyle = line;
        g.fillRect(0, y, n, 1);
        g.fillStyle = shade(base, 1.1);
        g.fillRect(0, y + 1, n, 1); // every furrow has a dark and a sunny side
        if (plants) {
          for (let x = (y % 8) / 2; x < n; x += 4) {
            g.fillStyle = plants[(r() * plants.length) | 0];
            g.fillRect(x, y + 2, 2, 2);
          }
        }
      }
      dots(g, r, 900, speck, 2, n);
      g.fillStyle = shade(base, 0.72);
      g.fillRect(0, 49, n, 2);
      g.fillRect(0, 65, n, 2);
    },
    128
  );
const tiles = (base, dark, light) =>
  tex(base, (g, r) => {
    // roof tiles, every one a slightly different red; rows run along the ridge
    for (let y = 0; y < 64; y += 4) {
      for (let x = ((y / 4) % 2) * 2 - 2; x < 64; x += 4) {
        g.fillStyle = shade(base, 0.86 + r() * 0.28);
        g.fillRect(x, y, 4, 4);
        g.fillStyle = dark;
        g.fillRect(x, y + 3, 4, 1);
        g.fillRect(x, y, 1, 3);
        if (r() < 0.14) {
          g.fillStyle = light;
          g.fillRect(x + 1, y, 3, 1);
        }
      }
    }
  });
const slabs = (base, line, speck, step) =>
  tex(base, (g, r) => {
    dots(g, r, 260, speck);
    g.fillStyle = line;
    for (let i = 0; i < 64; i += step) {
      g.fillRect(i, 0, 1, 64);
      g.fillRect(0, i, 64, 1);
    }
  });
const sheet = (base, line, step) =>
  tex(base, g => {
    // corrugated metal, ribs run down the slope
    g.fillStyle = line;
    for (let x = 0; x < 64; x += step) {
      g.fillRect(x, 0, 1, 64);
    }
  });

const textures = {
  grass: lawn(
    '#417a2e',
    ['#376f28', '#4b8935', '#3c782b'],
    ['#39702a', '#4a8634', '#346826', '#52913a'],
    ['#2d6022', '#5c9c42']
  ),
  meadow: lawn(
    '#5b9440',
    ['#52893a', '#68a24a', '#5f9a42'],
    ['#538a3a', '#66a048', '#6fa84e', '#4c8236'],
    ['#467c32', '#7cb458'],
    40
  ),
  forest: tex('#2c4f22', (g, r) =>
    dots(g, r, 600, ['#25441c', '#335a27', '#1f3b18'], 2)
  ),
  scrub: tex('#4b7a34', (g, r) =>
    dots(g, r, 500, ['#3c6829', '#5a8a3c', '#34591f'], 2)
  ),
  orchard: tex('#55903c', (g, r) =>
    dots(g, r, 400, ['#4c8236', '#63a046', '#467a30'])
  ),
  resi: lawn(
    '#4d8436',
    ['#457c31', '#58923e', '#4a8234'],
    ['#447a30', '#57903d', '#3e7029', '#5a9440'],
    ['#356a27', '#66a048'],
    26
  ),
  ind: slabs('#8b8b86', '#7b7b76', ['#84847f', '#93938e', '#7e7e79'], 32),
  com: slabs('#9c9a92', '#8c8a82', ['#94928a', '#a6a49c'], 16),
  school: slabs('#b3a98f', '#a09679', ['#a99f85', '#bdb399'], 8),
  yard: tex('#94896c', (g, r) =>
    dots(g, r, 600, ['#857a5e', '#a39878', '#7a7056', '#8b8b86'], 2)
  ),
  dump: tex('#8d867a', (g, r) =>
    dots(g, r, 700, ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9', '#5a564e'], 2)
  ),
  cem: lawn(
    '#4f8a3a',
    ['#467e33', '#5a9642', '#4b8436'],
    ['#467c32', '#5a9440', '#417630'],
    ['#356a27', '#68a24a']
  ),
  constr: tex('#9a8662', (g, r) =>
    dots(g, r, 500, ['#8a7654', '#a8946e', '#7c6a4a'], 2)
  ),
  park: tex('#58585d', (g, r) =>
    dots(g, r, 400, ['#505055', '#606065', '#4a4a4f'])
  ),
  play: tex('#c9b27a', (g, r) => dots(g, r, 300, ['#bba46c', '#d6c08a'])),
  clay: tex('#b5573a', (g, r) => dots(g, r, 300, ['#a84e33', '#c06343'])),
  water: tex('#2d6190', (g, r) => {
    g.fillStyle = '#4079aa';
    for (let i = 0; i < 40; i++) {
      g.fillRect((r() * 60) | 0, (r() * 64) | 0, 5, 1);
    }
  }),
  farmA: rows('#a39343', '#7f7030', ['#b3a350', '#8f823f']),
  farmB: rows('#6f5637', '#523d25', ['#7b6140', '#584226']),
  farmC: rows(
    '#5b4a30',
    '#4a3a24',
    ['#66543a'],
    ['#4f9a34', '#5fae3e', '#3f8a2c']
  ),
  farmD: rows('#c9ad4a', '#9f8636', ['#d8bf5c', '#b39a44']),
  asphalt: tex(
    '#48484d',
    (g, r, n) => {
      // worn tarmac: patches, cracks and a manhole now and then
      blots(g, r, 9, ['#424247', '#4f4f55'], n);
      dots(g, r, 2400, ['#404045', '#505056', '#3a3a3f', '#57575c'], 1, n);
      g.fillStyle = '#45454a';
      g.fillRect(18, 70, 24, 13);
      g.strokeStyle = '#38383c';
      g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        let x = r() * n;
        let y = r() * n;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 14;
          y += (r() - 0.2) * 9;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = '#2e2e32';
      g.beginPath();
      g.arc(90, 38, 3.2, 0, TAU);
      g.fill();
      g.strokeStyle = '#5e5e64';
      g.beginPath();
      g.arc(90, 38, 3.2, 0, TAU);
      g.stroke();
    },
    128
  ),
  cobble: tex('#8a867c', (g, r) => {
    g.fillStyle = '#726e66';
    for (let y = 0; y < 64; y += 4) {
      g.fillRect(0, y, 64, 1);
      for (let x = ((y / 4) % 2) * 4; x < 64; x += 8) {
        g.fillRect(x, y, 1, 4);
      }
    }
    dots(g, r, 120, ['#98948a', '#7e7a70']);
  }),
  sidewalk: slabs('#a09f97', '#8a8981', ['#96958d', '#aaa9a1'], 8),
  dirt: tex('#8b7350', (g, r) =>
    dots(g, r, 500, ['#7d6645', '#99815c', '#735d3e'], 2)
  ),
  gravel: tex('#7d776c', (g, r) =>
    dots(g, r, 600, ['#6c675d', '#8f897d', '#5f5a51'])
  ),
  tile1: tiles('#a5432b', '#8a3421', '#b8553a'),
  tile2: tiles('#b5622f', '#964c20', '#c8773f'),
  tile3: tiles('#7c3c2b', '#652e20', '#8f4a36'),
  tile4: tiles('#93382a', '#7a2b1f', '#a84a38'),
  slate: tiles('#4a4e57', '#3c4048', '#5a5e68'),
  metal: sheet('#9aa0a6', '#858b92', 4),
  metalRed: sheet('#8a4a3c', '#753c30', 4),
  tar: tex('#55565a', (g, r) => dots(g, r, 400, ['#4c4d51', '#5e5f63'], 2)),
  flat: tex('#7e7f84', (g, r) => {
    dots(g, r, 500, ['#74757a', '#88898e', '#6c6d72'], 2);
    g.fillStyle = '#5f6065';
    g.fillRect(40, 12, 5, 5);
  }),
  flatLight: slabs('#a8aab0', '#989aa0', ['#9ea0a6', '#b2b4ba'], 32),
  slab: tex('#bcbcb4', (g, r) => {
    dots(g, r, 200, ['#aeaea6', '#c8c8c0']);
    g.fillStyle = '#8e8e86';
    for (let y = 0; y < 64; y += 5) {
      g.fillRect(0, y, 64, 1);
    }
  }),
  concrete: tex('#b4b4ae', (g, r) =>
    dots(g, r, 300, ['#a8a8a2', '#c0c0ba'], 2)
  ),
  solar: tex('#9a9ca2', g => {
    for (let y = 2; y < 64; y += 16) {
      for (let x = 1; x < 64; x += 16) {
        g.fillStyle = '#1d2c4d';
        g.fillRect(x, y, 14, 11);
        g.fillStyle = '#31497a';
        g.fillRect(x, y, 14, 1);
        g.fillRect(x + 7, y, 1, 11);
      }
    }
  }),
};

// Tree canopies as little pixel blobs.
const CANOPY = [
  ['#1f4a1c', '#2c6425', '#3b7d2e', '#4f9438'],
  ['#24521f', '#327029', '#44883a', '#5c9f45'],
  ['#2a4a16', '#3e6a1e', '#557f28', '#6f9932'],
].map((cols, n) => {
  const c = canvas(40, 40);
  const g = c.getContext('2d');
  const r = rng(90 + n);
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 12 - k * 2; i++) {
      const a = r() * TAU;
      const d = r() * (13 - k * 3.4);
      g.fillStyle = cols[k];
      g.beginPath();
      g.arc(
        20 + Math.cos(a) * d - k * 1.5,
        20 + Math.sin(a) * d - k * 1.5,
        6 - k,
        0,
        TAU
      );
      g.fill();
    }
  }
  return c;
});

// ---------- world

/**
 * Adds what drawing and collisions need to a polygon: path, bounding box, area
 * and a local frame along its longest edge.
 * @param {!Object} o An area or building with its outline in `p`.
 */
function prepPoly(o) {
  const p = o.p;
  o.path = new Path2D();
  o.x0 = o.y0 = 1e9;
  o.x1 = o.y1 = -1e9;
  o.area = 0;
  let len = 0;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i];
    const y = p[i + 1];
    const j = (i + 2) % p.length;
    const ex = p[j] - x;
    const ey = p[j + 1] - y;
    if (i) {
      o.path.lineTo(x, y);
    } else {
      o.path.moveTo(x, y);
    }
    o.x0 = Math.min(o.x0, x);
    o.y0 = Math.min(o.y0, y);
    o.x1 = Math.max(o.x1, x);
    o.y1 = Math.max(o.y1, y);
    o.area += (x * p[j + 1] - p[j] * y) / 2;
    if (ex * ex + ey * ey > len) {
      len = ex * ex + ey * ey;
      o.ang = Math.atan2(ey, ex);
    }
  }
  o.path.closePath();
  o.mx = (o.x0 + o.x1) / 2;
  o.my = (o.y0 + o.y1) / 2;
  // a local frame along the longest edge, text in it reads upright
  const a =
    Math.abs(o.ang) > Math.PI / 2 ? o.ang - Math.sign(o.ang) * Math.PI : o.ang;
  o.ca = Math.cos(a);
  o.sa = Math.sin(a);
  o.lp = [];
  o.u0 = o.v0 = 1e9;
  o.u1 = o.v1 = -1e9;
  for (let i = 0; i < p.length; i += 2) {
    const u = (p[i] - o.mx) * o.ca + (p[i + 1] - o.my) * o.sa;
    const v = (p[i + 1] - o.my) * o.ca - (p[i] - o.mx) * o.sa;
    o.lp.push(u, v);
    o.u0 = Math.min(o.u0, u);
    o.u1 = Math.max(o.u1, u);
    o.v0 = Math.min(o.v0, v);
    o.v1 = Math.max(o.v1, v);
  }
}
const local = o => ctx.transform(o.ca, o.sa, -o.sa, o.ca, o.mx, o.my);

const AREAS = MAP.areas;
const FARM = [textures.farmA, textures.farmB, textures.farmC, textures.farmD];
/**
 * Lays out a cemetery: gravel walks along the long side, rows of graves
 * between them, and one broad walk across the middle.
 * @param {!Object} a The cemetery, already prepared by prepPoly().
 */
function layOutCemetery(a) {
  const r = rng(77);
  const world = (u, v) => [
    a.mx + u * a.ca - v * a.sa,
    a.my + u * a.sa + v * a.ca,
  ];
  a.walks = new Path2D();
  a.mainWalk = new Path2D();
  a.mainWalk.moveTo(...world(0, a.v0));
  a.mainWalk.lineTo(...world(0, a.v1));
  a.graves = [];
  for (let v = a.v0 + 2.4; v < a.v1 - 2; v += 4.6) {
    a.walks.moveTo(...world(a.u0, v + 2.3));
    a.walks.lineTo(...world(a.u1, v + 2.3));
    for (let u = a.u0 + 1.6; u < a.u1 - 1.2; u += 1.55) {
      const [x, y] = world(u, v);
      const corners = [
        world(u - 0.7, v - 1.3),
        world(u + 0.7, v - 1.3),
        world(u + 0.7, v + 1.3),
        world(u - 0.7, v + 1.3),
      ];
      const fits = corners.every(c => pip(c[0], c[1], a.p));
      if (Math.abs(u) < 2 || !fits || r() < 0.12) {
        continue; // the broad walk, the wall, or a plot nobody has taken yet
      }
      a.graves.push([x, y, (r() * 4) | 0, (r() * 5) | 0, (r() * 4) | 0]);
    }
  }
}

AREAS.forEach((a, i) => {
  prepPoly(a);
  a.fill =
    a.k === 'farm' ? FARM[i % 4] : a.k === 'pitch' ? null : textures[a.k];
  a.lpath = new Path2D(`M${a.lp.join(' ')}Z`);
  if (a.k === 'cem') {
    layOutCemetery(a);
  }
  if (a.k !== 'park') {
    return;
  }
  const ca = Math.cos(a.ang);
  const sa = Math.sin(a.ang);
  // Bay lines, on the grid parkCars() fills
  const radius = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2;
  a.bays = new Path2D();
  for (let v = -radius; v < radius; v += 5.8) {
    for (let u = -radius - 1.4; u < radius; u += 2.8) {
      a.bays.moveTo(
        a.mx + ca * u - sa * (v - 2.6),
        a.my + sa * u + ca * (v - 2.6)
      );
      a.bays.lineTo(
        a.mx + ca * u - sa * (v + 2.6),
        a.my + sa * u + ca * (v + 2.6)
      );
    }
  }
});

const DRIVE = [
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
];
const FOOT = ['path', 'footway', 'steps', 'cycleway'];
// A street with a name, so it has pavements and people
const town = r => r.n && !/^(St|ERH|BA) /.test(r.n);
for (const r of MAP.roads) {
  r.path = new Path2D();
  for (let i = 0; i < r.p.length; i += 2) {
    if (i) {
      r.path.lineTo(r.p[i], r.p[i + 1]);
    } else {
      r.path.moveTo(r.p[i], r.p[i + 1]);
    }
  }
}
/**
 * Collects the roads that pass a test into one path per stroke width.
 * @param {function(!Object):} ok boolean
 * @param {number=} extra Added to every stroke width.
 * @return {!Array<!Array>}
 */
function layer(ok, extra = 0) {
  const out = new Map();
  for (const r of MAP.roads) {
    if (ok(r)) {
      if (!out.has(r.w + extra)) {
        out.set(r.w + extra, new Path2D());
      }
      out.get(r.w + extra).addPath(r.path);
    }
  }
  return [...out];
}
const is =
  (...types) =>
  r =>
    types.includes(r.t);
const ROADS = {
  river: layer(is('river')),
  bank: layer(is('river'), 2.5),
  stream: layer(is('stream', 'ditch', 'drain')),
  rail: layer(is('rail')),
  dirt: layer(is('track')),
  foot: layer(r => FOOT.includes(r.t)),
  kerb: layer(r => DRIVE.includes(r.t) && !town(r), 0.8),
  walk: layer(r => DRIVE.includes(r.t) && town(r), 3.4),
  road: layer(r => DRIVE.includes(r.t) && r.t !== 'living_street'),
  cobble: layer(is('living_street')),
  line: layer(is('secondary', 'tertiary')),
};

// Road graph: `car` links carry the through traffic, `gps` links are everything
// you can drive, `walk` is for people.
const NODES = [];
const LINKS = [];
for (let i = 0; i < MAP.nodes.length; i += 2) {
  NODES.push({
    x: MAP.nodes[i],
    y: MAP.nodes[i + 1],
    w: 0,
    car: [],
    walk: [],
    gps: [],
  });
}
for (let i = 0; i < MAP.edges.length; i += 4) {
  const a = MAP.edges[i];
  const b = MAP.edges[i + 1];
  const road = MAP.roads[MAP.edges[i + 2]];
  const f = MAP.edges[i + 3];
  const len = dist(NODES[a], NODES[b]);
  if (f & 2) {
    NODES[a].car.push({n: b, w: road.w});
    if (!(f & 4)) {
      NODES[b].car.push({n: a, w: road.w});
    }
  }
  if (f & 9) {
    // the sat-nav likes main roads and avoids farm tracks, like somebody who
    // lives here
    const l = [a, b];
    l.k =
      {track: 3, service: 1.5, living_street: 1.25, residential: 1.1}[road.t] ||
      1;
    NODES[a].gps.push({n: b, cost: len * l.k});
    NODES[b].gps.push({n: a, cost: len * l.k});
    LINKS.push(l);
  }
  if (town(road) || FOOT.includes(road.t)) {
    NODES[a].walk.push(b);
    NODES[b].walk.push(a);
  }
  NODES[a].w = Math.max(NODES[a].w, road.w);
  NODES[b].w = Math.max(NODES[b].w, road.w);
}

// Low-res ground lookup, 2 m per cell. Bits: 1 = hard surface, 2 = passage
// under a building, 4 = road, 8 = deep water.
const SURF_W = (WORLD_W + 2 * EDGE) >> 1;
const SURF_H = (WORLD_H + 2 * EDGE) >> 1;
const SURF = (() => {
  const sheet = () => {
    const g = canvas(SURF_W, SURF_H).getContext('2d', {
      willReadFrequently: true,
    });
    g.setTransform(0.5, 0, 0, 0.5, EDGE / 2, EDGE / 2);
    g.lineJoin = g.lineCap = 'round';
    return g;
  };
  const g = sheet();
  const w = sheet();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = '#f00';
  for (const a of AREAS) {
    if (['park', 'ind', 'com', 'school', 'yard'].includes(a.k)) {
      g.fill(a.path);
    }
  }
  w.fillStyle = w.strokeStyle = '#fff';
  for (const a of AREAS) {
    if (a.k === 'water') {
      w.fill(a.path);
    }
  }
  for (const r of MAP.roads) {
    if (r.t === 'river') {
      w.lineWidth = r.w - 1.5;
      w.stroke(r.path);
    }
  }
  w.strokeStyle = '#000';
  for (const r of MAP.roads) {
    const road = DRIVE.includes(r.t);
    const way = road || r.t === 'track' || FOOT.includes(r.t);
    if (way) {
      w.lineWidth = r.w + 5;
      w.stroke(r.path);
    } // every road and path bridges the water
    if (!road && r.t !== 'track') {
      continue;
    }
    g.lineWidth = r.w + (road ? 4 : 1);
    g.strokeStyle = '#f00';
    g.stroke(r.path); // kerbs and pavements are hard ground too
    if (!road) {
      continue;
    }
    g.lineWidth = r.w + 1;
    g.strokeStyle = r.u ? '#0ff' : '#00f';
    g.stroke(r.path);
  }
  const d = g.getImageData(0, 0, SURF_W, SURF_H).data;
  const dw = w.getImageData(0, 0, SURF_W, SURF_H).data;
  const out = new Uint8Array(SURF_W * SURF_H);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      (d[i * 4] > 99) |
      ((d[i * 4 + 1] > 99) << 1) |
      ((d[i * 4 + 2] > 99) << 2) |
      ((dw[i * 4] > 140) << 3);
  }
  return out;
})();
/**
 * What the ground is like at a point.
 * @param {number} x
 * @param {number} y
 * @return {number} Bits: 1 hard surface, 2 passage under a building, 4 road, 8
 *     deep water.
 */
function surfAt(x, y) {
  const ix = (x + EDGE) >> 1;
  const iy = (y + EDGE) >> 1;
  return ix < 0 || iy < 0 || ix >= SURF_W || iy >= SURF_H
    ? 0
    : SURF[iy * SURF_W + ix];
}

// Every stretch of road: [ax, ay, bx, by, width, length, road].
const SEGS = [];
for (const r of MAP.roads) {
  if (DRIVE.includes(r.t) || r.t === 'track') {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      SEGS.push([
        r.p[i],
        r.p[i + 1],
        r.p[i + 2],
        r.p[i + 3],
        r.w,
        Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]),
        r,
      ]);
    }
  }
}
const SEG_MAX = Math.max(...SEGS.map(s => s[5]));

// ---------- buildings: walls lean away from the camera, roofs get a ridge and
// two slopes

const BUILD = MAP.buildings;
const buildingGrid = grid();
const LIGHT = [0.6, 0.8]; // faces turned south-east lie in shadow
const WALLS = {
  h: [
    '#e8dfc8',
    '#f1ead8',
    '#d9c9a4',
    '#e3d0c0',
    '#f0e6b8',
    '#efe9df',
    '#dfe3d8',
    '#e6c79c',
    '#d6b596',
  ],
  y: ['#cdbf9f', '#b99f7a', '#8f7152', '#d9cfb8'],
  i: ['#c8ccd2', '#d9dbde', '#b7bcc4', '#c4c8bc'],
  g: ['#d8d4c8', '#c9c5b9', '#e2ddd0'],
  m: ['#ece8dc'],
  c: ['#ece2c6'],
  s: ['#4a6fb5'],
  o: ['#8a8d92'],
  t: ['#ece2c6'],
  x: ['#b9b9b2', '#a9a9a2'],
  d: ['#8a6a48', '#a07a50', '#6f7f5a', '#7a5a3c', '#9a8f7a'],
};
/**
 * Splits a roof outline along its long axis into the two slopes of a gable.
 * @param {!Building} b
 * @param {number} rise How far the ridge stands above the eaves, in metres.
 */
function ridge(b, rise) {
  const mid = (b.v0 + b.v1) / 2;
  const lp = b.lp;
  const n = lp.length;
  b.halves = [[], []];
  b.gables = [];
  for (let i = 0, k = 0; i < n; i += 2, k++) {
    const j = (i + 2) % n;
    const da = lp[i + 1] - mid;
    const db = lp[j + 1] - mid;
    b.halves[da >= 0 ? 0 : 1].push(lp[i], lp[i + 1], 0);
    if (da >= 0 === db >= 0) {
      continue;
    }
    const t = da / (da - db);
    const x = lp[i] + (lp[j] - lp[i]) * t;
    b.halves[0].push(x, mid, 1);
    b.halves[1].push(x, mid, 1);
    b.gables.push([k, lp[i], lp[i + 1], x, mid, lp[j], lp[j + 1]]);
  }
  b.rh = rise;
  // How much the first slope faces the dark side
  const lit = -b.sa * LIGHT[0] + b.ca * LIGHT[1];
  b.tint = [lit, -lit].map(v =>
    v > 0
      ? `rgba(0,0,0,${(0.3 * v).toFixed(2)})`
      : `rgba(255,240,210,${(-0.18 * v).toFixed(2)})`
  );
  const xs = b.gables.map(g => g[3]);
  b.rx0 = Math.min(...xs);
  b.rx1 = Math.max(...xs);
  b.ry = mid;
}
/**
 * Picks walls and a roof for a building and files it in the grid.
 * @param {!Building} b
 * @param {!Rng} r
 */
function prepBuilding(b, r) {
  prepPoly(b);
  const base = pick2(WALLS[b.k] || WALLS.h, r);
  const wide = b.v1 - b.v0;
  b.nx = [];
  b.ny = [];
  b.wall = [];
  for (let i = 0; i < b.p.length; i += 2) {
    const j = (i + 2) % b.p.length;
    const ex = b.p[j] - b.p[i];
    const ey = b.p[j + 1] - b.p[i + 1];
    const l = Math.hypot(ex, ey) || 1;
    b.nx.push(ey / l);
    b.ny.push(-ex / l); // outward, polygons are clockwise
    b.wall.push(
      shade(base, 0.78 - 0.22 * ((ey / l) * LIGHT[0] - (ex / l) * LIGHT[1]))
    );
  }
  b.lpath = new Path2D();
  for (let i = 0; i < b.lp.length; i += 2) {
    if (i) {
      b.lpath.lineTo(b.lp[i], b.lp[i + 1]);
    } else {
      b.lpath.moveTo(b.lp[i], b.lp[i + 1]);
    }
  }
  b.lpath.closePath();
  const k = b.k;
  const big = b.a > 900;
  const v = r();
  let gable = b.p.length <= 28 && wide > 2.5;
  if (k === 's' || k === 't') {
    b.roof = k === 's' ? textures.concrete : textures.slate;
    b.apex = k === 's' ? 2 : 9;
    gable = false;
  } else if (k === 'x') {
    b.roof = textures.slab;
    gable = false;
  } else if (k === 'd') {
    b.roof = v < 0.5 ? textures.tar : v < 0.8 ? textures.tile3 : textures.metal;
    gable = v >= 0.25;
  } else if (k === 'o') {
    b.roof = textures.flatLight;
    gable = false;
  } else if (k === 'c') {
    b.roof = textures.slate;
  } else if (k === 'm') {
    b.roof = b.a > 1500 ? textures.flatLight : textures.flat;
    gable = false;
  } else if (k === 'i') {
    b.roof = big
      ? [textures.solar, textures.flatLight, textures.metal, textures.flat][
          (v * 4) | 0
        ]
      : textures.metal;
    gable = !big || b.roof === textures.metal;
  } else if (k === 'g') {
    b.roof = v < 0.5 ? textures.tar : v < 0.75 ? textures.flat : textures.tile3;
    gable = gable && v >= 0.75;
  } else if (k === 'y') {
    b.roof =
      b.a > 350
        ? [textures.metalRed, textures.metal, textures.tile3][(v * 3) | 0]
        : [textures.tile3, textures.tile2, textures.tile4][(v * 3) | 0];
  } else if (big) {
    b.roof = v < 0.5 ? textures.flat : textures.flatLight;
    gable = false;
  } else {
    b.roof =
      b.a > 350
        ? [textures.tile3, textures.tile4, textures.metalRed, textures.slate][
            (v * 4) | 0
          ]
        : [
            textures.tile1,
            textures.tile1,
            textures.tile2,
            textures.tile4,
            textures.tile3,
            textures.slate,
          ][(v * 6) | 0];
  }
  const metal = b.roof === textures.metal || b.roof === textures.metalRed;
  if (gable) {
    ridge(
      b,
      k === 'c'
        ? clamp(wide * 0.45, 2, 6)
        : clamp(wide * (metal ? 0.14 : 0.27), 0.7, 3.4)
    );
  }
  if (b.halves && b.gables.length < 2) {
    b.halves = null;
  }
  if (b.halves && k === 'h' && b.a > 60) {
    b.chim = [
      lerp(b.rx0, b.rx1, 0.25 + r() * 0.5),
      b.ry + (r() < 0.5 ? -1 : 1),
    ];
  }
  if (b.halves && k === 'h' && b.a > 80 && r() < 0.22) {
    b.pv = r() < 0.5 ? 0 : 1;
  } // solar panels on one slope
  if (!b.halves && !b.apex && b.a > 400 && k !== 'o')
  // vents and air conditioning on flat roofs
  {
    b.units = Array.from({length: Math.min(6, (b.a / 500) | 0) + 1}, () => [
      lerp(b.u0, b.u1, 0.15 + r() * 0.7),
      lerp(b.v0, b.v1, 0.2 + r() * 0.6),
      1.5 + r() * 2,
    ]);
  }
  b.floors = clamp(Math.round(b.h / 3), 1, 3);
  if (k !== 'o') {
    gridAdd(buildingGrid, b, b.x0 - 3, b.y0 - 3, b.x1 + 3, b.y1 + 3);
  }
}
const pick2 = (a, r) => a[(r() * a.length) | 0];
{
  // Not on the map, so made up: Röckelein's yard with silos and stacks of
  // concrete slabs, and garden sheds
  const r = rng(7);
  const [wx, wy] = MAP.pois.works;
  const [mx, my] = MAP.pois.depot;
  const yard = AREAS.find(a => a.k === 'ind' && pip(wx, wy, a.p));
  const boxes = BUILD.map(b => {
    const xs = b.p.filter((v, i) => i % 2 === 0);
    const ys = b.p.filter((v, i) => i % 2);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  const free = (x, y, rad) =>
    !boxes.some(
      b => x > b[0] - rad && x < b[2] + rad && y > b[1] - rad && y < b[3] + rad
    ) &&
    ![0, 1, 2, 3, 4, 5, 6, 7].some(
      i =>
        surfAt(
          x + Math.cos((i * TAU) / 8) * rad,
          y + Math.sin((i * TAU) / 8) * rad
        ) & 4
    );
  const add = (pts, h, k) => {
    BUILD.push({p: pts, h, a: 20, k});
    boxes.push([pts[0] - 8, pts[1] - 8, pts[0] + 8, pts[1] + 8]);
  };
  const spots = [];
  for (let y = yard ? yard.y0 : 0; yard && y < yard.y1; y += 9) {
    for (let x = yard.x0; x < yard.x1; x += 11) {
      if (pip(x, y, yard.p) && free(x, y, 7)) {
        spots.push([x, y, Math.hypot(x - mx, y - my)]);
      }
    }
  }
  spots.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of spots.filter(q => q[2] > 16).slice(0, 2)) {
    for (let i = -1; i < 2; i++) {
      // two clusters of three silos
      const pts = [];
      for (let k = 0; k < 10; k++) {
        pts.push(
          x + i * 6.4 + Math.cos((k * TAU) / 10) * 2.9,
          y + Math.sin((k * TAU) / 10) * 2.9
        );
      }
      add(pts, 13, 's');
    }
  }
  for (const [x, y, d] of spots) {
    if (d > 30 && free(x, y, 6) && r() < 0.45) {
      const w = 2.6 + r() * 2.2;
      const l = 1.3;
      add(
        [x - w, y - l, x + w, y - l, x + w, y + l, x - w, y + l],
        0.8 + r() * 1.8,
        'x'
      );
    }
  }
  // The street a house stands on: [x, y of the closest point, the stretch of
  // road, the distance], or null when no village street is within 32 m.
  const streetOf = (cx, cy) => {
    let found = null;
    let far = 32;
    for (const sg of SEGS) {
      if (
        Math.abs(sg[0] - cx) > 160 ||
        Math.abs(sg[1] - cy) > 160 ||
        !town(sg[6])
      ) {
        continue;
      }
      const pt = nearest(cx, cy, sg[0], sg[1], sg[2], sg[3]);
      const d = Math.hypot(cx - pt[0], cy - pt[1]);
      if (d < far) {
        far = d;
        found = [pt[0], pt[1], sg, d];
      }
    }
    return found;
  };
  // House number 11, east of Flo's, is newer than the map: put it there.
  const [hx, hy] = MAP.pois.hq;
  const flosStreet = streetOf(hx, hy);
  if (flosStreet) {
    const sg = flosStreet[2];
    const east = sg[2] > sg[0] ? 1 : -1;
    const dx = ((sg[2] - sg[0]) / sg[5]) * east;
    const dy = ((sg[3] - sg[1]) / sg[5]) * east;
    const cx = hx + dx * 25;
    const cy = hy + dy * 25;
    const corners = [
      [-6.5, -5],
      [6.5, -5],
      [6.5, 5],
      [-6.5, 5],
    ];
    BUILD.push({
      p: corners.flatMap(([u, v]) => [
        cx + u * dx - v * dy,
        cy + u * dy + v * dx,
      ]),
      h: 7,
      a: 130,
      k: 'h',
    });
    boxes.push([cx - 9, cy - 9, cx + 9, cy + 9]);
  }
  for (const b of [...BUILD]) {
    // every house remembers its street; every third one gets a shed in the back
    // garden
    if (b.k !== 'h' || b.a < 50 || b.a > 420) {
      continue;
    }
    const n = b.p.length / 2;
    const cx = b.p.reduce((sum, v, i) => (i % 2 ? sum : sum + v), 0) / n;
    const cy = b.p.reduce((sum, v, i) => (i % 2 ? sum + v : sum), 0) / n;
    b.rd = streetOf(cx, cy);
    if (!b.rd) {
      continue;
    }
    const [qx, qy, , far] = b.rd;
    const ux = (cx - qx) / far;
    const uy = (cy - qy) / far;
    const back = Math.sqrt(b.a) / 2 + 4.5 + r() * 3;
    const side = (r() - 0.5) * 9;
    const keep = r() < 0.36;
    const sx = cx + ux * back - uy * side;
    const sy = cy + uy * back + ux * side;
    const w = 1.3 + r() * 0.5;
    const l = 1.6 + r() * 0.7;
    if (
      !keep ||
      b.a < 70 ||
      !free(sx, sy, 3.6) ||
      surfAt(sx, sy) ||
      sx < 8 ||
      sy < 8 ||
      sx > WORLD_W - 8 ||
      sy > WORLD_H - 8
    ) {
      continue;
    }
    add(
      [
        [-w, -l],
        [w, -l],
        [w, l],
        [-w, l],
      ].flatMap(([u, v]) => [sx + u * ux - v * uy, sy + u * uy + v * ux]),
      2.1 + r() * 0.5,
      'd'
    );
  }
}
{
  const r = rng(42);
  for (const b of [...BUILD]) {
    prepBuilding(b, r);
    if (b.k !== 'c' || b.a < 250) {
      continue;
    }
    // every church gets a tower at its western end
    const west = b.ca > 0 ? b.u0 + 3.4 : b.u1 - 3.4;
    const cx = b.mx + west * b.ca;
    const cy = b.my + west * b.sa;
    const q = [];
    for (const [u, v] of [
      [-3.4, -3.4],
      [3.4, -3.4],
      [3.4, 3.4],
      [-3.4, 3.4],
    ]) {
      q.push(cx + u * b.ca - v * b.sa, cy + u * b.sa + v * b.ca);
    }
    const t = {p: q, h: 15, a: 46, k: 't'};
    BUILD.push(t);
    prepBuilding(t, r);
  }
}
const SOLID = BUILD.filter(b => b.k !== 'o');

const TREES = [];
const treeGrid = grid();
{
  const r = rng(3);
  const add = (tx, ty, size) => {
    if (
      [
        [0, 0],
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ].some(o => surfAt(tx + o[0], ty + o[1]))
    ) {
      return;
    }
    if (at(buildingGrid, tx, ty).some(b => pushOut(tx, ty, 3, b.p))) {
      return;
    }
    const t = {
      x: tx,
      y: ty,
      r: size + r() * 1.8,
      h: 4 + r() * 5,
      s: (r() * 3) | 0,
    };
    TREES.push(t);
    gridAdd(treeGrid, t, tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6);
  };
  const plant = (a, step, chance, size, jitter = 1) => {
    for (
      let y = Math.max(a.y0, -EDGE);
      y < Math.min(a.y1, WORLD_H + EDGE);
      y += step
    ) {
      for (
        let x = Math.max(a.x0, -EDGE);
        x < Math.min(a.x1, WORLD_W + EDGE);
        x += step
      ) {
        const tx = x + r() * step * jitter;
        const ty = y + r() * step * jitter;
        if (r() < chance && pip(tx, ty, a.p)) {
          add(tx, ty, size);
        }
      }
    }
  };
  for (const a of AREAS) {
    if (a.k === 'forest') {
      plant(a, 9, 0.85, 2.4);
    }
    if (a.k === 'scrub') {
      plant(a, 11, 0.6, 1.6);
    }
    if (a.k === 'resi') {
      plant(a, 24, 0.45, 2);
    }
    if (a.k === 'meadow') {
      plant(a, 38, 0.25, 2.2);
    }
    if (a.k === 'orchard') {
      plant(a, 8, 1, 1.4, 0.2);
    }
    if (a.k === 'cem') {
      plant(a, 26, 0.3, 1.6);
    }
  }
  for (let i = 0; i < MAP.trees.length; i += 2) {
    add(MAP.trees[i], MAP.trees[i + 1], 2.4);
  }
}
const HEDGES = new Path2D();
for (const h of MAP.hedges) {
  for (let i = 0; i < h.length; i += 2) {
    if (i) {
      HEDGES.lineTo(h[i], h[i + 1]);
    } else {
      HEDGES.moveTo(h[i], h[i + 1]);
    }
  }
}

const blocked = (x, y, r) =>
  at(buildingGrid, x, y).some(b => pushOut(x, y, r, b.p));

// Johann-Philipp-Ring is a new estate: the gardens are still bare earth, there
// are no fences yet, and every house has a paved drive down to the street.
const NEW_ESTATE = 'Johann-Philipp-Ring';

// Street furniture. Fences are painted on; lanterns and hydrants give way when
// a car hits them.
const FENCES = new Path2D();
const streetProps = [];
const propGrid = grid();
for (const f of MAP.fences || []) {
  for (let i = 0; i < f.length; i += 2) {
    if (i) {
      FENCES.lineTo(f[i], f[i + 1]);
    } else {
      FENCES.moveTo(f[i], f[i + 1]);
    }
  }
}
{
  const r = rng(5);
  for (const b of BUILD) {
    // a garden fence along the street in front of most houses, with a gap for
    // the gate
    if (!b.rd || r() > 0.75 || b.rd[2][6].n === NEW_ESTATE) {
      continue;
    }
    const [qx, qy, sg, far] = b.rd;
    const dx = (sg[2] - sg[0]) / sg[5];
    const dy = (sg[3] - sg[1]) / sg[5];
    const off = sg[4] / 2 + 2.3;
    if (far < off + 3) {
      continue;
    } // the house stands right at the kerb
    const side = Math.sign((b.mx - qx) * -dy + (b.my - qy) * dx) || 1;
    const along = (qx - sg[0]) * dx + (qy - sg[1]) * dy;
    const half = Math.max(b.u1 - b.u0, b.v1 - b.v0) / 2 + 1.5;
    const gate = along + (r() - 0.5) * half;
    let from = null;
    for (let t = Math.max(1, along - half); ; t += 0.5) {
      const x = sg[0] + dx * t - dy * off * side;
      const y = sg[1] + dy * t + dx * off * side;
      const ok =
        t < Math.min(sg[5] - 1, along + half) &&
        Math.abs(t - gate) > 1.5 &&
        !(surfAt(x, y) & 4) &&
        !blocked(x, y, 0.7);
      if (ok && !from) {
        from = [x, y];
      }
      if (!ok && from) {
        if (Math.hypot(x - from[0], y - from[1]) > 2) {
          FENCES.moveTo(from[0], from[1]);
          FENCES.lineTo(x, y);
        }
        from = null;
      }
      if (t > along + half) {
        break;
      }
    }
  }
  const crossings = NODES.filter(n => n.gps.length > 2);
  const put = (k, x, y, a) => {
    if (
      blocked(x, y, 0.9) ||
      x < 6 ||
      y < 6 ||
      x > WORLD_W - 6 ||
      y > WORLD_H - 6 ||
      crossings.some(n => Math.hypot(n.x - x, n.y - y) < 8)
    ) {
      return;
    }
    const o = {k, x, y, a, down: 0, fa: 0};
    streetProps.push(o);
    gridAdd(propGrid, o, x - 1, y - 1, x + 1, y + 1);
  };
  for (const road of MAP.roads) {
    if (DRIVE.includes(road.t) && town(road)) {
      // a lantern every 36 m, changing sides; now and then a hydrant
      let run = r() * 30;
      let n = (r() * 5) | 0;
      for (let i = 0; i + 3 < road.p.length; i += 2) {
        const ax = road.p[i];
        const ay = road.p[i + 1];
        const len = Math.hypot(road.p[i + 2] - ax, road.p[i + 3] - ay) || 1;
        const dx = (road.p[i + 2] - ax) / len;
        const dy = (road.p[i + 3] - ay) / len;
        for (; run < len; run += 36, n++) {
          const side = n % 2 ? 1 : -1;
          const off = road.w / 2 + 1.1;
          put(
            'lamp',
            ax + dx * run - dy * off * side,
            ay + dy * run + dx * off * side,
            Math.atan2(-dx * side, dy * side)
          );
          if (n % 4 === 1 && run + 15 < len) {
            put(
              'hydrant',
              ax + dx * (run + 15) + dy * (off - 0.2) * side,
              ay + dy * (run + 15) - dx * (off - 0.2) * side,
              0
            );
          }
        }
        run -= len;
      }
    }
  }
}
/**
 * A car takes a lantern or a hydrant with it.
 * @param {!Prop} p
 * @param {!Car} c
 */
function knock(p, c) {
  if (Math.hypot(c.vx, c.vy) < 2.5) {
    return;
  }
  p.down = 1;
  p.fa = Math.atan2(c.vy, c.vx);
  c.vx *= 0.88;
  c.vy *= 0.88;
  damage(c, 8);
  for (let i = 0; i < 5; i++) {
    puff(p.x, p.y, 'spark');
  }
  if (p.k === 'hydrant') {
    state.sprays.push({x: p.x, y: p.y, t: 10});
    if (dist(p, state.player) < 90) {
      audio.play('splash');
    }
  }
  if (c === state.player.car) {
    float(p, p.k === 'hydrant' ? 'PLATSCH!' : 'KLONK!', '#ff5a1f');
  }
}

/**
 * Where you pull up for a place: at the edge of the nearest road, on the side
 * the place is on.
 * @param {number} x
 * @param {number} y
 * @return {{x: number, y: number, a: number}}
 */
function roadside(x, y) {
  let best = 1e9;
  let q = null;
  let seg = null;
  for (const s of SEGS) {
    const p = nearest(x, y, s[0], s[1], s[2], s[3]);
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < best) {
      best = d;
      q = p;
      seg = s;
    }
  }
  const a = Math.atan2(seg[3] - seg[1], seg[2] - seg[0]);
  for (let off = Math.min(best, seg[4] / 2 + 2); off > 0; off -= 1) {
    const sx = q[0] + ((x - q[0]) / (best || 1)) * off;
    const sy = q[1] + ((y - q[1]) / (best || 1)) * off;
    if (!blocked(sx, sy, 2.2)) {
      return {x: sx, y: sy, a};
    }
  }
  return {x: q[0], y: q[1], a};
}
const SPOT = {};
for (const k of Object.keys(MAP.pois)) {
  SPOT[k] = Object.assign(roadside(...MAP.pois[k]), {
    key: k,
    name: PLACES[k] || k,
  });
}

// Signs on the roofs of the big landmarks.
for (const [key, text] of Object.entries(SIGNS)) {
  const [x, y] = MAP.pois[key];
  let best = null;
  let bd = 60;
  for (const b of SOLID) {
    const d = pip(x, y, b.p) ? 0 : Math.hypot(b.mx - x, b.my - y);
    if (d < bd && b.k !== 't') {
      bd = d;
      best = b;
    }
  }
  if (best) {
    best.label = text;
    best.poi = key;
  }
}

const NEW_HOUSES = BUILD.filter(b => b.rd && b.rd[2][6].n === NEW_ESTATE);

/**
 * Where a car stands on the drive of a house, nose to the street.
 * @param {!Building} b A house that knows its street.
 * @return {{x: number, y: number, a: number}}
 */
function driveSpot(b) {
  const [qx, qy, seg, far] = b.rd;
  const ux = (b.mx - qx) / far;
  const uy = (b.my - qy) / far;
  let along = seg[4] / 2 + 6.5;
  while (
    along > seg[4] / 2 + 3 &&
    blocked(qx + ux * along, qy + uy * along, 2.6)
  ) {
    along -= 0.5;
  }
  return {x: qx + ux * along, y: qy + uy * along, a: Math.atan2(-uy, -ux)};
}
const HOME = BUILD.find(b => b.poi === 'hq');

/**
 * Index of the junction closest to a point.
 * @param {!Point} o
 * @param {string} links The links the junction must have: 'car', 'gps' or
 *     'walk'.
 * @return {number}
 */
function nearNode(o, links) {
  let best = 0;
  let bd = 1e9;
  NODES.forEach((n, i) => {
    const d = dist(n, o);
    if (
      n[links].length &&
      d < bd &&
      n.x > 20 &&
      n.y > 20 &&
      n.x < WORLD_W - 20 &&
      n.y < WORLD_H - 20
    ) {
      bd = d;
      best = i;
    }
  });
  return best;
}
/**
 * The stretch of road next to a point.
 * @param {!Point} o
 * @return {!Array} [link, x, y] with the closest point on the link.
 */
function nearLink(o) {
  let best = 1e9;
  let link = null;
  let qx = 0;
  let qy = 0;
  for (const l of LINKS) {
    const a = NODES[l[0]];
    const b = NODES[l[1]];
    const q = nearest(o.x, o.y, a.x, a.y, b.x, b.y);
    const d = (o.x - q[0]) ** 2 + (o.y - q[1]) ** 2;
    if (d < best) {
      best = d;
      link = l;
      qx = q[0];
      qy = q[1];
    }
  }
  return [link, qx, qy];
}
/**
 * Road cost from every junction to one place, for the yellow arrow and the
 * police.
 * @param {!Point} o
 * @return {!Float32Array}
 */
function field(o) {
  const d = new Float32Array(NODES.length).fill(1e9);
  const [link, x, y] = nearLink(o);
  const q = [...link];
  for (const n of link) {
    d[n] = Math.hypot(NODES[n].x - x, NODES[n].y - y) * link.k;
  }
  while (q.length) {
    const i = q.shift();
    for (const e of NODES[i].gps) {
      if (d[i] + e.cost < d[e.n]) {
        d[e.n] = d[i] + e.cost;
        q.push(e.n);
      }
    }
  }
  return d;
}
/**
 * The next junction on the cheapest way to the origin of a field.
 * @param {!Float32Array} f
 * @param {number} n
 * @return {number} The junction index, or -1 at the origin.
 */
function downhill(f, n) {
  let best = -1;
  let cost = 1e9;
  for (const e of NODES[n].gps) {
    if (f[e.n] < f[n] && f[e.n] + e.cost < cost) {
      cost = f[e.n] + e.cost;
      best = e.n;
    }
  }
  return best;
}
/**
 * The point some metres further down the road.
 * @param {!Float32Array} f
 * @param {!Point} o
 * @param {number} ahead
 * @return {?Point} Null where no road leads on.
 */
function waypoint(f, o, ahead) {
  const [link, qx, qy] = nearLink(o);
  const cost = n =>
    f[n] + Math.hypot(NODES[n].x - qx, NODES[n].y - qy) * link.k;
  let n = cost(link[0]) < cost(link[1]) ? link[0] : link[1];
  let x = qx;
  let y = qy;
  if (f[n] > 1e8) {
    return null;
  }
  for (let go = ahead; ;) {
    const node = NODES[n];
    const d = Math.hypot(node.x - x, node.y - y);
    if (d >= go) {
      return {x: x + ((node.x - x) / d) * go, y: y + ((node.y - y) / d) * go};
    }
    go -= d;
    x = node.x;
    y = node.y;
    const m = downhill(f, n);
    if (m < 0) {
      return {x, y};
    }
    n = m;
  }
}

// ---------- sprites

const TYPES = {
  car: {
    name: [
      'Familienkutsche',
      'Rostlaube',
      'Dorfschleuder',
      'Kombi vom Nachbarn',
    ],
    length: 4.4,
    width: 2,
    max: 38,
    acc: 15,
    hp: 100,
    mass: 1,
  },
  sport: {
    name: ['Sportflitzer', 'Angeberkarre'],
    length: 4.4,
    width: 2,
    max: 48,
    acc: 20,
    hp: 80,
    mass: 0.9,
  },
  van: {
    name: ['Kastenwagen', 'Handwerkerbus'],
    length: 5.6,
    width: 2.3,
    max: 30,
    acc: 11,
    hp: 140,
    mass: 1.7,
  },
  pizza: {
    name: ['Pizza-Flitzer'],
    length: 3.9,
    width: 1.9,
    max: 41,
    acc: 18,
    hp: 150,
    mass: 0.9,
  },
  police: {
    name: ['Streifenwagen'],
    length: 4.6,
    width: 2,
    max: 45,
    acc: 19,
    hp: 150,
    mass: 1.1,
  },
  tractor: {
    name: ['Bulldog'],
    length: 4.2,
    width: 2.3,
    max: 16,
    acc: 10,
    hp: 220,
    mass: 2.4,
  },
  truck: {
    name: ['Bierlaster'],
    length: 7.4,
    width: 2.5,
    max: 27,
    acc: 9,
    hp: 230,
    mass: 3,
  },
  tipper: {
    name: ['Kipper'],
    length: 7,
    width: 2.5,
    max: 26,
    acc: 9,
    hp: 250,
    mass: 3.2,
  },
  mixer: {
    name: ['Betonmischer'],
    length: 7.8,
    width: 2.6,
    max: 25,
    acc: 8.5,
    hp: 280,
    mass: 4,
  },
  fire: {
    name: ['Löschfahrzeug LF 16/12'],
    length: 7.2,
    width: 2.5,
    max: 33,
    acc: 12,
    hp: 280,
    mass: 3,
  },
};
for (const type of Object.values(TYPES)) {
  // a row of collision circles along the body
  type.r = type.width / 2;
  const e = type.length / 2 - type.r;
  type.offs = type.length > 6 ? [e, 0, -e] : [e, -e];
}
const COLORS = [
  '#c8322b',
  '#2b62c8',
  '#e8e6df',
  '#22242a',
  '#2f8f4a',
  '#9aa2ad',
  '#d9651e',
  '#7a3fb0',
  '#e0b21c',
  '#6b4a2a',
];
const PAINT = {
  pizza: '#efece2',
  police: '#d9dcdf',
  tractor: '#2e7d32',
  truck: '#2b62c8',
  tipper: '#284d98',
  mixer: '#284d98',
  fire: '#c8201c',
  van: '#eeeee8',
};
const spriteCache = new Map();
/**
 * The picture of a vehicle, drawn nose-right.
 * @param {string} kind
 * @param {string} col Body colour; 'wreck' gives the burnt-out shell.
 * @param {number=} frame Animation frame or livery.
 * @return {!HTMLCanvasElement}
 */
function carSprite(kind, col, frame = 0) {
  const key = kind + col + frame;
  if (spriteCache.has(key)) {
    return spriteCache.get(key);
  }
  const type = TYPES[kind];
  const w = Math.round(type.length * PX_PER_M);
  const h = Math.round(type.width * PX_PER_M);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const rect = (x, y, ww, hh, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, ww, hh);
  };
  const wreck = col === 'wreck';
  const body = wreck ? '#2b2724' : col;
  const glass = wreck ? '#141210' : '#182533';
  const mid = h >> 1;
  const paint = f =>
    wreck ? shade('#2b2724', 0.8 + (parseInt(f.slice(1, 3), 16) % 5) / 12) : f;
  const box = (x0, x1, f) => {
    // a rounded, outlined slab from x0 to x1
    rect(x0 + 2, 0, x1 - x0 - 4, h, '#0b0b0d');
    rect(x0, 2, x1 - x0, h - 4, '#0b0b0d');
    rect(x0 + 1, 1, x1 - x0 - 2, h - 2, '#0b0b0d');
    rect(x0 + 2, 1, x1 - x0 - 4, h - 2, f);
    rect(x0 + 1, 2, x1 - x0 - 2, h - 4, f);
    rect(x0 + 3, 1, x1 - x0 - 6, 1, shade(f, 1.25));
    rect(x0 + 3, h - 2, x1 - x0 - 6, 1, shade(f, 0.7));
  };
  const cab = len => {
    box(w - len, w, body);
    rect(w - len + 5, 2, 4, h - 4, glass);
    rect(w - len + 1, 3, 4, h - 6, shade(body, 1.1));
  };
  const lamps = () => {
    if (!wreck) {
      rect(w - 2, 2, 1, 3, '#ffe9a0');
      rect(w - 2, h - 5, 1, 3, '#ffe9a0');
      rect(1, 2, 1, 3, '#e02a2a');
      rect(1, h - 5, 1, 3, '#e02a2a');
    }
  };
  if (
    kind === 'car' ||
    kind === 'sport' ||
    kind === 'police' ||
    kind === 'pizza'
  ) {
    const a = Math.round(w * 0.2);
    const b = Math.round(w * 0.6);
    box(0, w, body);
    if (kind === 'sport' && !wreck) {
      rect(2, mid - 1, w - 4, 2, '#f4f4ef');
    }
    rect(a, 2, b - a + 5, h - 4, glass);
    rect(a + 3, 3, b - a - 3, h - 6, shade(body, 1.12));
    if (kind === 'sport' && !wreck) {
      rect(a + 3, mid - 1, b - a - 3, 2, '#f4f4ef');
    }
    if (kind === 'police' && !wreck) {
      rect(3, 1, w - 6, 2, '#1f5fbf');
      rect(3, h - 3, w - 6, 2, '#1f5fbf');
      rect(w - 9, 3, 6, h - 6, '#1f5fbf');
      rect(a + 7, 3, 3, h - 6, '#cfd8e6');
    }
    if (kind === 'pizza' && !wreck) {
      // red and green flanks, and the sign on the roof
      rect(3, 1, w - 6, 2, '#c8201c');
      rect(3, h - 3, w - 6, 2, '#2f8f4a');
      rect(a + 4, mid - 4, 8, 8, '#0b0b0d');
      rect(a + 5, mid - 3, 2, 6, '#2f8f4a');
      rect(a + 7, mid - 3, 2, 6, '#f4f4ef');
      rect(a + 9, mid - 3, 2, 6, '#c8201c');
    }
  } else if (kind === 'van') {
    box(0, w, body);
    rect(w - 12, 2, 5, h - 4, glass);
    rect(3, 2, w - 17, h - 4, shade(body, 1.06));
    if (!wreck) {
      rect(3, mid - 1, w - 17, 3, COLORS[frame % COLORS.length]);
    } // company stripe
  } else if (kind === 'tractor') {
    rect(1, 0, 12, 5, '#101012');
    rect(1, h - 5, 12, 5, '#101012');
    rect(w - 10, 1, 7, 3, '#101012');
    rect(w - 10, h - 4, 7, 3, '#101012');
    rect(5, 4, w - 7, h - 8, '#0b0b0d');
    rect(6, 5, w - 9, h - 10, body);
    rect(w - 13, 6, 10, h - 12, shade(body, 1.15));
    rect(w - 4, 6, 1, h - 12, '#333');
    rect(5, 3, 13, h - 6, '#0b0b0d');
    rect(6, 4, 11, h - 8, glass);
    rect(8, 6, 7, h - 12, shade(body, 0.8));
    rect(w - 15, 5, 2, 2, '#444');
  } else if (kind === 'truck') {
    box(0, w - 14, paint('#efe6cc'));
    if (!wreck) {
      rect(3, mid - 3, w - 20, 6, '#d99a1a');
      rect(3, mid - 1, w - 20, 2, '#f6efd9');
      for (let x = 7; x < w - 20; x += 8) {
        rect(x, 2, 1, h - 4, '#d6ccae');
      }
    }
    cab(15);
  } else if (kind === 'tipper') {
    box(0, w - 14, paint('#6c6f76'));
    rect(3, 3, w - 20, h - 6, paint('#8d867a'));
    if (!wreck) {
      for (let i = 0; i < 40; i++) {
        rect(
          3 + ((i * 37) % (w - 21)),
          3 + ((i * 53) % (h - 7)),
          2,
          1,
          ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9'][i % 4]
        );
      }
    }
    cab(15);
  } else if (kind === 'mixer') {
    const dw = w - 21;
    const drum = paint('#d8d8d2');
    rect(2, 3, w - 16, h - 6, '#26262a');
    rect(5, 1, dw - 4, h - 2, '#0b0b0d');
    rect(3, 3, dw, h - 6, '#0b0b0d');
    rect(5, 2, dw - 4, h - 4, drum);
    rect(4, 4, dw - 2, h - 8, drum);
    if (!wreck) {
      for (let x = -4 + frame * 2; x < dw; x += 8) {
        for (let y = 2; y < h - 2; y++) {
          // the spiral on the drum turns
          const xx = 3 + x + (y >> 1);
          if (
            xx > 4 &&
            xx < dw + 1 &&
            ((y > 3 && y < h - 4) || (xx > 5 && xx < dw - 1))
          ) {
            rect(xx, y, 2, 1, body);
          }
        }
      }
    }
    rect(5, 2, dw - 4, 1, shade(drum, 1.1));
    rect(dw + 2, mid - 2, 3, 4, '#55565a');
    cab(15);
  } else if (kind === 'fire') {
    box(0, w, body);
    if (!wreck) {
      rect(3, 1, w - 20, 3, '#c4c7cc');
      rect(3, h - 4, w - 20, 3, '#c4c7cc');
      for (let x = 8; x < w - 18; x += 6) {
        rect(x, 1, 1, 3, '#8d9096');
        rect(x, h - 4, 1, 3, '#8d9096');
      }
      rect(5, mid - 3, w - 24, 1, '#e6e6e0');
      rect(5, mid + 2, w - 24, 1, '#e6e6e0');
      for (let x = 6; x < w - 20; x += 3) {
        rect(x, mid - 2, 1, 4, '#e6e6e0');
      }
      rect(w - 17, 1, 2, h - 2, '#f4f4ef');
    }
    rect(w - 10, 2, 5, h - 4, glass);
    rect(w - 14, 3, 3, h - 6, shade(body, 1.15));
  }
  lamps();
  spriteCache.set(key, c);
  return c;
}
const TRAILERS = {
  grain: {length: 5.2, width: 2.3},
  log: {length: 13, width: 1.8},
};
for (const [kind, type] of Object.entries(TRAILERS)) {
  const w = (type.length * PX_PER_M) | 0;
  const h = (type.width * PX_PER_M) | 0;
  const c = (type.spr = canvas(w, h));
  const g = c.getContext('2d');
  const rect = (x, y, ww, hh, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, ww, hh);
  };
  if (kind === 'grain') {
    rect(4, 0, 8, h, '#101012');
    rect(w - 14, 0, 8, h, '#101012');
    rect(0, 1, w - 3, h - 2, '#0b0b0d');
    rect(1, 2, w - 5, h - 4, '#6b4a2a');
    rect(3, 4, w - 9, h - 8, '#d9b23c');
    for (let i = 0; i < 50; i++) {
      rect(
        3 + ((i * 29) % (w - 10)),
        4 + ((i * 17) % (h - 9)),
        1,
        1,
        i % 2 ? '#f0cf5a' : '#b8922a'
      );
    }
    rect(w - 3, h / 2 - 1, 3, 2, '#333');
  } else {
    // the maypole: white and blue, wreath at the tip
    rect(6, 0, 8, h, '#101012');
    rect(w - 26, 0, 8, h, '#101012');
    rect(4, 3, w - 12, h - 6, '#2a2a2e');
    rect(0, h / 2 - 2, w - 6, 4, '#f4f4ef');
    for (let x = 2; x < w - 8; x += 8) {
      rect(x, h / 2 - 2, 4, 4, '#2b62c8');
    }
    rect(0, h / 2 - 4, 5, 8, '#2f8f4a');
    rect(w - 6, h / 2 - 1, 6, 2, '#333');
  }
}

const iconCache = {};
/**
 * Little pixel pictures for the things you carry around.
 * @param {string} kind
 * @return {!HTMLCanvasElement}
 */
function icon(kind) {
  if (iconCache[kind]) {
    return iconCache[kind];
  }
  const c = (iconCache[kind] = canvas(12, 12));
  const g = c.getContext('2d');
  const rect = (x, y, w, h, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, w, h);
  };
  if (kind === 'can') {
    rect(3, 1, 6, 10, '#111');
    rect(4, 2, 4, 8, '#1c1c1c');
    rect(4, 4, 4, 3, '#b3261e');
    rect(4, 1, 4, 1, '#c9c9c9');
    rect(5, 5, 2, 1, '#fff');
  } else if (kind === 'cash') {
    rect(1, 3, 10, 6, '#1e5a2a');
    rect(2, 4, 8, 4, '#4caf50');
    rect(5, 5, 2, 2, '#e8f5e9');
  } else if (kind === 'fish') {
    rect(2, 4, 6, 4, '#8a9a7a');
    rect(3, 3, 4, 6, '#a8b894');
    rect(8, 3, 2, 6, '#6f7f62');
    rect(3, 5, 1, 1, '#111');
  } else if (kind === 'barrel') {
    rect(2, 1, 8, 10, '#6b4a2a');
    rect(1, 3, 10, 6, '#8a6238');
    rect(1, 3, 10, 1, '#b9b9b4');
    rect(1, 8, 10, 1, '#b9b9b4');
    rect(5, 5, 2, 2, '#3a2a1a');
  } else {
    rect(1, 2, 10, 8, '#6b4a2a');
    rect(2, 3, 8, 6, '#c69c6d');
    rect(1, 5, 10, 1, '#6b4a2a');
    rect(5, 2, 1, 8, '#6b4a2a');
  }
  return c;
}

// ---------- state

let state;
const fmt = v => `${Math.round(v).toLocaleString('de-DE')} €`;
const SAVE_KEY = 'gtw-save';
/**
 * Reads the saved game.
 * @return {?Object}
 */
function load() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
/** Saves the progress in the browser. */
function store() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({n: state.jobN, money: state.money, stats: state.stats})
    );
  } catch {
    /* private mode */
  }
}

/**
 * Builds a fresh world.
 * @param {string} mode 'menu' or 'play'.
 * @param {?Object=} save A saved game to continue.
 */
function reset(mode, save) {
  for (const p of streetProps) {
    p.down = 0;
  }
  state = {
    mode,
    t: 0,
    money: 0,
    shown: 0,
    cars: [],
    peds: [],
    items: [],
    parts: [],
    decals: [],
    texts: [],
    sprays: [],
    job: null,
    jobN: 0,
    nextJob: 5,
    pager: {q: [], cur: '', n: 0, hold: 0, said: 0, idle: ''},
    spawnT: 0,
    shake: 0,
    wasted: 0,
    paused: false,
    crashT: 0,
    wanted: 0,
    seen: 0,
    bust: 0,
    gps: null,
    gpsT: 0,
    copF: null,
    copT: 0,
    whereT: 0,
    finale: 0,
    map: false,
    stats: {missions: 0, stolen: 0, peds: 0, wrecks: 0, busted: 0, wasted: 0},
    cam: {x: 1450, y: 900, z: 4.4},
    player: null,
  };
  if (save) {
    state.jobN = save.n;
    state.money = state.shown = save.money;
    Object.assign(state.stats, save.stats);
  }
  const hq = HOME && HOME.rd ? driveSpot(HOME) : SPOT.hq;
  const car = makeCar(hq.x, hq.y, hq.a, 'car', '#e8e6df');
  state.player = {
    x: hq.x + Math.sin(hq.a) * 2.4,
    y: hq.y - Math.cos(hq.a) * 2.4,
    a: hq.a,
    t: 0,
    car: null,
  };
  if (mode === 'play') {
    Object.assign(state.cam, {x: state.player.x, y: state.player.y, z: 12});
  }
  car.radio = 0;
  parkCars();
  for (let i = 0; i < 45; i++) {
    populate(1, mode === 'play' ? 45 : 0);
  }
  for (let i = 0; i < 40; i++) {
    dropCash();
  }
}

/**
 * Puts a vehicle into the world.
 * @param {number} x
 * @param {number} y
 * @param {number} a Heading, in radians.
 * @param {string} kind
 * @param {string=} col
 * @return {!Car}
 */
function makeCar(x, y, a, kind, col = PAINT[kind] || pick(COLORS)) {
  const type = TYPES[kind];
  const c = {
    x,
    y,
    a,
    vx: 0,
    vy: 0,
    vf: 0,
    spin: 0,
    thr: 0,
    steer: 0,
    hb: false,
    type,
    kind,
    col,
    spr: carSprite(kind, col, kind === 'van' ? (Math.random() * 9) | 0 : 0),
    name: pick(type.name),
    hp: type.hp,
    burn: 0,
    dead: false,
    ai: null,
    radio:
      kind === 'tractor'
        ? 1
        : Math.random() < 0.15
          ? -1
          : (Math.random() * 4) | 0,
  };
  state.cars.push(c);
  return c;
}
/**
 * Hangs a trailer on a vehicle.
 * @param {!Car} c
 * @param {string} kind
 * @return {!Car}
 */
function hitch(c, kind) {
  c.tr = {kind, a: c.a, type: TRAILERS[kind]};
  return c;
}

// ---------- effects

/**
 * Emits one particle.
 * @param {number} x
 * @param {number} y
 * @param {string} kind
 */
function puff(x, y, kind) {
  if (state.parts.length > 400) {
    return;
  }
  const a = rand(0, TAU);
  const sp =
    kind === 'spark'
      ? rand(4, 12)
      : kind === 'blood' || kind === 'water'
        ? rand(1, 6)
        : rand(0.2, 1.5);
  state.parts.push({
    x,
    y,
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp,
    kind,
    life: 0,
    max: {spark: 0.3, smoke: 1.4, blood: 0.35, fire: 0.5, water: 0.6}[kind],
  });
}
/**
 * Leaves a stain on the ground.
 * @param {number} x
 * @param {number} y
 * @param {string} kind
 */
function decal(x, y, kind) {
  for (let i = 0; i < 3; i++) {
    state.decals.push({
      x: x + rand(-0.8, 0.8),
      y: y + rand(-0.8, 0.8),
      r: kind === 'blood' ? rand(0.4, 1) : rand(1.5, 2.6),
      kind,
    });
  }
  if (state.decals.length > 120) {
    state.decals.splice(0, 3);
  }
}
const float = (o, s, col = '#ffd23e') =>
  state.texts.push({x: o.x, y: o.y, s, life: 1.5, col});
/**
 * Shows an element and restarts its CSS animation.
 * @param {!Element} el
 */
function replay(el) {
  el.hidden = false;
  el.style.animation = 'none';
  el.offsetWidth;
  el.style.animation = '';
}
/**
 * Big letters across the screen.
 * @param {string} big
 * @param {string=} small
 */
function flash(big, small = '') {
  const el = byId('flash');
  el.firstElementChild.textContent = big;
  el.lastElementChild.textContent = small;
  replay(el);
}
/**
 * The small line at the bottom: car names, radio stations.
 * @param {string} text
 */
function info(text) {
  byId('info').textContent = text;
  replay(byId('info'));
}

// ---------- cars

/**
 * Pushes a car out of something it hit.
 * @param {!Car} c
 * @param {!Array<number>} h [nx, ny, depth].
 * @param {number} off Where along the car it was hit.
 * @return {number} The impact speed.
 */
function bounce(c, h, off) {
  c.x += h[0] * h[2];
  c.y += h[1] * h[2];
  const vn = c.vx * h[0] + c.vy * h[1];
  if (vn >= 0) {
    return 0;
  }
  c.vx -= 1.3 * vn * h[0];
  c.vy -= 1.3 * vn * h[1];
  c.spin += off * (Math.cos(c.a) * h[1] - Math.sin(c.a) * h[0]) * -vn * 0.1;
  return -vn;
}

/**
 * Dents a car; enough of it sets the car on fire.
 * @param {!Car} c
 * @param {number} imp Impact speed.
 */
function damage(c, imp) {
  if (imp < 5 || c.dead) {
    return;
  }
  if (dist(c, state.player) < 80 && state.t - state.crashT > 0.08) {
    state.crashT = state.t;
    audio.play('crash', imp);
    for (let i = 0; i < 6; i++) {
      puff(c.x, c.y, 'spark');
    }
  }
  c.hp -= ((imp - 5) * 0.55) / c.type.mass;
  if (c.ai) {
    c.ai.rage = 5;
  }
  const j = state.job;
  if (j && j.fragile && c === state.player.car) {
    // the load does not like this
    j.cargo -= (imp - 5) * 0.012;
    float(c, pick(['KLIRR!', 'SCHEPPER!', 'AUWEH!']), '#ff5a1f');
    audio.play('glass');
  }
  if (c.hp <= 0 && !c.burn) {
    c.burn = 4.5;
    bail(c);
    if (c === state.player.car) {
      flash('Raus hier!', 'Die Karre brennt');
    }
  }
}

/**
 * The driver jumps out and runs for it.
 * @param {!Car} c
 */
function bail(c) {
  if (!c.ai) {
    return;
  }
  c.ai = null;
  c.thr = c.steer = 0;
  c.hb = false;
  const n = nearNode(c, 'walk');
  const p = spawnPed(
    c.x + Math.sin(c.a) * 2,
    c.y - Math.cos(c.a) * 2,
    n,
    pick(NODES[n].walk)
  );
  p.flee = 4;
  p.a = c.a - Math.PI / 2 + rand(-0.6, 0.6);
}

/**
 * Blows a car up, with everything standing next to it.
 * @param {!Car} c
 */
function explode(c) {
  c.burn = 0;
  c.dead = true;
  c.hp = 0;
  c.spr = carSprite(c.kind, 'wreck');
  bail(c);
  state.parts.push({
    x: c.x,
    y: c.y,
    vx: 0,
    vy: 0,
    kind: 'boom',
    life: 0,
    max: 0.45,
  });
  for (let i = 0; i < 26; i++) {
    puff(c.x + rand(-2, 2), c.y + rand(-2, 2), i % 2 ? 'fire' : 'smoke');
  }
  decal(c.x, c.y, 'scorch');
  const player = state.player;
  const far = dist(c, player);
  if (far < 150) {
    audio.play('boom');
    state.shake = Math.max(state.shake, clamp(1.2 - far / 60, 0, 1));
  }
  state.stats.wrecks++;
  for (const o of state.cars) {
    const d = dist(o, c);
    if (o === c || o.dead || d > 9) {
      continue;
    }
    o.vx += ((o.x - c.x) / (d || 1)) * 7;
    o.vy += ((o.y - c.y) / (d || 1)) * 7;
    o.hp -= 60;
    if (o.hp <= 0 && !o.burn) {
      o.burn = rand(0.6, 1.6);
      bail(o);
    }
  }
  for (const p of state.peds) {
    if (dist(p, c) < 8) {
      killPed(p);
    }
  }
  if (player.car === c || (!player.car && far < 7)) {
    waste();
  }
}

/**
 * Cars cannot swim.
 * @param {!Car} c
 */
function sink(c) {
  for (let i = 0; i < 30; i++) {
    puff(c.x + rand(-2, 2), c.y + rand(-2, 2), 'water');
  }
  if (dist(c, state.player) < 150) {
    audio.play('splash');
  }
  c.dead = c.gone = true;
  c.ai = null;
  if (state.player.car === c) {
    waste('Abgesoffen!');
  }
}

/**
 * Moves one vehicle: engine, steering, grip, walls, trees and street furniture.
 * @param {!Car} c
 * @param {number} dt
 */
function stepCar(c, dt) {
  const type = c.type;
  if (c.burn > 0) {
    c.thr = 0;
    if (Math.random() < dt * 40) {
      puff(c.x + rand(-1, 1), c.y + rand(-1, 1), 'fire');
    }
    if ((c.burn -= dt) <= 0) {
      explode(c);
    }
  } else if (
    !c.dead &&
    c.hp < type.hp * 0.5 &&
    Math.random() < dt * (c.hp < type.hp * 0.25 ? 16 : 6)
  ) {
    puff(
      c.x + Math.cos(c.a) * type.length * 0.35,
      c.y + Math.sin(c.a) * type.length * 0.35,
      'smoke'
    );
  }
  if (c.dead) {
    c.thr = c.steer = 0;
  }
  c.a += c.spin * dt;
  c.spin *= Math.exp(-3 * dt);
  const ground = surfAt(c.x, c.y);
  const road = ground & 1 || c.ai;
  if ((ground & 9) === 8 && !c.dead) {
    sink(c);
    return;
  }
  let fx = Math.cos(c.a);
  let fy = Math.sin(c.a);
  let vf = c.vx * fx + c.vy * fy;
  c.a +=
    ((c.steer * (c.hb ? 3.5 : 2.8)) / (1 + Math.abs(vf) / 26)) *
    clamp(vf / 5, -1, 1) *
    dt;
  fx = Math.cos(c.a);
  fy = Math.sin(c.a);
  vf = c.vx * fx + c.vy * fy;
  let vl = c.vy * fx - c.vx * fy; // sideways slip
  const max = type.max * (road ? 1 : 0.7);
  if (c.thr > 0 && vf < max) {
    vf += type.acc * (vf < 0 ? 2.5 : 1 - (vf / max) ** 2) * c.thr * dt;
  } // punchy launch, tapering to top speed
  if (c.thr < 0 && vf > -max * 0.35) {
    vf += (vf > 0 ? 30 : type.acc * 0.7) * c.thr * dt;
  }
  const drag =
    (c.thr ? 0 : 4) +
    (c.hb ? 12 : 0) +
    (Math.abs(vf) > max ? 6 : 0) +
    (c.dead ? 8 : 0);
  vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
  vl *= Math.exp(-(c.hb ? 1.6 : road ? 8 : 4.5) * dt);
  if (!c.thr && Math.abs(vf) < 0.05 && Math.abs(vl) < 0.05) {
    vf = vl = 0;
    if (Math.abs(c.spin) < 0.02) {
      c.spin = 0;
    }
  }
  c.vx = fx * vf - fy * vl;
  c.vy = fy * vf + fx * vl;
  c.vf = vf;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  if (c.tr) {
    c.tr.a =
      c.a -
      clamp(
        wrap(
          c.a - c.tr.a - (vf / c.tr.type.length) * Math.sin(c.a - c.tr.a) * dt
        ),
        -1.3,
        1.3
      );
  } // the trailer swings in behind
  for (const off of type.offs) {
    // walls and tree trunks
    const px = c.x + fx * off;
    const py = c.y + fy * off;
    if (surfAt(px, py) & 2) {
      continue;
    }
    for (const b of at(buildingGrid, px, py)) {
      if (
        px < b.x0 - type.r ||
        px > b.x1 + type.r ||
        py < b.y0 - type.r ||
        py > b.y1 + type.r
      ) {
        continue;
      }
      const h = pushOut(c.x + fx * off, c.y + fy * off, type.r, b.p);
      if (h) {
        damage(c, bounce(c, h, off));
      }
    }
    for (const t of at(treeGrid, px, py)) {
      const dx = c.x + fx * off - t.x;
      const dy = c.y + fy * off - t.y;
      const d = Math.hypot(dx, dy);
      if (d && d < type.r + 0.4) {
        damage(c, bounce(c, [dx / d, dy / d, type.r + 0.4 - d], off));
      }
    }
    for (const p of at(propGrid, px, py)) {
      if (
        !p.down &&
        Math.hypot(c.x + fx * off - p.x, c.y + fy * off - p.y) < type.r + 0.2
      ) {
        knock(p, c);
      }
    }
  }
}

/** Vehicle against vehicle. */
function collideCars() {
  const cs = state.cars;
  const player = state.player;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i];
      const b = cs[j];
      if (Math.abs(a.x - b.x) > 12 || Math.abs(a.y - b.y) > 12) {
        continue;
      }
      const ma = a.type.mass * (a.dead ? 2 : 1);
      const mb = b.type.mass * (b.dead ? 2 : 1);
      const min = a.type.r + b.type.r;
      for (const oa of a.type.offs) {
        for (const ob of b.type.offs) {
          const dx = b.x + Math.cos(b.a) * ob - a.x - Math.cos(a.a) * oa;
          const dy = b.y + Math.sin(b.a) * ob - a.y - Math.sin(a.a) * oa;
          const d = Math.hypot(dx, dy);
          if (!d || d >= min) {
            continue;
          }
          const nx = dx / d;
          const ny = dy / d;
          const pen = min - d;
          a.x -= (nx * pen * mb) / (ma + mb);
          a.y -= (ny * pen * mb) / (ma + mb);
          b.x += (nx * pen * ma) / (ma + mb);
          b.y += (ny * pen * ma) / (ma + mb);
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv >= 0) {
            continue;
          }
          const impulse = (-1.3 * rv) / (1 / ma + 1 / mb);
          a.vx -= (impulse / ma) * nx;
          a.vy -= (impulse / ma) * ny;
          b.vx += (impulse / mb) * nx;
          b.vy += (impulse / mb) * ny;
          a.spin -=
            ((oa * (Math.cos(a.a) * ny - Math.sin(a.a) * nx) * impulse) / ma) *
            0.1;
          b.spin +=
            ((ob * (Math.cos(b.a) * ny - Math.sin(b.a) * nx) * impulse) / mb) *
            0.1;
          damage(a, ((-rv * mb) / (ma + mb)) * 1.6);
          damage(b, ((-rv * ma) / (ma + mb)) * 1.6);
          const other = a === player.car ? b : b === player.car ? a : null;
          if (other && -rv > 7) {
            if (other.ai && other.ai.cop) {
              crime(0.4);
            } // ramming the police
            if (state.job && other === state.job.prey) {
              other.hits = (other.hits || 0) + 1;
              float(other, 'RUMMS!', '#ff5a1f');
            }
          }
        }
      }
    }
  }
}

// ---------- traffic, police and pedestrians

/**
 * Where an AI car turns next; wide roads and gentle turns are more likely.
 * @param {number} from
 * @param {number} to
 * @param {!Object} ai
 * @return {number} The junction index, or -1 when the road leaves the map.
 */
function nextNode(from, to, ai) {
  const a = NODES[from];
  const b = NODES[to];
  if (ai.cop && state.copF) {
    const n = downhill(state.copF, to);
    if (n >= 0) {
      return n;
    }
  }
  let opts = b.car.filter(e => e.n !== from);
  if (ai.flee) {
    // the getaway driver stays in the village
    const stay = opts.filter(e => {
      const n = NODES[e.n];
      return n.x > 40 && n.y > 40 && n.x < WORLD_W - 40 && n.y < WORLD_H - 40;
    });
    opts = stay.length ? stay : b.car.filter(e => e.n === from);
  }
  if (!opts.length) {
    return -1;
  }
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  let total = 0;
  for (const e of opts) {
    const c = NODES[e.n];
    total += e.k =
      e.w * e.w * (1.3 + Math.cos(Math.atan2(c.y - b.y, c.x - b.x) - dir));
  }
  let r = Math.random() * total;
  return (opts.find(e => (r -= e.k) < 0) || opts[0]).n;
}

/**
 * Steers a computer-driven car: traffic, police and getaway drivers.
 * @param {!Car} c
 * @param {number} dt
 */
function driveAI(c, dt) {
  const ai = c.ai;
  const a = NODES[ai.from];
  const b = NODES[ai.to];
  const player = state.player;
  const hunt = ai.cop && state.wanted >= 1 && !state.wasted;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const along = (c.x - a.x) * dx + (c.y - a.y) * dy;
  const lane = Math.min(a.w, b.w) / 4; // drive on the right
  if (along > len - 2) {
    const n = nextNode(ai.from, ai.to, ai);
    if (n < 0) {
      c.gone = true;
    } // left the map
    else {
      ai.from = ai.to;
      ai.to = n;
    }
    return;
  }
  const s = Math.min(len, along + 5 + c.vf * 0.4);
  const near = hunt && dist(c, player) < 45;
  let tx = a.x + dx * s - dy * lane;
  let ty = a.y + dy * s + dx * lane;
  if (near) {
    tx = player.x + (player.car ? player.car.vx * 0.4 : 0);
    ty = player.y + (player.car ? player.car.vy * 0.4 : 0);
  } // close enough: go straight for the player
  const err = wrap(Math.atan2(ty - c.y, tx - c.x) - c.a);
  const fast = hunt || ai.flee || ai.rage > 0;
  const want =
    (2 + Math.min(a.w, b.w) * 1.6) *
    (hunt || ai.flee ? 2 : ai.rage > 0 ? 1.6 : 1) *
    (1 - 0.7 * Math.min(1, Math.abs(err)));
  const fx = Math.cos(c.a);
  const fy = Math.sin(c.a);
  const reach = 5 + c.vf * 0.9;
  const ahead = o => {
    const rx = o.x - c.x;
    const ry = o.y - c.y;
    const f = rx * fx + ry * fy;
    return f > 0 && f < reach && Math.abs(ry * fx - rx * fy) < 1.7;
  };
  const block =
    !fast &&
    !(ai.push > 0) &&
    (state.cars.some(o => o !== c && ahead(o)) ||
      state.peds.some(ahead) ||
      (state.mode === 'play' && !player.car && ahead(player)));
  ai.wait = block ? ai.wait + dt : 0;
  if (ai.wait > 5) {
    ai.push = 2;
  } // tired of waiting: shove through
  ai.push -= dt;
  ai.rage -= dt;
  c.thr = block
    ? c.vf > 0.3
      ? -1
      : 0
    : c.vf < want
      ? fast
        ? 1
        : 0.7
      : c.vf > want + 2
        ? -0.4
        : 0;
  c.hb = block && c.vf < 1;
  c.steer = clamp(err * 2.2, -1, 1);
  if (
    near &&
    dist(c, player) < 9 &&
    (player.car ? Math.abs(player.car.vf) : 0) < 4
  ) {
    c.thr = c.vf > 1 ? -1 : 0;
    c.hb = true;
  } // box the player in
  if (!block && !c.hb && Math.abs(c.vf) < 0.5) {
    ai.stuck += dt;
  } else if (c.vf > 1.5) {
    ai.stuck = 0;
  }
  if (ai.stuck > 1.5) {
    ai.stuck = 0;
    ai.rev = 1.3;
    ai.jams++;
  } // nose against something: back up
  if (ai.rev > 0) {
    ai.rev -= dt;
    c.thr = -1;
    c.steer = -c.steer;
  }
}
const newAI = (from, to, more) =>
  Object.assign(
    {from, to, wait: 0, push: 0, rage: 0, stuck: 0, rev: 0, jams: 0},
    more
  );

/**
 * Raises the wanted level.
 * @param {number} heat
 */
function crime(heat) {
  state.wanted = Math.min(4, state.wanted + heat);
  state.seen = 8;
}

/**
 * Runs the wanted level, the patrol cars and arrests.
 * @param {number} dt
 */
function police(dt) {
  const player = state.player;
  const cops = state.cars.filter(c => c.ai && c.ai.cop && !c.dead);
  const close = cops.reduce((m, c) => Math.min(m, dist(c, player)), 1e9);
  if (state.wanted > 0) {
    state.seen -= dt;
    state.wanted = Math.max(
      0,
      state.wanted - dt * (close < 90 ? 0.012 : state.seen > 0 ? 0.04 : 0.14)
    ); // heat cools off once nobody is looking
  }
  if (state.wanted < 1) {
    for (const c of cops) {
      c.ai.cop = false;
      c.siren = false;
    }
  } // off duty: back to normal traffic
  audio.siren(
    state.wanted >= 1 && close < 170 && state.mode === 'play' && !state.paused
  );
  if (state.wanted < 1 || state.mode !== 'play') {
    state.bust = 0;
    return;
  }
  if ((state.copT -= dt) <= 0) {
    state.copT = 1;
    state.copF = field(player);
  }
  if (
    cops.length < Math.min(3, Math.floor(state.wanted)) &&
    Math.random() < dt * 1.2
  ) {
    const spots = NODES.filter(n => {
      const d = dist(n, player);
      return (
        d > 110 &&
        d < 230 &&
        n.gps.length &&
        n.x > 0 &&
        n.y > 0 &&
        n.x < WORLD_W &&
        n.y < WORLD_H
      );
    });
    const a = pick(spots);
    if (a) {
      const i = NODES.indexOf(a);
      const to = downhill(state.copF, i);
      if (to >= 0) {
        const c = makeCar(
          a.x,
          a.y,
          Math.atan2(NODES[to].y - a.y, NODES[to].x - a.x),
          'police'
        );
        c.ai = newAI(i, to, {cop: true});
        c.siren = true;
      }
    }
  }
  // caught: a patrol car right next to you while you are slow
  const slow = (player.car ? Math.hypot(player.car.vx, player.car.vy) : 0) < 3;
  state.bust =
    close < (player.car ? 7 : 5) && slow && !state.wasted
      ? state.bust + dt
      : Math.max(0, state.bust - dt * 2);
  if (state.bust > 1.6) {
    busted();
  }
}

/** The police got you: a fine, and back to the town hall on foot. */
function busted() {
  const player = state.player;
  const fine = Math.round((state.money * 0.1) / 5) * 5;
  const r = SPOT.townhall;
  state.stats.busted++;
  state.money -= fine;
  state.wanted = 0;
  state.bust = 0;
  if (player.car) {
    Object.assign(player.car, {thr: 0, steer: 0});
    player.car = null;
    audio.radio(-1);
  }
  flash(
    'Erwischt!',
    fine ? `Strafzettel: ${fmt(fine)}` : 'Nochmal Glück gehabt'
  );
  audio.play('fail');
  if (state.job) {
    failJob('busted');
  }
  for (const c of state.cars) {
    if (c.ai && c.ai.cop) {
      c.gone = true;
    }
  }
  Object.assign(player, {x: r.x, y: r.y, a: r.a});
  page(pick(TALK.busted));
}

const SHIRTS = [
  '#d9d4c8',
  '#b3372f',
  '#2f5fa8',
  '#3c8a4a',
  '#d8a31c',
  '#7a4a9a',
  '#22252b',
  '#d86a2a',
  '#e58fb0',
];
const HAIR = ['#2a1d12', '#4a3018', '#8a6a3a', '#c8c2b4', '#15151a', '#a8452a'];

/**
 * Puts a pedestrian on the pavement between two junctions.
 * @param {number} x
 * @param {number} y
 * @param {number} from
 * @param {number} to
 * @return {!Ped}
 */
function spawnPed(x, y, from, to) {
  const p = {
    x,
    y,
    a: rand(0, TAU),
    from,
    to,
    side: pick([-1, 1]),
    sp: rand(1.1, 1.7),
    t: rand(0, 9),
    flee: 0,
    alert: Math.random() < 0.6,
    shirt: pick(SHIRTS),
    hair: pick(HAIR),
    dead: false,
  };
  state.peds.push(p);
  return p;
}

/**
 * Walks one pedestrian along the road.
 * @param {!Ped} p
 * @param {number} dt
 */
function stepPed(p, dt) {
  let sp = p.sp;
  if (p.flee > 0) {
    p.flee -= dt;
    sp = 5;
  } else {
    const a = NODES[p.from];
    const b = NODES[p.to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = (b.w / 2 + 1) * p.side; // walk beside the road
    const tx = b.x - (dy / len) * off;
    const ty = b.y + (dx / len) * off;
    if (Math.hypot(tx - p.x, ty - p.y) < 0.9) {
      const opts = b.walk.filter(n => n !== p.from);
      // Dead end: turn around
      [p.from, p.to] = [p.to, opts.length ? pick(opts) : p.from];
    } else {
      p.a += clamp(wrap(Math.atan2(ty - p.y, tx - p.x) - p.a), -6 * dt, 6 * dt);
    }
  }
  p.x += Math.cos(p.a) * sp * dt;
  p.y += Math.sin(p.a) * sp * dt;
  p.t += sp * dt;
  shove(p, 0.35);
}

/**
 * Runs a pedestrian over.
 * @param {!Ped} p
 * @param {boolean=} byPlayer
 */
function killPed(p, byPlayer) {
  if (p.dead) {
    return;
  }
  p.dead = true;
  decal(p.x, p.y, 'blood');
  for (let i = 0; i < 10; i++) {
    puff(p.x, p.y, 'blood');
  }
  if (dist(p, state.player) < 80) {
    audio.play('splat');
  }
  if (byPlayer) {
    state.stats.peds++;
    float(p, 'BATSCH!', '#ff5a1f');
    crime(0.6);
  }
}

/**
 * Whether a walker is under a car.
 * @param {!Point} o
 * @param {!Car} c
 * @param {number} r
 * @return {boolean}
 */
function touching(o, c, r) {
  for (const off of c.type.offs) {
    if (
      Math.hypot(
        o.x - c.x - Math.cos(c.a) * off,
        o.y - c.y - Math.sin(c.a) * off
      ) <
      c.type.r + r
    ) {
      return true;
    }
  }
  return false;
}

/** Pedestrians and the player on foot against cars. */
function walkersVsCars() {
  const player = state.player;
  for (const c of state.cars) {
    const sp = Math.hypot(c.vx, c.vy);
    for (const p of state.peds) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
        continue;
      }
      // Which side of the car's path the walker is on
      const side = dx * c.vy - dy * c.vx;
      if (
        sp > 5 &&
        p.alert &&
        p.flee <= 0 &&
        dx * c.vx + dy * c.vy > 0 &&
        Math.abs(side) / sp < 3
      ) {
        p.flee = 1;
        // Jump out of the way
        p.a = Math.atan2(c.vy, c.vx) + ((side > 0 ? -1 : 1) * Math.PI) / 2;
        if (c === player.car && Math.random() < 0.5) {
          audio.play('scream');
        }
      }
      if (!touching(p, c, 0.35)) {
        continue;
      }
      if (sp > 3) {
        killPed(p, c === player.car);
        c.vx *= 0.96;
        c.vy *= 0.96;
      } else {
        const d = Math.hypot(dx, dy) || 1;
        p.x += (dx / d) * 0.2;
        p.y += (dy / d) * 0.2;
      }
    }
    if (
      state.mode === 'play' &&
      !player.car &&
      !state.wasted &&
      touching(player, c, 0.35)
    ) {
      if (sp > 4) {
        waste();
      } else {
        const d = dist(player, c) || 1;
        player.x += ((player.x - c.x) / d) * 0.2;
        player.y += ((player.y - c.y) / d) * 0.2;
      }
    }
  }
}

/**
 * Keeps the streets around the player busy.
 * @param {number} dt
 * @param {number} near How close things may appear.
 */
function populate(dt, near) {
  const player = state.player;
  const f = state.mode === 'play' ? player : state.cam;
  const j = state.job;
  const keep = c => c === player.car || (j && (c === j.veh || c === j.prey));
  state.cars = state.cars.filter(
    c =>
      (keep(c) && !c.gone) ||
      !(
        c.gone ||
        ((c.ai || c.dead) && dist(c, f) > 300) ||
        (c.ai && c.ai.jams > 4 && dist(c, f) > 110)
      )
  );
  state.peds = state.peds.filter(p => !p.dead && dist(p, f) < 230);
  if ((state.spawnT -= dt) > 0) {
    return;
  }
  state.spawnT = 0.3;
  const spots = NODES.filter(n => {
    const d = dist(n, f);
    return d > near && d < 250;
  });
  if (state.cars.filter(c => c.ai).length < 13) {
    const a = pick(spots.filter(n => n.car.length));
    if (a && !state.cars.some(c => dist(c, a) < 14)) {
      const to = pick(a.car).n;
      const b = NODES[to];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const r = Math.random();
      const c = makeCar(
        a.x - (Math.sin(ang) * a.w) / 4,
        a.y + (Math.cos(ang) * a.w) / 4,
        ang,
        r < 0.6
          ? 'car'
          : r < 0.78
            ? 'van'
            : r < 0.86
              ? 'sport'
              : r < 0.93
                ? 'tractor'
                : r < 0.97
                  ? 'truck'
                  : 'tipper'
      );
      c.ai = newAI(NODES.indexOf(a), to);
      if (c.kind === 'tractor' && Math.random() < 0.5) {
        hitch(c, 'grain');
      }
    }
  }
  if (state.peds.length < 24) {
    const a = pick(spots.filter(n => n.walk.length));
    if (a) {
      spawnPed(
        a.x + rand(-2, 2),
        a.y + rand(-2, 2),
        NODES.indexOf(a),
        pick(a.walk)
      );
    }
  }
}

/** Fills the car parks in tidy rows and lines the kerbs. */
function parkCars() {
  const r = rng(11);
  for (const a of AREAS) {
    if (a.k === 'park') {
      const ca = Math.cos(a.ang);
      const sa = Math.sin(a.ang);
      const radius = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2;
      for (let u = -radius; u < radius; u += 2.8) {
        for (let v = -radius; v < radius; v += 5.8) {
          const x = a.mx + ca * u - sa * v;
          const y = a.my + sa * u + ca * v;
          const ex = -sa * 2.7;
          const ey = ca * 2.7;
          const take = r() < 0.42;
          const flip = r() < 0.5;
          const kind = r();
          const free = (px, py) => pip(px, py, a.p) && !(surfAt(px, py) & 4);
          if (
            !take ||
            !free(x, y) ||
            !free(x + ex, y + ey) ||
            !free(x - ex, y - ey)
          ) {
            continue;
          }
          if (blocked(x, y, 3)) {
            continue;
          }
          makeCar(
            x,
            y,
            a.ang + Math.PI / 2 + (flip ? Math.PI : 0),
            kind < 0.8 ? 'car' : kind < 0.93 ? 'van' : 'sport',
            COLORS[(r() * COLORS.length) | 0]
          );
        }
      }
    }
  }
  for (let i = 0; i < 46; i++) {
    // and a few along the kerb in the village
    const s = SEGS[(r() * SEGS.length) | 0];
    const t = r();
    const kind = r();
    const flip = r() < 0.5;
    const col = COLORS[(r() * COLORS.length) | 0];
    if (!town(s[6]) || s[5] < 14) {
      continue;
    }
    const off = s[4] / 2 + 0.2;
    const x = lerp(s[0], s[2], t) - ((s[3] - s[1]) / s[5]) * off;
    const y = lerp(s[1], s[3], t) + ((s[2] - s[0]) / s[5]) * off;
    if (
      blocked(x, y, 2.6) ||
      state.cars.some(c => Math.hypot(c.x - x, c.y - y) < 7) ||
      NODES.some(n => n.car.length > 2 && Math.hypot(n.x - x, n.y - y) < 12)
    ) {
      continue;
    }
    makeCar(
      x,
      y,
      Math.atan2(s[3] - s[1], s[2] - s[0]) + (flip ? Math.PI : 0),
      kind < 0.85 ? 'car' : kind < 0.95 ? 'van' : 'sport',
      col
    );
  }
}

// ---------- money on the street

/**
 * A random spot on a road, uniform by length.
 * @param {function(number, number):} ok boolean
 * @return {({x: number, y: number}|undefined)}
 */
function roadPoint(ok) {
  for (let n = 0; n < 600; n++) {
    const s = pick(SEGS);
    if (Math.random() * SEG_MAX > s[5]) {
      continue;
    }
    const t = Math.random();
    const o = rand(-0.3, 0.3) * s[4];
    const x = lerp(s[0], s[2], t) - ((s[3] - s[1]) / s[5]) * o;
    const y = lerp(s[1], s[3], t) + ((s[2] - s[0]) / s[5]) * o;
    if (
      x > 15 &&
      y > 15 &&
      x < WORLD_W - 15 &&
      y < WORLD_H - 15 &&
      !(surfAt(x, y) & 10) &&
      ok(x, y)
    ) {
      return {x, y};
    }
  }
}
/** Leaves a banknote somewhere on a road. */
function dropCash() {
  const spot = roadPoint(
    (x, y) =>
      Math.hypot(x - state.player.x, y - state.player.y) > 30 &&
      !state.items.some(v => Math.hypot(v.x - x, v.y - y) < 20)
  );
  if (spot) {
    state.items.push({
      ...spot,
      kind: 'cash',
      val: pick([5, 10, 10, 20, 20, 50, 100]),
      ph: rand(0, TAU),
    });
  }
}
/**
 * Picks something up.
 * @param {!Object} v
 */
function grab(v) {
  audio.play('coin');
  if (v.kind === 'cash') {
    state.money += v.val;
    float(v, `+${fmt(v.val)}`);
    dropCash();
    return;
  }
  const j = state.job;
  const left = state.items.filter(o => o.job).length;
  float(v, left ? `noch ${left}` : 'Alles da!');
  if (j) {
    j.got++;
  }
}

// ---------- the pager and Flo's jobs

/**
 * Flo is calling: queues his messages for the pager.
 * @param {...string} msgs
 */
function page(...msgs) {
  const pg = state.pager;
  if (!pg.q.length && !pg.cur) {
    replay(byId('pager').firstElementChild);
    byId('pager').classList.add('ring');
    audio.play('pager');
  }
  pg.q.push(...msgs);
}

/**
 * Parks a mission vehicle at a place.
 * @param {string} kind
 * @param {string} key
 * @param {string=} trailer
 * @return {!Car}
 */
function spawnAt(kind, key, trailer) {
  const s = SPOT[key];
  // Make room
  state.cars = state.cars.filter(c => c === state.player.car || dist(c, s) > 9);
  const c = makeCar(s.x, s.y, s.a, kind);
  if (trailer) {
    hitch(c, trailer);
  }
  return c;
}

/** Starts the next mission. */
function startJob() {
  const m = MISSIONS[state.jobN];
  state.job = {
    m,
    i: -1,
    step: null,
    veh: null,
    prey: null,
    to: null,
    left: 0,
    timed: false,
    cargo: 1,
    fragile: false,
    hold: 0,
    got: 0,
    need: 0,
  };
  state.items = state.items.filter(v => !v.job);
  flash(m.title, `Auftrag ${state.jobN + 1} von ${MISSIONS.length}`);
  page(...m.intro);
  nextStep();
}

/** Moves the mission on to its next step, or ends it. */
function nextStep() {
  const j = state.job;
  const done = j.step;
  const st = j.m.steps[++j.i];
  if (done && done.tip && j.timed) {
    // quick delivery, generous customer
    const tip = Math.round(j.left) * 2;
    state.money += tip;
    float(state.player, `Trinkgeld +${fmt(tip)}`);
    audio.play('coin');
  }
  if (!st) {
    endJob();
    return;
  }
  if (j.i) {
    audio.play('step');
  }
  j.step = st;
  j.hold = 0;
  j.told = false;
  j.to = st.to ? SPOT[st.to] : null;
  if (st.time) {
    j.left = st.time;
    j.timed = true;
  } else if (st.time === 0) {
    j.timed = false;
  }
  if (st.fragile != null) {
    j.fragile = st.fragile;
    j.cargo = 1;
  }
  if (st.drop) {
    j.veh = null;
  }
  if (st.wanted) {
    crime(st.wanted);
    audio.play('alarm');
  }
  if (st.say) {
    page(st.say);
  }
  state.pager.idle = st.obj;
  if (st.do === 'steal') {
    j.veh = spawnAt(st.veh, st.at, st.trailer);
    j.to = j.veh;
  }
  if (st.do === 'chase') {
    const s = SPOT[st.at];
    const from = nearNode(s, 'car');
    const to = NODES[from].car[0].n;
    j.prey = makeCar(
      NODES[from].x,
      NODES[from].y,
      Math.atan2(NODES[to].y - NODES[from].y, NODES[to].x - NODES[from].x),
      st.veh
    );
    if (st.trailer) {
      hitch(j.prey, st.trailer);
    }
    j.prey.ai = newAI(from, to, {flee: true});
    j.to = j.prey;
  }
  if (st.do === 'take') {
    j.veh = j.prey;
    j.prey = null;
    j.to = j.veh;
  }
  if (st.do === 'collect') {
    const c = SPOT[st.near];
    j.got = 0;
    j.need = st.n;
    for (let i = 0; i < st.n; i++) {
      const spot =
        roadPoint(
          (x, y) =>
            Math.hypot(x - c.x, y - c.y) < st.r &&
            !state.items.some(v => Math.hypot(v.x - x, v.y - y) < 25)
        ) || c;
      state.items.push({...spot, kind: st.item, job: true, ph: rand(0, TAU)});
    }
  }
  state.gps = null;
}

/**
 * Checks whether the current step is done or the mission lost.
 * @param {number} dt
 */
function jobRules(dt) {
  const j = state.job;
  const player = state.player;
  const st = j.step;
  const sp = player.car ? Math.hypot(player.car.vx, player.car.vy) : 0;
  const lost = c => c && (c.dead || c.burn > 0 || c.gone);
  if (lost(j.veh) || lost(j.prey)) {
    failJob(j.prey && j.prey.gone ? 'gone' : 'wreck');
    return;
  }
  if (j.timed && (j.left -= dt) <= 0) {
    failJob('time');
    return;
  }
  if (j.fragile && j.cargo <= 0) {
    failJob('cargo');
    return;
  }
  const near = r => j.to && dist(player, j.to) < r;
  switch (st.do) {
    case 'steal':
    case 'take':
      if (player.car === j.veh) {
        nextStep();
      }
      break;
    case 'bring':
      if (player.car === j.veh && near(7) && sp < 8) {
        nextStep();
      }
      break;
    case 'goto':
      if (st.foot && player.car && near(14) && !j.told) {
        j.told = true;
        info('Aussteigen und zu Fuß reingehen');
      }
      if (st.foot ? !player.car && near(3.5) : near(st.r || 7) && sp < 9) {
        nextStep();
      }
      break;
    case 'hold':
      if (near(st.r || 10) && (!st.veh || player.car === j.veh)) {
        j.hold += dt;
        if (st.fx === 'water') {
          for (let i = 0; i < 3; i++) {
            puff(
              lerp(player.x, j.to.x, Math.random()),
              lerp(player.y, j.to.y, Math.random()),
              'water'
            );
          }
          if (Math.random() < dt * 5) {
            audio.play('spray');
          }
        }
        if (j.hold >= st.secs) {
          nextStep();
        }
      } else {
        j.hold = Math.max(0, j.hold - dt);
      }
      break;
    case 'collect':
      if (j.got >= j.need) {
        nextStep();
      }
      break;
    case 'lose':
      if (state.wanted < 1) {
        nextStep();
      }
      break;
    case 'chase':
      if ((j.prey.hits || 0) >= st.hits || j.prey.hp < j.prey.type.hp * 0.35) {
        bail(j.prey);
        Object.assign(j.prey, {thr: 0, hb: true});
        nextStep();
      }
      break;
    default:
      throw new Error(`unknown step: ${st.do}`);
  }
}

/** Mission accomplished. */
function endJob() {
  const j = state.job;
  const m = j.m;
  state.job = null;
  state.jobN++;
  state.nextJob = 8;
  state.money += m.reward;
  state.stats.missions++;
  state.pager.idle = '';
  state.items = state.items.filter(v => !v.job);
  flash('Mission erfüllt!', `+${fmt(m.reward)}`);
  audio.play('win');
  store();
  if (state.jobN >= MISSIONS.length) {
    page(...m.outro);
    state.nextJob = 1e9;
    state.finale = 9;
    return;
  }
  page(...m.outro);
}

/**
 * Mission failed.
 * @param {string} why
 */
function failJob(why) {
  const j = state.job;
  state.job = null;
  state.nextJob = 10;
  state.pager.idle = '';
  state.items = state.items.filter(v => !v.job);
  if (j.prey) {
    j.prey.ai = newAI(
      j.prey.ai ? j.prey.ai.from : 0,
      j.prey.ai ? j.prey.ai.to : 0
    );
    j.prey.gone = !j.prey.ai.to;
  }
  flash(
    'Mission gescheitert!',
    {
      time: 'Zeit abgelaufen',
      wreck: 'Fahrzeug Schrott',
      cargo: 'Ladung kaputt',
      gone: 'Entkommen',
      busted: '',
      wasted: '',
    }[why]
  );
  audio.play('fail');
  if (why !== 'busted') {
    page(pick(TALK.scold));
  }
}

/**
 * Pickups, missions and the grand finale.
 * @param {number} dt
 */
function playRules(dt) {
  const player = state.player;
  // Long lorries scoop things up with the whole bumper
  const reach = player.car ? player.car.type.length / 2 + 1 : 1.7;
  if (state.wasted) {
    return;
  }
  const got = state.items.filter(
    v => Math.hypot(v.x - player.x, v.y - player.y) < reach
  );
  if (got.length) {
    state.items = state.items.filter(v => !got.includes(v));
    got.forEach(grab);
  }
  if (player.car && state.wanted >= 1 && dist(player, SPOT.carwash) < 7) {
    wash();
  }
  if (state.job) {
    jobRules(dt);
  } else if ((state.nextJob -= dt) <= 0 && state.jobN < MISSIONS.length) {
    startJob();
  }
  if (state.finale && (state.finale -= dt) <= 0) {
    finish();
  }
}

/** The car wash at Murk: new paint, nobody recognises you. */
function wash() {
  const c = state.player.car;
  state.wanted = 0;
  state.money -= 15;
  c.col = pick(COLORS.filter(col => col !== c.col));
  c.spr = carSprite(c.kind, c.col);
  for (let i = 0; i < 40; i++) {
    puff(c.x + rand(-3, 3), c.y + rand(-3, 3), 'water');
  }
  flash('Blitzsauber!', 'Waschstraße: 14,90 €');
  audio.play('splash');
}

/** Shows the end screen. */
function finish() {
  const st = state.stats;
  const rank = RANKS.find(r => state.money >= r[0])[1];
  state.mode = 'end';
  state.finale = 0;
  if (state.player.car) {
    Object.assign(state.player.car, {thr: 0, steer: 0, hb: true});
  }
  byId('hud').hidden = true;
  byId('end').hidden = false;
  byId('total').textContent = fmt(state.money);
  byId('stats').replaceChildren(
    ...[
      `Rang: ${rank}`,
      `Aufträge für Flo: ${st.missions} · Autos geklaut: ${st.stolen}`,
      `Schrottkarren: ${st.wrecks} · Umgefahren: ${st.peds} · Erwischt: ${st.busted} · Erledigt: ${st.wasted}`,
    ].map(t => Object.assign(document.createElement('li'), {textContent: t}))
  );
  audio.play('win');
  audio.radio(1);
  audio.siren(false);
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* private mode */
  }
  byId('again').focus();
}

// ---------- player

const keys = {};
const pad = {x: 0, y: 0, brake: false, horn: false};
const axis = (neg, pos) =>
  (pos.some(k => keys[k]) ? 1 : 0) - (neg.some(k => keys[k]) ? 1 : 0);

/**
 * Keeps a walker out of buildings.
 * @param {!Point} o
 * @param {number} r
 */
function shove(o, r) {
  if (surfAt(o.x, o.y) & 2) {
    return;
  }
  for (const b of at(buildingGrid, o.x, o.y)) {
    const h = pushOut(o.x, o.y, r, b.p);
    if (h) {
      o.x += h[0] * h[2];
      o.y += h[1] * h[2];
    }
  }
}

/**
 * Turns keys and the thumb stick into driving and walking.
 * @param {number} dt
 */
function controlPlayer(dt) {
  const player = state.player;
  const c = player.car;
  const stick = Math.hypot(pad.x, pad.y);
  if (state.wasted) {
    if ((state.wasted -= dt) <= 0) {
      respawn();
    }
    return;
  }
  let thr = axis(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']);
  let steer = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
  const wet = (surfAt(player.x, player.y) & 9) === 8;
  if (c) {
    if (stick > 0.15) {
      // thumb stick: point where you want to go
      const err = wrap(Math.atan2(pad.y, pad.x) - c.a);
      steer = clamp(err * 2.2, -1, 1) * (c.vf < -1 ? -1 : 1);
      thr = Math.min(1, stick * 1.3) * (Math.abs(err) > 1.4 ? 0.55 : 1);
    }
    if (pad.brake) {
      thr = -1;
    }
    c.thr = thr;
    c.steer = steer;
    c.hb = !!keys.Space;
    c.siren =
      (c.kind === 'police' || c.kind === 'fire') && (keys.KeyH || pad.horn);
    return;
  }
  let sp = thr * (thr > 0 ? 4.5 : 2);
  if (stick > 0.15) {
    player.a = Math.atan2(pad.y, pad.x);
    sp = Math.min(1, stick * 1.3) * 4.5;
  } else {
    player.a += steer * 3.5 * dt;
  }
  if (wet) {
    sp *= 0.4;
    if (sp && Math.random() < dt * 8) {
      puff(player.x, player.y, 'water');
    }
  } // wading
  player.x += Math.cos(player.a) * sp * dt;
  player.y += Math.sin(player.a) * sp * dt;
  player.t += Math.abs(sp) * dt;
  shove(player, 0.4);
}

/** Gets into the nearest car, or out of this one. */
function toggleCar() {
  const player = state.player;
  const c = player.car;
  if (state.wasted || state.paused || state.mode !== 'play') {
    return;
  }
  if (c) {
    if (Math.hypot(c.vx, c.vy) > 5 && !c.burn) {
      return;
    } // jump out of a burning car at any speed
    const side = c.type.width / 2 + 0.8; // driver's door is on the left
    Object.assign(player, {
      x: c.x + Math.sin(c.a) * side,
      y: c.y - Math.cos(c.a) * side,
      a: c.a,
      car: null,
    });
    c.thr = c.steer = 0;
    c.hb = false;
    c.siren = false;
    audio.radio(-1);
    audio.play('door');
    return;
  }
  let best = null;
  let bd = 4.2;
  for (const o of state.cars) {
    // the nearest car; the one Flo wants counts as closer
    const d =
      dist(o, player) -
      o.type.length / 4 -
      (state.job && o === state.job.veh ? 2.5 : 0);
    if (!o.dead && !o.burn && d < bd) {
      bd = d;
      best = o;
    }
  }
  if (!best) {
    return;
  }
  if (best.ai) {
    if (best.ai.cop) {
      crime(1);
    } else if (!(state.job && best === state.job.prey)) {
      crime(0.35);
    }
    bail(best);
    state.stats.stolen++;
  }
  player.car = best;
  audio.play('door');
  audio.radio(best.radio);
  info(
    best.name + (best.radio >= 0 ? ` · ♪ ${audio.stations[best.radio]}` : '')
  );
}

/** Turns the radio dial. */
function nextStation() {
  const c = state.player.car;
  if (!c) {
    return;
  }
  c.radio = c.radio >= audio.stations.length - 1 ? -1 : c.radio + 1;
  audio.radio(c.radio);
  info(c.radio < 0 ? 'Radio aus' : `♪ ${audio.stations[c.radio]}`);
}
/** Sounds the horn; pedestrians jump. */
function honk() {
  const c = state.player.car;
  if (!c || c.kind === 'police' || c.kind === 'fire') {
    return;
  }
  audio.play('horn');
  for (const p of state.peds) {
    if (dist(p, c) < 14 && p.flee <= 0) {
      p.flee = 1.2;
      p.a = Math.atan2(p.y - c.y, p.x - c.x);
    }
  }
}

/**
 * The player dies.
 * @param {string=} title
 */
function waste(title = 'Erledigt!') {
  const player = state.player;
  if (state.wasted || state.mode !== 'play') {
    return;
  }
  const lost = Math.round((state.money * 0.1) / 5) * 5;
  state.wasted = 3.2;
  state.money -= lost;
  state.stats.wasted++;
  state.wanted = 0;
  if (player.car) {
    player.car.thr = player.car.steer = 0;
    player.car = null;
    audio.radio(-1);
  }
  flash(title, lost ? `Krankenhaus Höchstadt: ${fmt(lost)}` : '');
  audio.play('fail');
  for (let i = 0; i < 12; i++) {
    puff(player.x, player.y, 'blood');
  }
  decal(player.x, player.y, 'blood');
  if (state.job) {
    failJob('wasted');
  }
  page(pick(TALK.wasted));
}

/** Back on the road in a fresh car, at the nearest junction. */
function respawn() {
  const player = state.player;
  const best = NODES[nearNode(player, 'car')];
  const to = NODES[best.car[0].n];
  player.car = makeCar(
    best.x,
    best.y,
    Math.atan2(to.y - best.y, to.x - best.x),
    'car',
    '#e0b21c'
  );
  audio.radio(player.car.radio);
  state.wasted = 0;
}

/**
 * Follows the player and pulls up when going fast.
 * @param {number} dt
 */
function camera(dt) {
  const cam = state.cam;
  const player = state.player;
  const c = player.car;
  const tall = viewH > viewW ? 0.78 : 1;
  let tx = 1450 + Math.cos(state.t * 0.05) * 420;
  let ty = 850 + Math.sin(state.t * 0.05) * 260;
  let tz = 4.4; // title screen fly-over
  if (state.mode === 'end') {
    tx = SPOT.townhall.x + Math.cos(state.t * 0.3) * 25;
    ty = SPOT.townhall.y + Math.sin(state.t * 0.3) * 25;
    tz = 5;
  }
  if (state.mode === 'play') {
    tx = player.x + (c ? c.vx * 0.45 : 0);
    ty = player.y + (c ? c.vy * 0.45 : 0);
    tz =
      (c ? lerp(11.5, 7.5, clamp(Math.hypot(c.vx, c.vy) / 40, 0, 1)) : 13) *
      tall; // pull up when going fast
  }
  const k = 1 - Math.exp(-dt * 4);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 1.5));
  state.shake *= Math.exp(-dt * 4);
}

/**
 * Advances the whole world by one step.
 * @param {number} dt
 */
function update(dt) {
  const player = state.player;
  state.t += dt;
  if (state.mode === 'play') {
    controlPlayer(dt);
  }
  for (const c of state.cars) {
    if (c.ai) {
      driveAI(c, dt);
    } else if (c !== player.car && !c.burn && !c.vx && !c.vy && !c.spin) {
      continue;
    } // parked and at rest
    stepCar(c, dt);
  }
  collideCars();
  for (const p of state.peds) {
    stepPed(p, dt);
  }
  walkersVsCars();
  populate(dt, 85);
  police(dt);
  if (player.car) {
    player.x = player.car.x;
    player.y = player.car.y;
    player.a = player.car.a;
  }
  if (state.mode === 'play') {
    playRules(dt);
  }
  const o = player.car || player; // the map has an edge
  if (o.x < 6 || o.x > WORLD_W - 6) {
    o.x = clamp(o.x, 6, WORLD_W - 6);
    o.vx = 0;
  }
  if (o.y < 6 || o.y > WORLD_H - 6) {
    o.y = clamp(o.y, 6, WORLD_H - 6);
    o.vy = 0;
  }
  for (const sp of state.sprays) {
    // broken hydrants are fountains for a while
    sp.t -= dt;
    if (dist(sp, player) < 90) {
      for (let i = 0; i < 2; i++) {
        puff(sp.x + rand(-0.3, 0.3), sp.y + rand(-0.3, 0.3), 'water');
      }
    }
  }
  state.sprays = state.sprays.filter(sp => sp.t > 0);
  for (const p of state.parts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life += dt;
  }
  state.parts = state.parts.filter(p => p.life < p.max);
  for (const t of state.texts) {
    t.y -= 3 * dt;
    t.life -= dt;
  }
  state.texts = state.texts.filter(t => t.life > 0);
  camera(dt);
}

/**
 * Keeps the yellow arrow pointing down the road to the current target.
 * @param {number} dt
 */
function guide(dt) {
  const j = state.job;
  const player = state.player;
  const to = j && j.to;
  if (!to) {
    state.gps = null;
    return;
  }
  if (!state.gps || Math.hypot(state.gps.x - to.x, state.gps.y - to.y) > 25) {
    state.gps = {x: to.x, y: to.y, f: field(to), wp: null};
  }
  if ((state.gpsT -= dt) > 0) {
    return;
  }
  state.gpsT = 0.25;
  state.gps.wp =
    dist(player, to) < 50 ? to : waypoint(state.gps.f, player, 40) || to;
  // How far it is by road
  state.gps.far = pathLength(routeLine(state.gps.f, player, to));
}

/**
 * Refreshes money, pager, mission bar and the engine sound.
 * @param {number} dt
 */
function hud(dt) {
  const player = state.player;
  const c = player.car;
  const pg = state.pager;
  const j = state.job;
  state.shown =
    Math.abs(state.money - state.shown) < 1
      ? state.money
      : lerp(state.shown, state.money, Math.min(1, dt * 8));
  byId('money').textContent = fmt(state.shown);
  byId('heat').textContent = '★'.repeat(Math.floor(state.wanted));
  byId('heat').classList.toggle('hot', state.bust > 0.3);
  byId('dmg').hidden = !c;
  if (c) {
    const k = clamp(c.hp / c.type.hp, 0, 1);
    const bar = byId('dmg').querySelector('i');
    bar.style.width = `${k * 100}%`;
    bar.style.background = k < 0.3 ? 'var(--hot)' : '';
  }
  // the pager types out Flo's messages one after the other, then shows what to
  // do
  if (!pg.cur && pg.q.length) {
    pg.cur = pg.q.shift();
    pg.n = 0;
    pg.said = 0;
    pg.hold = 1 + pg.cur.length * 0.014;
  }
  if (pg.cur) {
    if (pg.n < pg.cur.length) {
      pg.n += dt * 46;
      const n = Math.min(pg.cur.length, pg.n | 0);
      byId('lcd').textContent = `FLO: ${pg.cur.slice(0, n)}`;
      if (n - pg.said >= 3) {
        pg.said = n;
        if (/\w/.test(pg.cur[n - 1] || '')) {
          audio.babble();
        }
      }
    } else if ((pg.hold -= dt) <= 0) {
      pg.cur = '';
      if (!pg.q.length) {
        byId('pager').classList.remove('ring');
      }
    }
  } else {
    byId('lcd').textContent = pg.idle
      ? `» ${pg.idle}`
      : state.jobN >= MISSIONS.length
        ? 'Wachenroth gehört dir.'
        : '...';
  }
  byId('mission').hidden =
    !j ||
    !(
      j.timed ||
      j.fragile ||
      j.need ||
      j.step.do === 'hold' ||
      j.step.do === 'chase'
    );
  if (j && !byId('mission').hidden) {
    const el = byId('mission');
    const secs = Math.max(0, Math.ceil(j.left));
    const st = j.step;
    const bits = [];
    if (j.timed) {
      bits.push(`${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`);
    }
    if (st.do === 'collect') {
      bits.push(`${j.got} / ${j.need}`);
    }
    if (st.do === 'chase') {
      bits.push(`Treffer ${j.prey.hits || 0} / ${st.hits}`);
    }
    if (j.fragile) {
      bits.push('Ladung');
    }
    el.firstElementChild.textContent = bits.join('  ·  ');
    const bar = j.fragile
      ? j.cargo
      : st.do === 'hold'
        ? j.hold / st.secs
        : st.do === 'collect'
          ? j.got / j.need
          : j.timed
            ? j.left / (st.time || j.left)
            : 0;
    el.lastElementChild.hidden = !(
      j.fragile ||
      st.do === 'hold' ||
      st.do === 'collect'
    );
    el.querySelector('i').style.width = `${clamp(bar, 0, 1) * 100}%`;
    el.classList.toggle('hurry', j.timed && secs <= 15);
  }
  if ((state.whereT -= dt) <= 0) {
    // where am I?
    state.whereT = 0.5;
    let name = '';
    let bd = 34;
    for (const k of Object.keys(SPOT)) {
      const d = dist(player, SPOT[k]);
      if (d < bd && PLACES[k]) {
        bd = d;
        name = PLACES[k];
      }
    }
    if (!name) {
      bd = 14;
      for (const s of SEGS) {
        if (
          s[6].n &&
          Math.abs(s[0] - player.x) < 150 &&
          Math.abs(s[1] - player.y) < 150
        ) {
          const q = nearest(player.x, player.y, s[0], s[1], s[2], s[3]);
          const d = Math.hypot(player.x - q[0], player.y - q[1]);
          if (d < bd) {
            bd = d;
            name = s[6].n;
          }
        }
      }
    }
    byId('where').textContent = name;
  }
  audio.engine(
    c ? c.vf : 0,
    c && state.mode === 'play' && !state.paused,
    c && c.kind
  );
}

/**
 * Starts a game.
 * @param {?Object=} save A saved game to continue.
 */
function start(save) {
  audio.init();
  reset('play', save);
  byId('menu').hidden = byId('end').hidden = true;
  byId('hud').hidden = false;
  byId('lcd').textContent = '';
  for (const id of ['flash', 'mission', 'pause', 'info', 'map']) {
    byId(id).hidden = true;
  }
  replay(byId('hint'));
  document.activeElement.blur();
  if (
    document.body.classList.contains('touch') &&
    document.documentElement.requestFullscreen
  ) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  audio.radio(-1);
  // Index.html?job=3 jumps straight to a job
  const pickN = +new URLSearchParams(location.search).get('job');
  if (pickN) {
    state.jobN = clamp(Math.round(pickN) - 1, 0, MISSIONS.length - 1);
  }
  page(...(save ? TALK.back : TALK.hello));
}

/**
 * Pauses or resumes.
 * @param {boolean} p
 */
function pause(p) {
  if (state.mode !== 'play' || state.map) {
    return;
  }
  state.paused = p;
  byId('pause').hidden = !p;
  audio.pause(p);
}

// ---------- input: keyboard, and a thumb stick plus buttons on touch screens

addEventListener('keydown', e => {
  if (state.mode !== 'play') {
    return;
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') {
    e.preventDefault();
  }
  if (e.code === 'Tab' && !e.repeat) {
    showMap(!state.map);
    return;
  }
  if (state.map) {
    if (e.code === 'Escape') {
      showMap(false);
    }
    return;
  }
  keys[e.code] = true;
  if (e.repeat) {
    return;
  }
  if (e.code === 'KeyF' || e.code === 'Enter') {
    toggleCar();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    pause(!state.paused);
  }
  if (e.code === 'KeyM') {
    audio.mute(!audio.isMuted());
  }
  if (e.code === 'KeyR') {
    nextStation();
  }
  if (e.code === 'KeyH') {
    honk();
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) {
    keys[k] = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    showMap(false);
    pause(true);
  }
});

{
  const stick = byId('stick');
  const knob = stick.firstElementChild;
  const radius = 52;
  let id = null;
  let ox = 0;
  let oy = 0;
  const move = e => {
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, d / radius) / (d || 1);
    pad.x = dx * k;
    pad.y = dy * k;
    knob.style.transform = `translate(${pad.x * radius}px, ${pad.y * radius}px)`;
  };
  const zone = byId('zone');
  zone.addEventListener('pointerdown', e => {
    if (id !== null) {
      return;
    }
    id = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    zone.setPointerCapture(id);
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
    stick.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId === id) {
      move(e);
    }
  });
  const up = e => {
    if (e.pointerId !== id) {
      return;
    }
    id = null;
    pad.x = pad.y = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  const hold = (el, key) => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      pad[key] = true;
      if (key === 'horn') {
        honk();
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(ev, () => {
        pad[key] = false;
      });
    }
  };
  hold(byId('bB'), 'brake');
  hold(byId('bH'), 'horn');
  byId('bA').addEventListener('pointerdown', e => {
    e.preventDefault();
    toggleCar();
  });
  byId('bR').addEventListener('pointerdown', e => {
    e.preventDefault();
    nextStation();
  });
  byId('bP').addEventListener('pointerdown', e => {
    e.preventDefault();
    pause(!state.paused);
  });
  byId('bM').addEventListener('pointerdown', e => {
    e.preventDefault();
    audio.mute(!audio.isMuted());
    byId('bM').classList.toggle('off', audio.isMuted());
  });
  byId('pause').addEventListener('pointerdown', () => pause(false));
  byId('bMap').addEventListener('pointerdown', e => {
    e.preventDefault();
    showMap(true);
  });
  byId('map').addEventListener('pointerdown', () => showMap(false));
  byId('pager').addEventListener('pointerdown', () => {
    const pg = state.pager;
    if (pg.n < pg.cur.length) {
      pg.n = pg.cur.length;
    } else {
      pg.hold = 0;
    }
  }); // tap: next message
  const touchy = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) {
    touchy();
  }
  addEventListener('touchstart', touchy, {once: true, passive: true});
  document.addEventListener('contextmenu', e => e.preventDefault());
}

byId('start').onclick = () => start();
byId('again').onclick = () => start();
byId('resume').onclick = () => start(load());
byId('how').onclick = () => {
  byId('help').hidden = !byId('help').hidden;
  byId('how').setAttribute('aria-expanded', !byId('help').hidden);
};
{
  const save = load();
  byId('resume').hidden = !(save && save.n > 0 && save.n < MISSIONS.length);
  if (save) {
    byId('resume').textContent =
      `Weiterspielen (Auftrag ${save.n + 1}/${MISSIONS.length})`;
  }
}

// ---------- rendering

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
      } // furrows run along the field
      else {
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
  }
  for (const a of AREAS) {
    if (seen(a) && a.k === 'pitch') {
      drawPitch(g, a);
    }
  }
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
  g.lineCap = 'butt';
  g.strokeStyle = textures.school;
  for (const b of NEW_HOUSES) {
    g.lineWidth = b === HOME ? 6.5 : 4.5;
    g.beginPath();
    g.moveTo(b.mx, b.my);
    g.lineTo(b.rd[0], b.rd[1]);
    g.stroke();
  }
  g.lineCap = 'round';
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
  strokeLayer(g, ROADS.road, textures.asphalt);
  strokeLayer(g, ROADS.cobble, textures.cobble);
  g.setLineDash([3, 5]);
  g.lineCap = 'butt';
  strokeLayer(g, ROADS.line, '#d8d4c0', 0.28);
  g.setLineDash([]);
  g.lineCap = 'round';
  {
    // the building site in Schulstraße: torn-up road, barriers, a heap of
    // gravel
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
  g.strokeStyle = '#2a5a22';
  g.lineWidth = 1.7;
  g.stroke(HEDGES);
  g.strokeStyle = '#3b7d2e';
  g.lineWidth = 0.9;
  g.stroke(HEDGES);
  // Garden fences: a rail with pale pickets, and a thin shadow
  g.lineCap = 'butt';
  g.save();
  g.translate(0.25, 0.25);
  g.strokeStyle = 'rgba(0,0,0,.22)';
  g.lineWidth = 0.3;
  g.stroke(FENCES);
  g.restore();
  g.strokeStyle = '#4a3826';
  g.lineWidth = 0.24;
  g.stroke(FENCES);
  g.setLineDash([0.2, 0.5]);
  g.strokeStyle = '#dccfae';
  g.lineWidth = 0.44;
  g.stroke(FENCES);
  g.setLineDash([]);
  g.lineCap = 'round';
}

// The ground never changes, so it is painted once into tiles of 64 m and the
// tiles are copied to the screen. Painting it afresh every frame was the
// biggest single cost of a frame.
const TILE_M = 64;
const TILE_PX = TILE_M * PX_PER_M;
const TILE_LIMIT = 40;

// Tile canvases by position, least recently used first.
const groundTiles = new Map();

/**
 * The ground tile at a tile position, painted on first use.
 * @param {number} tx
 * @param {number} ty
 * @param {boolean} paint Whether to paint the tile if it is missing.
 * @param {number} room How many tiles to keep.
 * @return {?HTMLCanvasElement}
 */
function groundTile(tx, ty, paint, room) {
  const key = (ty + 512) * 4096 + tx + 512;
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
function drawGround(x0, y0, x1, y1) {
  const view = ctx.getTransform();
  const z = view.a;
  textures.water.setTransform(
    new DOMMatrix()
      .scaleSelf(1 / PX_PER_M)
      .translateSelf((state.t * 5) % 64, (state.t * 2) % 64)
  );
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
  ctx.setTransform(view);
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

/**
 * @param {!Array<!Building>} builds
 * @param {!Array<!Object>} trees
 */
function drawShadows(builds, trees) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  for (const b of builds) {
    ctx.save();
    ctx.translate(b.h * 0.35, b.h * 0.35);
    ctx.fill(b.path);
    ctx.restore();
  }
  ctx.beginPath();
  for (const t of trees) {
    ctx.moveTo(t.x + 1.6 + t.r * 0.9, t.y + 1.6);
    ctx.arc(t.x + 1.6, t.y + 1.6, t.r * 0.9, 0, TAU);
  }
  ctx.fill();
}

/**
 * Buildings lean away from the screen centre, like looking straight down from a
 * helicopter.
 * @param {!Array<!Building>} builds
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 */
function drawBuildings(builds, cx, cy, hc) {
  for (const b of builds) {
    b.d = (b.mx - cx) ** 2 + (b.my - cy) ** 2;
  }
  builds.sort((a, b) => b.d - a.d);
  for (const b of builds) {
    const h = Math.min(b.h, hc * 0.5);
    const s = hc / (hc - h);
    const ox = cx * (1 - s);
    const oy = cy * (1 - s);
    const p = b.p;
    for (let i = 0, k = 0; i < p.length; i += 2, k++) {
      const ax = p[i];
      const ay = p[i + 1];
      if (b.k === 'o') {
        // an open roof stands on posts
        ctx.strokeStyle = '#6c6f76';
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax * s + ox, ay * s + oy);
        ctx.stroke();
        continue;
      }
      if ((cx - ax) * b.nx[k] + (cy - ay) * b.ny[k] <= 0) {
        continue;
      } // faces away
      const j = (i + 2) % p.length;
      const bx = p[j];
      const by = p[j + 1];
      ctx.fillStyle = ctx.strokeStyle = b.wall[k];
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx * s + ox, by * s + oy);
      ctx.lineTo(ax * s + ox, ay * s + oy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 0.32; // the plinth
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // a row of windows on every floor: pale frames, dark glass
      const tall = (s - 1) * Math.hypot((ax + bx) / 2 - cx, (ay + by) / 2 - cy);
      if (tall < 0.8 || b.h < 5 || b.k === 's') {
        continue;
      }
      const hall = b.k === 'i' || b.k === 'm';
      const pane = (tall * 0.34) / b.floors;
      ctx.lineCap = 'butt';
      for (let f = 0; f < b.floors; f++) {
        const sm = 1 + ((s - 1) * (f + 0.58)) / b.floors;
        const om = 1 - sm;
        ctx.beginPath();
        ctx.moveTo(ax * sm + cx * om, ay * sm + cy * om);
        ctx.lineTo(bx * sm + cx * om, by * sm + cy * om);
        if (!hall) {
          ctx.setLineDash([1.34, 1.26]);
          ctx.lineDashOffset = 0.12;
          ctx.strokeStyle = 'rgba(250,246,232,.85)';
          ctx.lineWidth = pane * 1.5;
          ctx.stroke();
        }
        ctx.setLineDash(hall ? [2.6, 1.2] : [1.1, 1.5]);
        ctx.lineDashOffset = 0;
        ctx.strokeStyle = hall ? 'rgba(40,50,64,.5)' : 'rgba(30,36,48,.85)';
        ctx.lineWidth = pane;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    }
    ctx.save();
    local(b);
    const lx = (cx - b.mx) * b.ca + (cy - b.my) * b.sa;
    // The camera in the roof's own frame
    const ly = (cy - b.my) * b.ca - (cx - b.mx) * b.sa;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 0.3;
    const top = Math.min(h + (b.rh || b.apex || 0), hc * 0.62);
    const s2 = hc / (hc - top);
    const k1 = 1 - s;
    const k2 = 1 - s2;
    if (b.halves) {
      for (const g of b.gables) {
        // the triangles under the ridge
        ctx.fillStyle = b.wall[g[0]];
        ctx.beginPath();
        ctx.moveTo(g[1] * s + lx * k1, g[2] * s + ly * k1);
        ctx.lineTo(g[3] * s2 + lx * k2, g[4] * s2 + ly * k2);
        ctx.lineTo(g[5] * s + lx * k1, g[6] * s + ly * k1);
        ctx.fill();
      }
      for (let n = 0; n < 2; n++) {
        const hp = b.halves[n];
        ctx.beginPath();
        for (let i = 0; i < hp.length; i += 3) {
          const ss = hp[i + 2] ? s2 : s;
          const x = hp[i] * ss + lx * (1 - ss);
          const y = hp[i + 1] * ss + ly * (1 - ss);
          if (i) {
            ctx.lineTo(x, y);
          } else {
            ctx.moveTo(x, y);
          }
        }
        ctx.closePath();
        ctx.fillStyle = b.roof;
        ctx.fill();
        ctx.fillStyle = b.tint[n];
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,228,200,.4)';
      ctx.lineWidth = 0.32; // ridge tiles
      ctx.beginPath();
      ctx.moveTo(b.rx0 * s2 + lx * k2, b.ry * s2 + ly * k2);
      ctx.lineTo(b.rx1 * s2 + lx * k2, b.ry * s2 + ly * k2);
      ctx.stroke();
      const sm = (s + s2) / 2;
      const km = 1 - sm;
      if (b.pv != null) {
        // solar panels
        const dir = b.pv ? -1 : 1;
        const half = (b.v1 - b.v0) / 2;
        const len = (b.rx1 - b.rx0) * 0.62;
        const x = (b.rx0 + b.rx1) / 2 - len / 2;
        ctx.fillStyle = '#1d2c4d';
        ctx.fillRect(
          x * sm + lx * km,
          (b.ry + dir * half * (dir > 0 ? 0.22 : 0.78)) * sm + ly * km,
          len * sm,
          half * 0.56 * sm
        );
      }
      if (b.chim) {
        ctx.fillStyle = '#5a2c22';
        ctx.fillRect(
          b.chim[0] * s2 + lx * k2 - 0.45,
          b.chim[1] * s2 + ly * k2 - 0.45,
          0.9,
          0.9
        );
        ctx.fillStyle = '#1c1c1c';
        ctx.fillRect(
          b.chim[0] * s2 + lx * k2 - 0.2,
          b.chim[1] * s2 + ly * k2 - 0.2,
          0.4,
          0.4
        );
      }
    } else if (b.apex) {
      // spires and silo lids: every wall gets a triangle up to the tip
      const lp = b.lp;
      for (let i = 0, k = 0; i < lp.length; i += 2, k++) {
        const j = (i + 2) % lp.length;
        ctx.beginPath();
        ctx.moveTo(lp[i] * s + lx * k1, lp[i + 1] * s + ly * k1);
        ctx.lineTo(lp[j] * s + lx * k1, lp[j + 1] * s + ly * k1);
        ctx.lineTo(lx * k2, ly * k2);
        ctx.closePath();
        ctx.fillStyle = b.roof;
        ctx.fill();
        ctx.fillStyle = `rgba(0,0,0,${(0.25 + 0.25 * (b.nx[k] * LIGHT[0] + b.ny[k] * LIGHT[1])).toFixed(2)})`;
        ctx.fill();
      }
      if (b.k === 't') {
        ctx.fillStyle = '#e0b21c';
        ctx.fillRect(lx * k2 - 0.35, ly * k2 - 0.35, 0.7, 0.7);
      }
    } else {
      ctx.transform(s, 0, 0, s, lx * k1, ly * k1);
      ctx.fillStyle = b.roof;
      ctx.fill(b.lpath);
      ctx.lineWidth = 0.4;
      ctx.stroke(b.lpath);
      if (b.k !== 'o' && b.a > 30) {
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = 0.25;
        ctx.save();
        ctx.clip(b.lpath);
        ctx.lineWidth = 1.6;
        ctx.stroke(b.lpath);
        ctx.restore();
      } // parapet
      if (b.units) {
        for (const [ux, uy, us] of b.units) {
          ctx.fillStyle = 'rgba(0,0,0,.3)';
          ctx.fillRect(ux + 0.4, uy + 0.4, us, us * 0.7);
          ctx.fillStyle = '#c9cdd3';
          ctx.fillRect(ux, uy, us, us * 0.7);
          ctx.fillStyle = '#7d828a';
          ctx.fillRect(ux + us * 0.15, uy + us * 0.12, us * 0.7, us * 0.12);
        }
      }
    }
    if (b.label) {
      const sl = b.halves ? s2 : 1;
      const size = clamp(
        Math.min((b.u1 - b.u0) / (b.label.length * 0.7), (b.v1 - b.v0) * 0.4),
        2.2,
        11
      );
      if (b.halves) {
        ctx.transform(s2, 0, 0, s2, lx * k2, ly * k2);
      }
      ctx.font = `${size}px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = (size * 0.14) / sl;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.lineJoin = 'round';
      ctx.strokeText(b.label, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.label, 0, 0);
    }
    ctx.restore();
  }
}

/**
 * Lanterns and hydrants.
 * @param {!Array<!Prop>} list
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 */
function drawFurniture(list, cx, cy, hc) {
  const line = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const disc = (x, y, r, f) => {
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };
  ctx.lineCap = 'butt';
  for (const p of list) {
    if (p.k === 'hydrant') {
      if (p.down) {
        disc(p.x, p.y, 1.5, 'rgba(70,130,190,.4)');
      }
      disc(p.x + 0.18, p.y + 0.18, 0.36, 'rgba(0,0,0,.3)');
      disc(p.x, p.y, 0.36, p.down ? '#7a1512' : '#c8201c');
      disc(p.x - 0.08, p.y - 0.08, 0.17, p.down ? '#9a2a22' : '#ee6a5a');
      continue;
    }
    const h = 6.5;
    const s = p.down ? 1 : hc / (hc - h);
    // Standing lanterns lean like the houses do, fallen ones lie flat
    const k = 1 - s;
    const tx = p.down ? p.x + Math.cos(p.fa) * h : p.x * s + cx * k;
    const ty = p.down ? p.y + Math.sin(p.fa) * h : p.y * s + cy * k;
    const hx = tx + Math.cos(p.down ? p.fa + 1.2 : p.a) * 1.4 * s;
    const hy = ty + Math.sin(p.down ? p.fa + 1.2 : p.a) * 1.4 * s;
    if (!p.down) {
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.lineWidth = 0.28;
      line(p.x, p.y, p.x + 2.3, p.y + 2.3);
    }
    disc(p.x, p.y, 0.26, '#26282c');
    ctx.strokeStyle = '#3d4045';
    ctx.lineWidth = 0.3;
    line(p.x, p.y, tx, ty);
    ctx.lineWidth = 0.24;
    line(tx, ty, hx, hy);
    disc(hx, hy, 0.52 * s, '#24262a');
    disc(hx, hy, 0.36 * s, p.down ? '#6a6a62' : '#f6edc0');
  }
  ctx.lineCap = 'round';
}

/**
 * @param {!Array<!Object>} trees
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} hc Camera height, in metres.
 */
function drawTrees(trees, cx, cy, hc) {
  ctx.strokeStyle = '#4a3420';
  ctx.lineWidth = 0.5;
  for (const t of trees) {
    const s = hc / (hc - t.h);
    const x = t.x * s + cx * (1 - s);
    const y = t.y * s + cy * (1 - s);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha =
      state.mode === 'play' &&
      Math.hypot(x - state.player.x, y - state.player.y) < t.r + 2.5
        ? 0.4
        : 1; // see under the canopy
    ctx.drawImage(CANOPY[t.s], x - t.r, y - t.r, t.r * 2, t.r * 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * @param {!Object} p
 * @param {string} shirt
 * @param {string} hair
 */
function drawPerson(p, shirt, hair) {
  const sw = Math.sin(p.t * 4) * 0.22;
  const rect = (x, y, w, h, f) => {
    ctx.fillStyle = f;
    ctx.fillRect(x, y, w, h);
  };
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.scale(1.3, 1.3); // a bit larger than life, to be seen
  rect(-0.15 + sw, -0.34, 0.34, 0.22, '#1c1c22');
  rect(-0.15 - sw, 0.12, 0.34, 0.22, '#1c1c22'); // feet
  rect(-0.08 - sw, -0.6, 0.3, 0.16, '#e0b08a');
  rect(-0.08 + sw, 0.44, 0.3, 0.16, '#e0b08a'); // hands
  rect(-0.24, -0.5, 0.48, 1, shirt);
  rect(-0.2, -0.22, 0.42, 0.44, hair);
  ctx.restore();
}

/** Mission scenery: bonfires, tents, people waiting for a lift. */
function drawProps() {
  const j = state.job;
  for (const pr of j ? j.m.props || [] : []) {
    const s = SPOT[pr.at];
    const x = s.x + (pr.dx || 0);
    const y = s.y + (pr.dy || 0);
    if (pr.from > j.i || pr.until <= j.i) {
      continue;
    }
    if (pr.k === 'fire') {
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 7; i++) {
        const a = state.t * 3 + i * 2.4;
        const r = 1.6 + Math.sin(state.t * 9 + i) * 0.7;
        ctx.fillStyle = i % 2 ? '#ff5a1f' : '#ffd23e';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.3, r * 0.6, 0, TAU);
        ctx.fill();
      }
      if (Math.random() < 0.5) {
        puff(
          x + rand(-1, 1),
          y + rand(-1, 1),
          Math.random() < 0.5 ? 'fire' : 'smoke'
        );
      }
    } else if (pr.k === 'tent') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.a);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f4f4ef' : '#2b62c8';
        ctx.fillRect(-12 + i * 3, -5, 3, 10);
      }
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(-12, -5, 24, 10);
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.restore();
    } else if (pr.k === 'person') {
      drawPerson(
        {x, y, a: state.t * 0.8 + x, t: 0},
        pr.col || '#b3372f',
        '#2a1d12'
      );
    }
  }
}

/**
 * Stains, pickups, people and vehicles.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function drawSprites(x0, y0, x1, y1) {
  const player = state.player;
  const seen = o =>
    o.x > x0 - 14 && o.x < x1 + 14 && o.y > y0 - 14 && o.y < y1 + 14;
  for (const d of state.decals) {
    ctx.fillStyle =
      d.kind === 'blood' ? 'rgba(140,10,16,.8)' : 'rgba(15,12,10,.55)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
  }
  drawProps();
  for (const v of state.items) {
    if (!seen(v)) {
      continue;
    }
    const k = Math.sin(state.t * 5 + v.ph);
    const w = (v.job ? 2.6 : 2) + k * 0.2;
    ctx.fillStyle = v.job ? 'rgba(255,210,62,.5)' : 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.arc(v.x, v.y, (v.job ? 2.4 : 1.7) + k * 0.3, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(Math.sin(state.t * 2 + v.ph) * 0.25);
    ctx.drawImage(icon(v.kind), -w / 2, -w / 2, w, w);
    ctx.restore();
  }
  if (state.mode === 'play' && !player.car && !state.wasted) {
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 1 + Math.sin(state.t * 6) * 0.1, 0, TAU);
    ctx.stroke();
    drawPerson(player, '#19c2bd', '#3a2a1a');
  }
  for (const p of state.peds) {
    if (seen(p)) {
      drawPerson(p, p.shirt, p.hair);
    }
  }
  for (const c of state.cars) {
    if (!seen(c)) {
      continue;
    }
    const type = c.type;
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    if (c.tr) {
      // the trailer hangs on the rear hitch
      const tt = c.tr.type;
      const hx = c.x - (fx * type.length) / 2;
      const hy = c.y - (fy * type.length) / 2;
      ctx.save();
      ctx.translate(
        hx - Math.cos(c.tr.a) * (tt.length / 2 + 0.4),
        hy - Math.sin(c.tr.a) * (tt.length / 2 + 0.4)
      );
      ctx.rotate(c.tr.a);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fillRect(
        -tt.length / 2 + 0.4,
        -tt.width / 2 + 0.4,
        tt.length,
        tt.width
      );
      ctx.drawImage(tt.spr, -tt.length / 2, -tt.width / 2, tt.length, tt.width);
      ctx.restore();
    }
    for (const sh of [0.4, 0]) {
      // shadow first, then the car
      ctx.save();
      ctx.translate(c.x + sh, c.y + sh);
      ctx.rotate(c.a);
      if (sh) {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.fillRect(
          -type.length / 2,
          -type.width / 2,
          type.length,
          type.width
        );
      } else {
        const spin =
          c.kind === 'mixer' && !c.dead
            ? carSprite('mixer', c.col, ((state.t * 5) | 0) % 4)
            : c.spr;
        ctx.drawImage(
          spin,
          -type.length / 2,
          -type.width / 2,
          type.length,
          type.width
        );
        if (c.siren && !c.dead) {
          // blue lights
          const on = ((state.t * 6) | 0) % 2;
          const x = c.kind === 'fire' ? type.length / 2 - 2.3 : -0.2;
          ctx.fillStyle = on ? '#4aa3ff' : '#12327a';
          ctx.fillRect(x, -type.width / 2 + 0.3, 0.5, 0.6);
          ctx.fillStyle = on ? '#12327a' : '#4aa3ff';
          ctx.fillRect(x, type.width / 2 - 0.9, 0.5, 0.6);
        }
      }
      ctx.restore();
    }
  }
}

/**
 */
function drawParticles() {
  for (const p of state.parts) {
    const k = p.life / p.max;
    if (p.kind === 'spark' || p.kind === 'blood' || p.kind === 'water') {
      ctx.fillStyle =
        p.kind === 'spark'
          ? '#ffd23e'
          : p.kind === 'blood'
            ? '#b0121a'
            : '#9fd0f0';
      ctx.fillRect(p.x, p.y, 0.35, 0.35);
      continue;
    }
    ctx.fillStyle =
      p.kind === 'smoke'
        ? `rgba(60,60,64,${0.5 * (1 - k)})`
        : p.kind === 'boom'
          ? `rgba(255,190,90,${1 - k})`
          : k < 0.5
            ? '#ffd23e'
            : '#ff5a1f';
    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      p.kind === 'smoke'
        ? 0.5 + p.life * 1.2
        : p.kind === 'boom'
          ? 2 + k * 8
          : 0.8 - k * 0.6,
      0,
      TAU
    );
    ctx.fill();
  }
}

/** Draws one frame. */
function render() {
  const z = state.cam.z;
  const cx = state.cam.x + rand(-1, 1) * state.shake;
  const cy = state.cam.y + rand(-1, 1) * state.shake;
  const hw = viewW / 2 / z;
  const hh = viewH / 2 / z;
  const x0 = cx - hw;
  const y0 = cy - hh;
  const x1 = cx + hw;
  const y1 = cy + hh;
  const hc = 520 / z; // hc = camera height in metres
  ctx.setTransform(
    z,
    0,
    0,
    z,
    Math.round(viewW / 2 - cx * z),
    Math.round(viewH / 2 - cy * z)
  );
  ctx.lineJoin = ctx.lineCap = 'round';
  const builds = gridFind(
    buildingGrid,
    x0 - 30,
    y0 - 30,
    x1 + 30,
    y1 + 30
  ).concat(
    BUILD.filter(
      b =>
        b.k === 'o' &&
        b.x1 > x0 - 30 &&
        b.x0 < x1 + 30 &&
        b.y1 > y0 - 30 &&
        b.y0 < y1 + 30
    )
  );
  const trees = gridFind(treeGrid, x0 - 12, y0 - 12, x1 + 12, y1 + 12);
  drawGround(x0, y0, x1, y1);
  drawShadows(builds, trees);
  drawSprites(x0, y0, x1, y1);
  drawBuildings(builds, cx, cy, hc);
  drawFurniture(gridFind(propGrid, x0 - 9, y0 - 9, x1 + 9, y1 + 9), cx, cy, hc);
  drawParticles();
  drawTrees(trees, cx, cy, hc);
  // the world ends here
  ctx.fillStyle = 'rgba(8,10,14,.7)';
  const m = v => Math.max(0, v);
  ctx.fillRect(x0, y0, x1 - x0, m(-y0));
  ctx.fillRect(x0, WORLD_H, x1 - x0, m(y1 - WORLD_H));
  ctx.fillRect(x0, 0, m(-x0), WORLD_H);
  ctx.fillRect(WORLD_W, 0, m(x1 - WORLD_W), WORLD_H);
  if (state.mode === 'play') {
    drawOverlay(cx, cy, z);
  }
}

/**
 * Labels and pointers, in screen pixels.
 * @param {number} cx
 * @param {number} cy
 * @param {number} z Zoom, in pixels per metre.
 */
function drawOverlay(cx, cy, z) {
  const player = state.player;
  const j = state.job;
  const sx = x => (x - cx) * z + viewW / 2;
  const sy = y => (y - cy) * z + viewH / 2;
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
    const x = sx(o.x);
    const y = sy(o.y);
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
    if (to === j.veh || to === j.prey) {
      // the car you are after
      const bob = Math.sin(state.t * 6) * 3;
      arrow(
        sx(to.x),
        sy(to.y) - 3.2 * z - 12 + bob,
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
      arrow(
        sx(player.x) + Math.cos(a) * r,
        sy(player.y) + Math.sin(a) * r,
        a,
        '#ffd23e',
        0.75
      );
    }
  }
  if (DEBUG) {
    for (const k of Object.keys(SPOT)) {
      label(k, sx(SPOT[k].x), sy(SPOT[k].y) - 8, '#f0f');
    }
  }
  ctx.font = 'bold 14px "Courier New", monospace';
  for (const t of state.texts) {
    label(t.s, sx(t.x), sy(t.y), t.col);
  }
}

// ---------- the fold-out map (Tab): the whole village on paper, true to scale

const mapCanvas = byId('map');
const mapCtx = mapCanvas.getContext('2d');
const PAPER = {
  farm: '#efe6c2',
  meadow: '#d3e2ad',
  forest: '#9cc58a',
  scrub: '#b6d39a',
  orchard: '#c2dc9c',
  resi: '#f3ecdb',
  ind: '#d8d2cc',
  com: '#d8d2cc',
  school: '#e4d9c0',
  yard: '#ded2b8',
  dump: '#cdbfa6',
  cem: '#c5d9a6',
  constr: '#d9c9a0',
  park: '#c9c4bd',
  play: '#f0de9c',
  water: '#8fc4e8',
  pitch: '#a5d48c',
};
const MAP_NAMES = [
  'hq',
  'shop',
  'murk',
  'works',
  'clubhouse',
  'townhall',
  'bakery',
  'club',
  'firestation',
  'hall',
  'drinks',
  'sewage',
  'dump',
  'pond',
  'lavite',
  'warehouse',
  'church',
  'inn',
  'cemetery',
  'school',
  'butcher',
  'fairground',
  'station',
  'beach',
  'carwash',
  'roadworks',
];
let mapBase = null;
let mapK = 0;
let mapDpr = 1;

/**
 * Paints the paper layer of the fold-out map.
 * @param {number} k Device pixels per metre.
 * @param {number} dpr Device pixel ratio.
 * @return {!HTMLCanvasElement}
 */
function mapPaint(k, dpr) {
  const c = canvas(Math.ceil(WORLD_W * k), Math.ceil(WORLD_H * k));
  const g = c.getContext('2d');
  const px = 1 / k;
  const stroke = (l, style, grow, min) => {
    g.strokeStyle = style;
    for (const [rw, path] of l) {
      g.lineWidth = Math.max(rw + grow, min * px * dpr);
      g.stroke(path);
    }
  };
  g.scale(k, k);
  g.lineJoin = g.lineCap = 'round';
  g.fillStyle = '#e6dfc4';
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  for (const a of AREAS) {
    g.fillStyle = PAPER[a.k] || '#e6dfc4';
    g.fill(a.path);
  }
  stroke(ROADS.stream, '#8fc4e8', 0, 1);
  stroke(ROADS.river, '#6fb0de', 0, 2.5);
  g.setLineDash([4 * px * dpr, 3 * px * dpr]);
  stroke(ROADS.dirt, '#a08a60', -1.5, 1);
  stroke(ROADS.foot, '#b0a080', 0, 0.8);
  g.setLineDash([]);
  stroke(ROADS.rail, '#4a4a4a', 0, 1.8);
  g.setLineDash([5 * px * dpr, 5 * px * dpr]);
  stroke(ROADS.rail, '#fff', -0.8, 0.9);
  g.setLineDash([]);
  const streets = [...ROADS.road, ...ROADS.cobble];
  stroke(streets, '#7d7566', 2.2, 3.2);
  stroke(streets, '#fffdf6', 0, 1.8);
  stroke(ROADS.line, '#ffc21a', 0, 2.2); // the main roads in gold
  for (const b of BUILD) {
    if (b.k !== 'x' && b.k !== 'o') {
      g.fillStyle = b.label
        ? '#6e2518'
        : 'imts'.includes(b.k)
          ? '#948a84'
          : '#c0563d';
      g.fill(b.path);
    }
  }
  // names, in screen pixels so they stay crisp
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const taken = [];
  const free = (x, y, w, h) =>
    !taken.some(
      t => x < t[0] + t[2] && x + w > t[0] && y < t[1] + t[3] && y + h > t[1]
    ) &&
    x > 2 &&
    y > 2 &&
    x + w < c.width - 2 &&
    y + h < c.height - 2;
  const halo = (text, x, y, col) => {
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(255,253,246,.9)';
    g.strokeText(text, x, y);
    g.fillStyle = col;
    g.fillText(text, x, y);
  };
  g.font = `bold ${11 * dpr}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  for (const key of MAP_NAMES) {
    const text = PLACES[key];
    const w = g.measureText(text).width;
    const h = 13 * dpr;
    const x = MAP.pois[key][0] * k;
    const y = MAP.pois[key][1] * k;
    const gap = 6 * dpr;
    const at = [
      [x + gap, y - h / 2],
      [x - gap - w, y - h / 2],
      [x - w / 2, y - gap - h],
      [x - w / 2, y + gap],
    ].find(q => free(q[0], q[1], w, h));
    if (!at) {
      continue;
    }
    taken.push([at[0], at[1], w, h]);
    g.fillStyle = '#0c0e11';
    g.beginPath();
    g.arc(x, y, 2.6 * dpr, 0, TAU);
    g.fill();
    g.textAlign = 'left';
    halo(text, at[0], at[1] + h / 2, '#0c0e11');
  }
  g.font = `italic ${9.5 * dpr}px Arial, sans-serif`;
  g.textAlign = 'center';
  // Street names along the longest stretch of each street
  const longest = new Map();
  for (const sg of SEGS) {
    if (
      sg[6].n &&
      DRIVE.includes(sg[6].t) &&
      (!longest.has(sg[6].n) || longest.get(sg[6].n)[5] < sg[5])
    ) {
      longest.set(sg[6].n, sg);
    }
  }
  for (const [name, sg] of longest) {
    const w = g.measureText(name).width;
    const x = ((sg[0] + sg[2]) / 2) * k;
    const y = ((sg[1] + sg[3]) / 2) * k;
    let a = Math.atan2(sg[3] - sg[1], sg[2] - sg[0]);
    if (Math.abs(a) > Math.PI / 2) {
      a -= Math.sign(a) * Math.PI;
    }
    const bw = Math.abs(Math.cos(a)) * w + 12 * dpr;
    const bh = Math.abs(Math.sin(a)) * w + 12 * dpr;
    if (sg[5] * k < w * 0.8 || !free(x - bw / 2, y - bh / 2, bw, bh)) {
      continue;
    }
    taken.push([x - bw / 2, y - bh / 2, bw, bh]);
    g.save();
    g.translate(x, y);
    g.rotate(a);
    halo(name, 0, -7 * dpr, '#5d5648');
    g.restore();
  }
  return c;
}

/**
 * Opens or closes the map; the game holds its breath meanwhile.
 * @param {boolean} on
 */
function showMap(on) {
  if (state.mode !== 'play' || (on && state.paused)) {
    return;
  }
  state.map = on;
  mapCanvas.hidden = !on;
  audio.pause(on || state.paused);
  if (!on) {
    return;
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cw = Math.round(innerWidth * dpr);
  const ch = Math.round(innerHeight * dpr);
  const fitH = (ch - 24 * dpr) / WORLD_H;
  const k = Math.max(
    Math.min((cw - 24 * dpr) / WORLD_W, fitH),
    Math.min(fitH, 0.45 * dpr)
  ); // whole village if it fits, else a readable cut-out
  if (mapCanvas.width === cw && mapCanvas.height === ch && k === mapK) {
    return;
  }
  mapCanvas.width = cw;
  mapCanvas.height = ch;
  mapK = k;
  mapDpr = dpr;
  mapBase = mapPaint(k, dpr);
}

const pathLength = p => {
  let d = 0;
  for (let i = 2; i < p.length; i += 2) {
    d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  }
  return d;
};
const metres = d =>
  d < 950
    ? `${Math.round(d / 10) * 10} m`
    : `${(d / 1000).toFixed(1).replace('.', ',')} km`;

/**
 * The way between two points along the roads.
 * @param {!Float32Array} f
 * @param {!Point} o
 * @param {!Point} to
 * @return {!Array<number>} A flat list of x, y pairs.
 */
function routeLine(f, o, to) {
  const [link, qx, qy] = nearLink(o);
  const [goal, tx, ty] = nearLink(to);
  const cost = n =>
    f[n] + Math.hypot(NODES[n].x - qx, NODES[n].y - qy) * link.k;
  const pts = [o.x, o.y];
  let n = cost(link[0]) < cost(link[1]) ? link[0] : link[1];
  if (f[n] > 1e8) {
    return [o.x, o.y, to.x, to.y];
  }
  if (link !== goal) {
    for (pts.push(qx, qy); n >= 0; n = goal.includes(n) ? -1 : downhill(f, n)) {
      pts.push(NODES[n].x, NODES[n].y);
    }
  }
  pts.push(tx, ty, to.x, to.y);
  return pts;
}

/** Draws the map with the route, the target and the player. */
function drawMap() {
  const player = state.player;
  const j = state.job;
  const to = j && j.to;
  const k = mapK;
  const d = mapDpr;
  const cw = mapCanvas.width;
  const ch = mapCanvas.height;
  const g = mapCtx;
  const fx = to ? (player.x + to.x) / 2 : player.x;
  // Keep you and the target in view
  const fy = to ? (player.y + to.y) / 2 : player.y;
  const ox =
    WORLD_W * k <= cw
      ? (cw - WORLD_W * k) / 2
      : clamp(cw / 2 - fx * k, cw - WORLD_W * k, 0);
  const oy =
    WORLD_H * k <= ch
      ? (ch - WORLD_H * k) / 2
      : clamp(ch / 2 - fy * k, ch - WORLD_H * k, 0);
  const toX = x => ox + x * k;
  const toY = y => oy + y * k;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
  const chip = (text, x, y, align, col = '#f3ecdb') => {
    // a label on a dark plate
    g.font = `bold ${12 * d}px "Courier New", monospace`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const w = g.measureText(text).width + 12 * d;
    const h = 20 * d;
    const left = clamp(
      align === 'right' ? x - w : align === 'center' ? x - w / 2 : x,
      4 * d,
      cw - w - 4 * d
    );
    const top = clamp(y - h / 2, 4 * d, ch - h - 4 * d);
    g.fillStyle = 'rgba(12,14,17,.88)';
    g.fillRect(left, top, w, h);
    g.fillStyle = col;
    g.fillText(text, left + 6 * d, top + h / 2 + d);
  };
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#0c0e11';
  g.fillRect(0, 0, cw, ch);
  g.drawImage(mapBase, ox, oy);
  g.lineJoin = g.lineCap = 'round';
  let far = 0;
  if (to) {
    // the route in gold, like the yellow arrow would lead you
    const pts = routeLine(state.gps ? state.gps.f : field(to), player, to);
    far = pathLength(pts);
    for (const [w, col] of [
      [6 * d, '#0c0e11'],
      [3.4 * d, '#ffd23e'],
    ]) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        if (i) {
          g.lineTo(toX(pts[i]), toY(pts[i + 1]));
        } else {
          g.moveTo(toX(pts[i]), toY(pts[i + 1]));
        }
      }
      g.stroke();
    }
  }
  for (const v of state.items) {
    if (v.job) {
      g.fillStyle = '#ffd23e';
      g.strokeStyle = '#0c0e11';
      g.lineWidth = 2 * d;
      g.beginPath();
      g.arc(toX(v.x), toY(v.y), 5 * d, 0, TAU);
      g.fill();
      g.stroke();
    }
  }
  if (state.wanted >= 1) {
    for (const c of state.cars) {
      if (c.ai && c.ai.cop) {
        g.fillStyle = pulse > 0.5 ? '#4aa3ff' : '#12327a';
        g.beginPath();
        g.arc(toX(c.x), toY(c.y), 5 * d, 0, TAU);
        g.fill();
      }
    }
  }
  if (to) {
    g.strokeStyle = '#0c0e11';
    g.lineWidth = 6 * d;
    g.beginPath();
    g.arc(toX(to.x), toY(to.y), (8 + pulse * 4) * d, 0, TAU);
    g.stroke();
    g.strokeStyle = '#ffd23e';
    g.lineWidth = 3 * d;
    g.stroke();
    chip(
      `${to.name || 'Ziel'} · ${metres(far)}`,
      toX(to.x),
      toY(to.y) - 24 * d,
      'center',
      '#ffd23e'
    );
  }
  g.save(); // you: an arrow pointing the way you face
  g.translate(toX(player.x), toY(player.y));
  g.rotate(player.a);
  g.fillStyle = '#19c2bd';
  g.strokeStyle = '#0c0e11';
  g.lineWidth = 2.5 * d;
  g.beginPath();
  g.moveTo(11 * d, 0);
  g.lineTo(-7 * d, -7 * d);
  g.lineTo(-3 * d, 0);
  g.lineTo(-7 * d, 7 * d);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
  g.strokeStyle = `rgba(25,194,189,${1 - pulse})`;
  g.lineWidth = 2 * d;
  g.beginPath();
  g.arc(toX(player.x), toY(player.y), (10 + pulse * 12) * d, 0, TAU);
  g.stroke();
  chip('DU', toX(player.x), toY(player.y) + 24 * d, 'center', '#19c2bd');
  chip('KARTE · MARKT WACHENROTH', 10 * d, 16 * d, 'left');
  chip(
    document.body.classList.contains('touch')
      ? 'TIPPEN: ZURÜCK'
      : 'TAB: ZURÜCK',
    cw - 10 * d,
    16 * d,
    'right'
  );
  const bar = 200 * k;
  const bx = 16 * d;
  const by = ch - 18 * d; // scale bar
  chip('200 m', bx + bar + 8 * d, by, 'left');
  g.fillStyle = '#f3ecdb';
  g.fillRect(bx - 2 * d, by - 5 * d, bar + 4 * d, 10 * d);
  for (let i = 0; i < 4; i += 2) {
    g.fillStyle = '#0c0e11';
    g.fillRect(bx + (bar / 4) * i, by - 3 * d, bar / 4, 6 * d);
  }
}

// ---------- main loop

/** Fits the canvas to the window. */
function resize() {
  const a = innerWidth / innerHeight;
  if (a >= 1) {
    viewH = 450;
    viewW = Math.round(450 * Math.min(a, 2.6));
  } else {
    viewW = 400;
    viewH = Math.round(400 / Math.max(a, 0.42));
  }
  gameCanvas.width = viewW;
  gameCanvas.height = viewH;
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', () => {
  resize();
  if (state.map) {
    showMap(true);
  }
});
resize();

let last = 0;
/**
 * One tick of the main loop.
 * @param {number} now
 */
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (state.map) {
    drawMap();
  } // the game holds its breath while you read the map
  else {
    if (!state.paused) {
      for (let n = dt > 0.02 ? 2 : 1, i = 0; i < n; i++) {
        update(dt / n);
      }
      if (state.mode === 'play') {
        guide(dt);
      }
    }
    render();
    if (!state.paused) {
      hud(dt);
    }
  }
  requestAnimationFrame(frame);
}
reset('menu');
requestAnimationFrame(frame);

// Hooks for play-testing: the browser console and tools/playtest.js reach the
// game through window.GTW.
window.GTW = {
  get state() {
    return state;
  },
  MISSIONS,
  SPOT,
  NODES,
  AREAS,
  BUILD,
  PROPS: streetProps,
  TYPES,
  pad,
  audio,
  update,
  guide,
  render,
  camera,
  hud,
  toggleCar,
  showMap,
  makeCar,
  field,
  waypoint,
  nearLink,
  nearNode,
  routeLine,
  pathLength,
  dist,
  wrap,
  surfAt,
  tp(key) {
    const s = SPOT[key];
    const o = state.player.car || state.player;
    Object.assign(o, {x: s.x, y: s.y, vx: 0, vy: 0});
  },
  skip() {
    if (state.job) {
      state.job.i = state.job.m.steps.length - 1;
      nextStep();
    }
  },
  job(n) {
    state.job = null;
    state.jobN = n;
    state.nextJob = 0;
  },
};

if (location.search.includes('selftest')) {
  // open index.html?selftest and read the console
  const sq = [0, 0, 10, 0, 10, 10, 0, 10];
  const a = pushOut(10.5, 5, 1, sq);
  const b = pushOut(9, 5, 1, sq);
  const home = field(SPOT.hq);
  const ride = (from, to) => {
    // follow the yellow arrow from one place to another, as the crow walks the
    // roads
    const f = field(to);
    const o = {x: from.x, y: from.y};
    for (let i = 0; i < 400 && dist(o, to) > 50; i++) {
      const w = waypoint(f, o, 40);
      if (!w) {
        return false;
      }
      const d = dist(o, w) || 1;
      o.x += ((w.x - o.x) / d) * 12;
      o.y += ((w.y - o.y) / d) * 12;
    }
    return dist(o, to) <= 50;
  };
  const used = new Set(
    MISSIONS.flatMap(m => [
      ...m.steps.flatMap(s => [s.to, s.at, s.near]),
      ...(m.props || []).map(p => p.at),
    ]).filter(Boolean)
  );
  const checks = {
    'clear of a wall: no push': pushOut(20, 5, 1, sq) === null,
    'touching a wall: pushed straight out':
      a && a[0] === 1 && Math.abs(a[2] - 0.5) < 1e-9,
    'inside a building: pushed out through the nearest wall':
      b && b[0] === 1 && Math.abs(b[2] - 2) < 1e-9,
    'every mission place exists': [...used].every(
      k => SPOT[k] || console.error('unknown place', k)
    ),
    'every place has room for a car': Object.values(SPOT).every(
      s => !blocked(s.x, s.y, 1.2) || console.error('blocked', s.key)
    ),
    'no place is under water': Object.values(SPOT).every(
      s => (surfAt(s.x, s.y) & 9) !== 8 || console.error('wet', s.key)
    ),
    'a road leads from the HQ to every place': Object.values(SPOT).every(
      s => home[nearNode(s, 'gps')] < 1e8 || console.error('cut off', s.key)
    ),
    'the yellow arrow leads from the HQ to every place and back': Object.values(
      SPOT
    ).every(
      s =>
        (ride(SPOT.hq, s) && ride(s, SPOT.hq)) ||
        console.error('arrow lost', s.key)
    ),
    'every mission pays and talks': MISSIONS.every(
      m =>
        m.reward > 0 &&
        m.intro.length &&
        m.outro.length &&
        m.steps.every(s => s.obj)
    ),
  };
  for (const k of Object.keys(checks)) {
    console.assert(checks[k], k);
  }
  document.title = Object.values(checks).every(Boolean)
    ? 'selftest ok'
    : 'selftest FAILED';
}

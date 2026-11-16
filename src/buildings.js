/**
 * @fileoverview Buildings: walls, windows, signs and what makes a landmark
 * differ from an ordinary house.
 */

import {MAP} from '../map.js';
import {nearest, pip} from './geometry.js';
import {at, grid, gridAdd} from './grid.js';
import {AREAS, SEGS, prepPoly, surfAt, town} from './land.js';
import {SIGNS} from './missions.js';
import {LIGHT, ROOFS, buildRoof, ridge, surveyedRoof} from './roofs.js';
import {textures} from './textures.js';
import {TAU, canvas, clamp, lerp, pick2, rng, shade} from './util.js';

/**
 * A building from the map: outline p, wall height h, kind k, and where it was
 * surveyed the roof shape r: 'f' flat, 'g' gable, 'p' hip, how far the ridge
 * (or a spire) rises above the walls t, and the direction dir the ridge runs
 * in. The roof colour c is read off the aerial photo.
 * @typedef {!Object}
 */
let Building;

export const BUILD = MAP.buildings;
export const buildingGrid = grid();
let buildingCount = 0;

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
  w: ['#e6dfcf'],
  d: ['#8a6a48', '#a07a50', '#6f7f5a', '#7a5a3c', '#9a8f7a'],
};
// Johann-Philipp-Ring is a new estate: the gardens are still bare earth, there
// are no fences yet, every house has a paved drive down to the street, and
// the roofs are dark hips with solar panels.
export const NEW_ESTATE = 'Johann-Philipp-Ring';
const NEW_WALLS = ['#f2f1ec', '#e9e8e2', '#f4efe2'];

// How the landmarks differ from ordinary houses: wall colour, roof texture,
// roof shape, the plate behind the roof sign [background, letters], and the
// colour of big gates on the street side.
const LANDMARKS = {
  firestation: {
    wall: '#efe9da',
    roof: 'tile4',
    plate: ['#c8201c', '#ffffff'],
    gates: '#c8201c',
  },
  townhall: {
    wall: '#ecd9a0',
    roof: 'tile4',
    hip: true,
    plate: ['#7a1f1f', '#f3e2a0'],
  },
  shop: {wall: '#f4f4ef', roof: 'tile6', plate: ['#f2d23e', '#1f4fa8']},
  hq: {wall: '#f2f1ec', roof: 'slate', hip: true, pv: true},
  murk: {plate: ['#60bfcc', '#ffffff']},
  bakery: {wall: '#f0e2c0', plate: ['#b5622f', '#ffffff']},
  works: {roof: 'metal', plate: ['#284d98', '#ffffff']},
  clubhouse: {plate: ['#c8201c', '#ffffff']},
  club: {wall: '#d9c9a4', roof: 'tile2'},
  butcher: {},
  church: {roof: 'tile1'},
  linsner: {roof: 'tile1'},
  warehouse: {roof: 'tile1'},
  lavite: {wall: '#f1ead8', roof: 'tile2'},
  garage: {plate: ['#15151a', '#f2a01c'], gates: '#5a5d63'},
  no14: {wall: '#f4f2ea', roof: 'slate'},
  schul22: {wall: '#efe9dc', roof: 'slate'},
};

// The roof for the colour the aerial photo shows: orange, red or brown tiles,
// weathered tiles, grey, light, dark. Grey roofs differ when they are flat.
const ROOF_BY_COLOUR = {
  o: ['tile2'],
  r: ['tile1', 'tile4'],
  b: ['tile3'],
  w: ['tile5'],
  g: ['tile6'],
  l: ['metal'],
  d: ['slate'],
};
const FLAT_BY_COLOUR = {g: ['flat'], l: ['flatLight'], d: ['tar']};

/**
 * Paints a roof sign once; drawing text in every frame is slow.
 * @param {string} text
 * @param {?Array<string>} plate Background and letter colour, or null for
 *     plain white letters.
 * @return {!HTMLCanvasElement}
 */
export function makeSign(text, plate) {
  const size = 56;
  const font = `${size}px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`;
  const probe = canvas(1, 1).getContext('2d');
  probe.font = font;
  const w = Math.ceil(
    probe.measureText(text).width + size * (plate ? 0.9 : 0.4)
  );
  const h = Math.ceil(size * (plate ? 1.5 : 1.3));
  const sign = canvas(w, h);
  const g = sign.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (plate) {
    g.fillStyle = '#0c0e11';
    g.fillRect(0, 0, w, h);
    g.fillStyle = plate[0];
    g.fillRect(4, 4, w - 8, h - 8);
    g.fillStyle = plate[1];
    g.fillText(text, w / 2, h / 2 + 3);
  } else {
    g.lineWidth = size * 0.14;
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(text, w / 2, h / 2 + 3);
    g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2 + 3);
  }
  return sign;
}

/**
 * Places windows on the walls, and a door or gates on the street side.
 * @param {!Building} b
 * @param {!Object} look The landmark's look, empty for ordinary houses.
 */
function addWindows(b, look) {
  const k = b.k;
  const hall = k === 'i' || k === 'm';
  const lived = k === 'h' || k === 'c' || (k === 'y' && b.a < 250);
  if (!(hall || lived) || b.h < (k === 'h' ? 2.6 : 5)) {
    return;
  }
  // Rows of windows as shares of the wall height: [bottom, top].
  if (hall) {
    b.rows =
      b.h > 8
        ? [
            [0.12, 0.4],
            [0.62, 0.84],
          ]
        : [[0.5, 0.8]];
  } else if (k === 'c') {
    b.rows = [[0.28, 0.74]];
  } else if (b.a < 70 || b.floors < 2) {
    b.rows = [[0.3, 0.72]];
  } else if (b.floors === 2) {
    b.rows = [
      [0.14, 0.4],
      [0.58, 0.84],
    ];
  } else {
    b.rows = [
      [0.1, 0.27],
      [0.4, 0.57],
      [0.7, 0.87],
    ];
  }
  const gap = hall ? 4.4 : k === 'c' ? 4.6 : 3;
  const half = hall ? 1.5 : 0.55;
  b.glass = hall ? 'rgba(40,50,64,.6)' : '#2b3b4d';
  b.frame = !hall;
  b.wins = [];
  const p = b.p;
  let front = -1;
  let frontLen = 0;
  let best = 1e9;
  for (let i = 0, w = 0; i < p.length; i += 2, w++) {
    const j = (i + 2) % p.length;
    const len = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]);
    const count = Math.min(8, Math.floor((len - 0.8) / gap));
    const list = [];
    for (let c = 0; c < count; c++) {
      list.push((c + 0.5) / count, half / len);
    }
    b.wins.push(list);
    if (!b.rd || len < 2.6) {
      continue;
    }
    const d = Math.hypot(
      (p[i] + p[j]) / 2 - b.rd[0],
      (p[i + 1] + p[j + 1]) / 2 - b.rd[1]
    );
    if (d < best) {
      best = d;
      front = w;
      frontLen = len;
    }
  }
  if (front < 0) {
    return;
  }
  if (look.gates) {
    // Big gates along the whole street side; they take the ground floor.
    const count = Math.max(1, Math.floor(frontLen / 4.6));
    b.doors = {
      wall: front,
      at: Array.from({length: count}, (v, c) => (c + 0.5) / count),
      half: 1.75 / frontLen,
      top: Math.min(0.62, 3.9 / b.h),
      col: look.gates,
      wide: true,
    };
  } else if (k === 'h') {
    b.doors = {
      wall: front,
      at: [0.5],
      half: 0.5 / frontLen,
      top: Math.min(0.45, 2.15 / b.h),
      col: '#5a3a22',
      wide: false,
    };
  }
}

/**
 * Picks walls and a roof for a building and files it in the grid.
 * @param {!Building} b
 * @param {!Rng} r
 */
function prepBuilding(b, r) {
  // A sign needs the long side of the roof, whichever way the ridge runs.
  prepPoly(b, b.label ? undefined : b.dir);
  const k = b.k;
  // The surveyed height of the ridge or the spire above the walls, or 0.
  const lift = b.t || 0;
  const fresh = k === 'h' && !!b.rd && b.rd[2][6].n === NEW_ESTATE;
  const look = b.look || LANDMARKS[b.poi] || {};
  let base = pick2(WALLS[k] || WALLS.h, r);
  if (look.wall) {
    base = look.wall;
  } else if (fresh) {
    base = pick2(NEW_WALLS, r);
  }
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
  b.lpath = new Path2D(`M${b.lp.join(' ')}Z`);
  const big = b.a > 900;
  const v = r();
  const simple = b.p.length <= 28 && wide > 2.5;
  let gable = simple;
  if (k === 's' || k === 't') {
    b.apex = lift || (k === 's' ? 2 : b.a < 20 ? 2.6 : 9);
    gable = false;
  } else if (k === 'w') {
    b.roof = textures.metalRed;
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
  const real = !'stwxo'.includes(k); // towers, silos and the like are made up
  if (b.r && real) {
    // The surveyed roof shape beats the guess.
    gable = simple && b.r !== 'f';
  }
  if (fresh) {
    b.roof = gable ? textures.slate : textures.solar;
  } else if (b.c && real) {
    // And the photo knows the colour. A lean-to roof is drawn flat, but may
    // well be tiled. A light roof is sheet metal, except on a house.
    const colour = b.c === 'l' && k === 'h' ? 'g' : b.c;
    const names =
      (b.r === 'f' && FLAT_BY_COLOUR[colour]) || ROOF_BY_COLOUR[colour];
    b.roof = textures[pick2(names, r)];
  }
  if (look.roof) {
    b.roof = textures[look.roof];
  }
  if (look.flat) {
    gable = false;
  }
  const metal = b.roof === textures.metal || b.roof === textures.metalRed;
  if (gable) {
    const guess =
      k === 'c'
        ? clamp(wide * 0.45, 2, 6)
        : clamp(wide * (metal ? 0.14 : 0.27), 0.7, 3.4);
    ridge(b, lift || guess, fresh || !!look.hip || b.r === 'p');
  }
  if (b.halves && b.gables.length < 2) {
    b.halves = null;
  }
  if (b.halves && k === 'h' && b.a > 60 && !fresh) {
    b.chim = [
      lerp(b.rx0, b.rx1, 0.25 + r() * 0.5),
      b.ry + (r() < 0.5 ? -1 : 1),
    ];
  }
  // Solar panels on one slope: on most new houses, on some old ones.
  const sunny = look.pv || r() < (fresh ? 0.8 : 0.22);
  if (b.halves && k === 'h' && b.a > 80 && sunny) {
    b.pv = r() < 0.5 ? 0 : 1;
  }
  if (b.apex) {
    // Spires and silo lids are plain: one colour per face, by how the sun
    // falls on it.
    const lid = k === 's' ? '#b4b4ae' : '#4a4e57';
    b.faces = b.nx.map((nx, i) =>
      shade(lid, 0.9 - 0.3 * (nx * LIGHT[0] + b.ny[i] * LIGHT[1]))
    );
  } else if (!b.halves) {
    // A flat roof has a rim, and bigger ones vents and air conditioning.
    const rim = [];
    for (let i = 0; i < b.lp.length; i += 2) {
      const d = Math.hypot(b.lp[i], b.lp[i + 1]) || 1;
      const pull = Math.min(0.7, d * 0.3) / d;
      rim.push(b.lp[i] * (1 - pull), b.lp[i + 1] * (1 - pull));
    }
    b.rim = new Path2D(`M${rim.join(' ')}Z`);
    if (b.a > 400 && k !== 'o') {
      b.units = Array.from({length: Math.min(6, (b.a / 500) | 0) + 1}, () => [
        lerp(b.u0, b.u1, 0.15 + r() * 0.7),
        lerp(b.v0, b.v1, 0.2 + r() * 0.6),
        1.5 + r() * 2,
      ]);
      if (b.a > 2500) {
        // A big hall has skylights in rows, as the roof of Murk does.
        b.units = [];
        for (let u = b.u0 + 7; u < b.u1; u += 14) {
          for (let v = b.v0 + 7; v < b.v1; v += 14) {
            b.units.push([u, v, 2.2]);
          }
        }
      }
      // Only what stands on the roof: the outline is seldom a rectangle.
      b.units = b.units.filter(([u, v, size]) =>
        [-1, 0, size, size + 1].every(
          d =>
            pip(u + d, v + d * 0.7, b.lp) &&
            pip(u + size - d, v + d * 0.7, b.lp)
        )
      );
    }
  }
  b.floors = clamp(Math.round(b.h / 3), 1, 3);
  addWindows(b, look);
  if (b.label) {
    b.sign = makeSign(b.label, look.plate || null);
    const aspect = b.sign.width / b.sign.height;
    b.signH = clamp(
      Math.min((b.u1 - b.u0) / (aspect * 1.15), (b.v1 - b.v0) * 0.42),
      2,
      9
    );
    b.signW = b.signH * aspect;
  }
  // A surveyed roof keeps its faces under a plot that is painted.
  const spec = b.f ? {...ROOFS[b.poi], ...surveyedRoof(b)} : ROOFS[b.poi];
  if (spec) {
    buildRoof(b, spec, base);
  }
  if (spec && spec.sign && b.sign) {
    b.signH = spec.sign[2];
    b.signW = b.signH * (b.sign.width / b.sign.height);
    b.signU = b.at[0] + spec.sign[0];
    b.signV = b.at[1] - spec.sign[1];
  }
  // For the order of drawing: a number, the buildings this one hides in the
  // current frame, and what it covers on the screen.
  b.id = ++buildingCount;
  b.behind = [];
  b.drawn = false;
  b.sx0 = b.sy0 = b.sx1 = b.sy1 = 0;
  if (k !== 'o') {
    gridAdd(buildingGrid, b, b.x0 - 3, b.y0 - 3, b.x1 + 3, b.y1 + 3);
  }
}

{
  // Not on the map, so made up: Röckelein's yard with silos and stacks of
  // concrete slabs
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
  const streetOf = (cx, cy, reach = 32) => {
    let found = null;
    let far = reach;
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
  for (const b of BUILD) {
    // every house remembers its street
    if (b.k !== 'h' || b.a < 50 || b.a > 420) {
      continue;
    }
    const n = b.p.length / 2;
    const cx = b.p.reduce((sum, v, i) => (i % 2 ? sum : sum + v), 0) / n;
    const cy = b.p.reduce((sum, v, i) => (i % 2 ? sum + v : sum), 0) / n;
    b.rd = streetOf(cx, cy);
  }
  // Which building is which landmark: the one the place stands in, or the
  // nearest one.
  const named = new Set([...Object.keys(SIGNS), ...Object.keys(LANDMARKS)]);
  for (const key of named) {
    const [x, y] = MAP.pois[key];
    let best = null;
    let bestAt = null;
    let bd = 60;
    for (const b of BUILD) {
      if (!'himyc'.includes(b.k)) {
        continue;
      }
      const n = b.p.length / 2;
      const cx = b.p.reduce((sum, v, i) => (i % 2 ? sum : sum + v), 0) / n;
      const cy = b.p.reduce((sum, v, i) => (i % 2 ? sum + v : sum), 0) / n;
      const d = pip(x, y, b.p) ? 0 : Math.hypot(cx - x, cy - y);
      if (d < bd) {
        bd = d;
        best = b;
        bestAt = [cx, cy];
      }
    }
    if (best) {
      best.poi = key;
      best.label = SIGNS[key];
      // A place with a name is somebody's house, even where the survey files
      // it under barns.
      best.k = best.k === 'y' ? 'h' : best.k;
      best.rd = best.rd || streetOf(bestAt[0], bestAt[1], 70);
    }
  }
}
{
  const r = rng(42);
  for (const b of BUILD) {
    prepBuilding(b, r);
  }
  // A square tower on a building, given in the building's own frame.
  const tower = (b, u, v, half, h, k) => {
    const x = b.mx + u * b.ca - v * b.sa;
    const y = b.my + u * b.sa + v * b.ca;
    const q = [];
    for (const [du, dv] of [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ]) {
      q.push(x + du * b.ca - dv * b.sa, y + du * b.sa + dv * b.ca);
    }
    const t = {p: q, h, a: 4 * half * half, k};
    BUILD.push(t);
    prepBuilding(t, r);
  };
  for (const b of [...BUILD]) {
    if (b.poi === 'firestation' && b.rd) {
      // The hose tower stands at the back, away from the street.
      const street = (b.rd[1] - b.my) * b.ca - (b.rd[0] - b.mx) * b.sa;
      tower(b, b.u1 - 2.2, street > 0 ? b.v0 + 2.2 : b.v1 - 2.2, 1.8, 14, 'w');
    }
  }
}
// A tower stands on a building: its walls start on that roof.
for (const b of BUILD) {
  b.on = at(buildingGrid, b.mx, b.my).find(
    o => o !== b && o.a > b.a * 2 && pip(b.mx, b.my, o.p)
  );
}
export const OPEN_ROOFS = BUILD.filter(b => b.k === 'o');

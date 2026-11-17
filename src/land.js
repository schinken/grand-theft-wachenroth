/**
 * @fileoverview The land: areas, roads, the road network of junctions and
 * links, and what the ground is like at a point.
 */

import {MAP} from '../map.js';
import {pip} from './geometry.js';
import {textures} from './textures.js';
import {
  EDGE,
  WORLD_H,
  WORLD_W,
  canvas,
  clamp,
  dist,
  lerp,
  rng,
} from './util.js';

/**
 * Adds what drawing and collisions need to a polygon: path, bounding box, area
 * and a local frame along its longest edge.
 * @param {!Object} o An area or building with its outline in `p`.
 * @param {number=} ridge For a roof whose ridge was surveyed: the direction
 *     it runs in, in degrees. The frame follows it, also across the longest
 *     edge.
 */
export function prepPoly(o, ridge) {
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
  // a local frame along the longest edge, or across it where the ridge runs
  // that way; text in it reads upright
  const across =
    ridge !== undefined &&
    Math.abs(Math.sin((ridge * Math.PI) / 180 - o.ang)) > Math.SQRT1_2;
  const a = Math.atan(Math.tan(o.ang + (across ? Math.PI / 2 : 0)));
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

export const AREAS = MAP.areas;
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
  // School grounds and playgrounds are lawn; the photo adds what is paved
  // there, paintPlayground() the sand and what children play on.
  a.fill =
    a.k === 'farm'
      ? FARM[i % 4]
      : a.k === 'pitch'
        ? null
        : textures[a.k === 'school' || a.k === 'play' ? 'resi' : a.k];
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

export const DRIVE = [
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
];
const FOOT = ['path', 'footway', 'steps', 'cycleway'];
// A street with a name, so it has pavements and people
export const town = r => r.n && !/^(St|ERH|BA) /.test(r.n);
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
// A service road with a street name is a lane across a paved square: it has
// no kerb and no pavement of its own. The only one runs past the town hall.
const lane = r => r.t === 'service' && town(r);
export const ROADS = {
  river: layer(is('river')),
  bank: layer(is('river'), 2.5),
  stream: layer(is('stream', 'ditch', 'drain')),
  rail: layer(is('rail')),
  dirt: layer(is('track')),
  foot: layer(r => FOOT.includes(r.t)),
  kerb: layer(r => DRIVE.includes(r.t) && !town(r), 0.8),
  walk: layer(r => DRIVE.includes(r.t) && town(r) && !lane(r), 3.4),
  road: layer(r => DRIVE.includes(r.t) && r.t !== 'living_street' && !lane(r)),
  cobble: layer(is('living_street')),
  lane: layer(lane),
  line: layer(is('secondary', 'tertiary')),
};

// Road graph: `car` links carry the through traffic, `gps` links are everything
// you can drive, `walk` is for people.
export const NODES = [];
export const LINKS = [];
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
    if (['park', 'ind', 'com', 'yard'].includes(a.k)) {
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
export function surfAt(x, y) {
  const ix = (x + EDGE) >> 1;
  const iy = (y + EDGE) >> 1;
  return ix < 0 || iy < 0 || ix >= SURF_W || iy >= SURF_H
    ? 0
    : SURF[iy * SURF_W + ix];
}

// The height of the ground every 16 m, row by row from the north-west corner,
// in decimetres above the lowest point of the map: the state's terrain model.
const HILLS = MAP.hills;
// The hills are drawn and felt this many times as steep as they are: the
// streets rise 2 m in 100, which nobody would notice from a helicopter.
export const STEEP = 2.5;

/**
 * How high the ground is at a point, on straight slopes between the heights
 * of the map. Beyond its edge the land runs on level.
 * @param {number} x
 * @param {number} y
 * @return {number} Metres above the lowest point of the map.
 */
export function heightAt(x, y) {
  const z = HILLS.z;
  const w = HILLS.w;
  const u = clamp(x / HILLS.cell, 0, w - 1.001);
  const v = clamp(y / HILLS.cell, 0, z.length / w - 1.001);
  const i = (v | 0) * w + (u | 0);
  const north = lerp(z[i], z[i + 1], u % 1);
  const south = lerp(z[i + w], z[i + w + 1], u % 1);
  return lerp(north, south, v % 1) / 10;
}

// Every stretch of road: [ax, ay, bx, by, width, length, road].
export const SEGS = [];
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
export const SEG_MAX = Math.max(...SEGS.map(s => s[5]));

'use strict';
// Grand Theft Wachenroth: a top-down crime caper on the real street map of Wachenroth.
// World units are metres, y points south. MAP comes from map.js (see tools/osm2map.py),
// MISSIONS and PLACES from missions.js, AUDIO from audio.js.

const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const TAU = Math.PI * 2, PPM = 8, W = MAP.w, H = MAP.h, EDGE = 80;
const DEBUG = location.search.includes('debug');
let VW = 800, VH = 450;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const canvas = (w, h) => Object.assign(document.createElement('canvas'), {width: w, height: h});
const shade = (hex, f) => '#' + [1, 3, 5].map(i =>
  clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * f), 0, 255).toString(16).padStart(2, '0')).join('');

function rng(seed) { // mulberry32, so the scenery is the same on every load
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- geometry

function nearest(x, y, ax, ay, bx, by) { // closest point to (x, y) on segment a-b
  const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return [ax + dx * t, ay + dy * t];
}

function pip(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  return inside;
}

// Circle vs polygon: [nx, ny, depth] that pushes the circle out, or null when they do not touch.
function pushOut(x, y, r, p) {
  let best = 1e9, qx = 0, qy = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const q = nearest(x, y, p[j], p[j + 1], p[i], p[i + 1]), d = (x - q[0]) ** 2 + (y - q[1]) ** 2;
    if (d < best) { best = d; qx = q[0]; qy = q[1]; }
  }
  const d = Math.sqrt(best), inside = pip(x, y, p);
  if (!inside && d >= r) return null;
  const nx = (x - qx) / (d || 1), ny = (y - qy) / (d || 1);
  return inside ? [-nx, -ny, d + r] : [nx, ny, r - d];
}

// Uniform grid for buildings and trees.
const CELL = 40, GX = Math.ceil(W / CELL) + 4, GY = Math.ceil(H / CELL) + 4;
const cell = (v, n) => clamp(Math.floor(v / CELL) + 2, 0, n - 1);
const grid = () => Array.from({length: GX * GY}, () => []);
const at = (g, x, y) => g[cell(y, GY) * GX + cell(x, GX)];
function gridAdd(g, o, x0, y0, x1, y1) {
  for (let y = cell(y0, GY); y <= cell(y1, GY); y++) for (let x = cell(x0, GX); x <= cell(x1, GX); x++) g[y * GX + x].push(o);
}
let stamp = 0;
function gridFind(g, x0, y0, x1, y1) {
  const out = [];
  stamp++;
  for (let y = cell(y0, GY); y <= cell(y1, GY); y++) for (let x = cell(x0, GX); x <= cell(x1, GX); x++)
    for (const o of g[y * GX + x]) if (o.stamp !== stamp) { o.stamp = stamp; out.push(o); }
  return out;
}

// ---------- textures (all drawn here, 8 px per metre)

function tex(base, draw) {
  const c = canvas(64, 64), g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  if (draw) draw(g, rng(parseInt(base.slice(1), 16)));
  const p = ctx.createPattern(c, 'repeat');
  p.setTransform(new DOMMatrix().scaleSelf(1 / PPM));
  return p;
}
function dots(g, r, n, cols, w = 1) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[r() * cols.length | 0];
    g.fillRect(r() * 64 | 0, r() * 64 | 0, w + (r() * 2 | 0), 1);
  }
}
const rows = (base, line, speck) => tex(base, (g, r) => {
  g.fillStyle = line;
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 64, 1);
  dots(g, r, 150, speck);
});
const tiles = (base, dark, light) => tex(base, (g, r) => { // roof tiles, rows run along the ridge
  for (let y = 0; y < 64; y += 4) {
    g.fillStyle = dark;
    g.fillRect(0, y, 64, 1);
    for (let x = (y / 4 % 2) * 3; x < 64; x += 6) {
      g.fillStyle = r() < .3 ? light : dark;
      g.fillRect(x, y + 1, 1, 3);
    }
  }
});
const slabs = (base, line, speck, step) => tex(base, (g, r) => {
  dots(g, r, 260, speck);
  g.fillStyle = line;
  for (let i = 0; i < 64; i += step) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
});
const sheet = (base, line, step) => tex(base, g => { // corrugated metal, ribs run down the slope
  g.fillStyle = line;
  for (let x = 0; x < 64; x += step) g.fillRect(x, 0, 1, 64);
});

const TEX = {
  grass: tex('#417a2e', (g, r) => dots(g, r, 700, ['#39702a', '#4a8634', '#346826', '#52913a'])),
  meadow: tex('#5b9440', (g, r) => dots(g, r, 500, ['#538a3a', '#66a048', '#6fa84e', '#4c8236'])),
  forest: tex('#2c4f22', (g, r) => dots(g, r, 600, ['#25441c', '#335a27', '#1f3b18'], 2)),
  scrub: tex('#4b7a34', (g, r) => dots(g, r, 500, ['#3c6829', '#5a8a3c', '#34591f'], 2)),
  orchard: tex('#55903c', (g, r) => dots(g, r, 400, ['#4c8236', '#63a046', '#467a30'])),
  resi: tex('#4d8436', (g, r) => { dots(g, r, 500, ['#447a30', '#57903d', '#3e7029']); dots(g, r, 14, ['#e8e06a', '#f2f2e6', '#d86a8a']); }),
  ind: slabs('#8b8b86', '#7b7b76', ['#84847f', '#93938e', '#7e7e79'], 32),
  com: slabs('#9c9a92', '#8c8a82', ['#94928a', '#a6a49c'], 16),
  school: slabs('#b3a98f', '#a09679', ['#a99f85', '#bdb399'], 8),
  yard: tex('#94896c', (g, r) => dots(g, r, 600, ['#857a5e', '#a39878', '#7a7056', '#8b8b86'], 2)),
  dump: tex('#8d867a', (g, r) => dots(g, r, 700, ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9', '#5a564e'], 2)),
  cem: tex('#467a34', (g, r) => {
    dots(g, r, 400, ['#3e7029', '#52913a']);
    for (let y = 6; y < 64; y += 16) for (let x = 4 + (y % 32 ? 8 : 0); x < 60; x += 16) {
      g.fillStyle = '#5b4a3a'; g.fillRect(x, y + 4, 6, 8);
      g.fillStyle = r() < .5 ? '#b9b9b4' : '#8f8f8a'; g.fillRect(x + 1, y, 4, 3);
    }
  }),
  constr: tex('#9a8662', (g, r) => dots(g, r, 500, ['#8a7654', '#a8946e', '#7c6a4a'], 2)),
  park: tex('#58585d', (g, r) => dots(g, r, 400, ['#505055', '#606065', '#4a4a4f'])),
  play: tex('#c9b27a', (g, r) => dots(g, r, 300, ['#bba46c', '#d6c08a'])),
  clay: tex('#b5573a', (g, r) => dots(g, r, 300, ['#a84e33', '#c06343'])),
  water: tex('#2d6190', (g, r) => { g.fillStyle = '#4079aa'; for (let i = 0; i < 40; i++) g.fillRect(r() * 60 | 0, r() * 64 | 0, 5, 1); }),
  farmA: rows('#9a8d45', '#877a39', ['#a89a50', '#8f823f']),
  farmB: rows('#6f5637', '#5f482c', ['#7b6140', '#584226']),
  farmC: rows('#57892f', '#487626', ['#629636', '#3f6a20']),
  farmD: rows('#c2a84c', '#a89040', ['#d0b85a', '#b39a44']),
  asphalt: tex('#48484d', (g, r) => dots(g, r, 600, ['#404045', '#505056', '#3a3a3f', '#57575c'])),
  cobble: tex('#8a867c', (g, r) => {
    g.fillStyle = '#726e66';
    for (let y = 0; y < 64; y += 4) { g.fillRect(0, y, 64, 1); for (let x = (y / 4 % 2) * 4; x < 64; x += 8) g.fillRect(x, y, 1, 4); }
    dots(g, r, 120, ['#98948a', '#7e7a70']);
  }),
  sidewalk: slabs('#a09f97', '#8a8981', ['#96958d', '#aaa9a1'], 8),
  dirt: tex('#8b7350', (g, r) => dots(g, r, 500, ['#7d6645', '#99815c', '#735d3e'], 2)),
  gravel: tex('#7d776c', (g, r) => dots(g, r, 600, ['#6c675d', '#8f897d', '#5f5a51'])),
  tile1: tiles('#a5432b', '#8a3421', '#b8553a'),
  tile2: tiles('#b5622f', '#964c20', '#c8773f'),
  tile3: tiles('#7c3c2b', '#652e20', '#8f4a36'),
  tile4: tiles('#93382a', '#7a2b1f', '#a84a38'),
  slate: tiles('#4a4e57', '#3c4048', '#5a5e68'),
  metal: sheet('#9aa0a6', '#858b92', 4),
  metalRed: sheet('#8a4a3c', '#753c30', 4),
  tar: tex('#55565a', (g, r) => dots(g, r, 400, ['#4c4d51', '#5e5f63'], 2)),
  flat: tex('#7e7f84', (g, r) => { dots(g, r, 500, ['#74757a', '#88898e', '#6c6d72'], 2); g.fillStyle = '#5f6065'; g.fillRect(40, 12, 5, 5); }),
  flatLight: slabs('#a8aab0', '#989aa0', ['#9ea0a6', '#b2b4ba'], 32),
  concrete: tex('#b4b4ae', (g, r) => dots(g, r, 300, ['#a8a8a2', '#c0c0ba'], 2)),
  solar: tex('#9a9ca2', g => {
    for (let y = 2; y < 64; y += 16) for (let x = 1; x < 64; x += 16) {
      g.fillStyle = '#1d2c4d'; g.fillRect(x, y, 14, 11);
      g.fillStyle = '#31497a'; g.fillRect(x, y, 14, 1); g.fillRect(x + 7, y, 1, 11);
    }
  }),
};

// Tree canopies as little pixel blobs.
const CANOPY = [['#1f4a1c', '#2c6425', '#3b7d2e', '#4f9438'], ['#24521f', '#327029', '#44883a', '#5c9f45'],
  ['#2a4a16', '#3e6a1e', '#557f28', '#6f9932']].map((cols, n) => {
  const c = canvas(40, 40), g = c.getContext('2d'), r = rng(90 + n);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 12 - k * 2; i++) {
    const a = r() * TAU, d = r() * (13 - k * 3.4);
    g.fillStyle = cols[k];
    g.beginPath();
    g.arc(20 + Math.cos(a) * d - k * 1.5, 20 + Math.sin(a) * d - k * 1.5, 6 - k, 0, TAU);
    g.fill();
  }
  return c;
});

// ---------- world

function prepPoly(o) { // path, bounding box, area and the direction of the longest edge
  const p = o.p;
  o.path = new Path2D();
  o.x0 = o.y0 = 1e9; o.x1 = o.y1 = -1e9; o.area = 0;
  let len = 0;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1], j = (i + 2) % p.length, ex = p[j] - x, ey = p[j + 1] - y;
    if (i) o.path.lineTo(x, y); else o.path.moveTo(x, y);
    o.x0 = Math.min(o.x0, x); o.y0 = Math.min(o.y0, y); o.x1 = Math.max(o.x1, x); o.y1 = Math.max(o.y1, y);
    o.area += (x * p[j + 1] - p[j] * y) / 2;
    if (ex * ex + ey * ey > len) { len = ex * ex + ey * ey; o.ang = Math.atan2(ey, ex); }
  }
  o.path.closePath();
  o.mx = (o.x0 + o.x1) / 2; o.my = (o.y0 + o.y1) / 2;
  // a local frame along the longest edge, text in it reads upright
  const a = Math.abs(o.ang) > Math.PI / 2 ? o.ang - Math.sign(o.ang) * Math.PI : o.ang;
  o.ca = Math.cos(a); o.sa = Math.sin(a);
  o.lp = [];
  o.u0 = o.v0 = 1e9; o.u1 = o.v1 = -1e9;
  for (let i = 0; i < p.length; i += 2) {
    const u = (p[i] - o.mx) * o.ca + (p[i + 1] - o.my) * o.sa, v = (p[i + 1] - o.my) * o.ca - (p[i] - o.mx) * o.sa;
    o.lp.push(u, v);
    o.u0 = Math.min(o.u0, u); o.u1 = Math.max(o.u1, u); o.v0 = Math.min(o.v0, v); o.v1 = Math.max(o.v1, v);
  }
}
const local = o => ctx.transform(o.ca, o.sa, -o.sa, o.ca, o.mx, o.my);

const AREAS = MAP.areas, FARM = [TEX.farmA, TEX.farmB, TEX.farmC, TEX.farmD];
AREAS.forEach((a, i) => {
  prepPoly(a);
  a.fill = a.k === 'farm' ? FARM[i % 4] : a.k === 'pitch' ? null : TEX[a.k];
});

const DRIVE = ['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
const FOOT = ['path', 'footway', 'steps', 'cycleway'];
const town = r => r.n && !/^(St|ERH|BA) /.test(r.n); // a street with a name, so it has pavements and people
for (const r of MAP.roads) {
  r.path = new Path2D();
  for (let i = 0; i < r.p.length; i += 2) if (i) r.path.lineTo(r.p[i], r.p[i + 1]); else r.path.moveTo(r.p[i], r.p[i + 1]);
}
function layer(ok, extra = 0) { // one path per stroke width
  const out = new Map();
  for (const r of MAP.roads) if (ok(r)) {
    if (!out.has(r.w + extra)) out.set(r.w + extra, new Path2D());
    out.get(r.w + extra).addPath(r.path);
  }
  return [...out];
}
const is = (...types) => r => types.includes(r.t);
const ROADS = {
  river: layer(is('river')), bank: layer(is('river'), 2.5), stream: layer(is('stream', 'ditch', 'drain')),
  rail: layer(is('rail')), dirt: layer(is('track')), foot: layer(r => FOOT.includes(r.t)),
  kerb: layer(r => DRIVE.includes(r.t) && !town(r), .8), walk: layer(r => DRIVE.includes(r.t) && town(r), 3.4),
  road: layer(r => DRIVE.includes(r.t) && r.t !== 'living_street'), cobble: layer(is('living_street')),
  line: layer(is('secondary', 'tertiary')),
};

// Road graph: `car` links carry the through traffic, `gps` links are everything you can drive, `walk` is for people.
const NODES = [], LINKS = [];
for (let i = 0; i < MAP.nodes.length; i += 2) NODES.push({x: MAP.nodes[i], y: MAP.nodes[i + 1], w: 0, car: [], walk: [], gps: []});
for (let i = 0; i < MAP.edges.length; i += 4) {
  const a = MAP.edges[i], b = MAP.edges[i + 1], road = MAP.roads[MAP.edges[i + 2]], f = MAP.edges[i + 3], len = dist(NODES[a], NODES[b]);
  if (f & 2) { NODES[a].car.push({n: b, w: road.w}); if (!(f & 4)) NODES[b].car.push({n: a, w: road.w}); }
  if (f & 9) { NODES[a].gps.push({n: b, len}); NODES[b].gps.push({n: a, len}); LINKS.push([a, b]); }
  if (town(road) || FOOT.includes(road.t)) { NODES[a].walk.push(b); NODES[b].walk.push(a); }
  NODES[a].w = Math.max(NODES[a].w, road.w); NODES[b].w = Math.max(NODES[b].w, road.w);
}

// Low-res ground lookup, 2 m per cell. Bits: 1 = hard surface, 2 = passage under a building, 4 = road, 8 = deep water.
const SW = (W + 2 * EDGE) >> 1, SH = (H + 2 * EDGE) >> 1;
const SURF = (() => {
  const sheet = () => {
    const g = canvas(SW, SH).getContext('2d', {willReadFrequently: true});
    g.setTransform(.5, 0, 0, .5, EDGE / 2, EDGE / 2);
    g.lineJoin = g.lineCap = 'round';
    return g;
  };
  const g = sheet(), w = sheet();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = '#f00';
  for (const a of AREAS) if (['park', 'ind', 'com', 'school', 'yard'].includes(a.k)) g.fill(a.path);
  w.fillStyle = w.strokeStyle = '#fff';
  for (const a of AREAS) if (a.k === 'water') w.fill(a.path);
  for (const r of MAP.roads) if (r.t === 'river') { w.lineWidth = r.w - 1.5; w.stroke(r.path); }
  w.strokeStyle = '#000';
  for (const r of MAP.roads) {
    const road = DRIVE.includes(r.t), way = road || r.t === 'track' || FOOT.includes(r.t);
    if (way) { w.lineWidth = r.w + 5; w.stroke(r.path); } // every road and path bridges the water
    if (!road && r.t !== 'track') continue;
    g.lineWidth = r.w + (road ? 4 : 1); g.strokeStyle = '#f00'; g.stroke(r.path); // kerbs and pavements are hard ground too
    if (!road) continue;
    g.lineWidth = r.w + 1; g.strokeStyle = r.u ? '#0ff' : '#00f'; g.stroke(r.path);
  }
  const d = g.getImageData(0, 0, SW, SH).data, dw = w.getImageData(0, 0, SW, SH).data, out = new Uint8Array(SW * SH);
  for (let i = 0; i < out.length; i++)
    out[i] = (d[i * 4] > 99) | (d[i * 4 + 1] > 99) << 1 | (d[i * 4 + 2] > 99) << 2 | (dw[i * 4] > 140) << 3;
  return out;
})();
function surfAt(x, y) {
  const ix = (x + EDGE) >> 1, iy = (y + EDGE) >> 1;
  return ix < 0 || iy < 0 || ix >= SW || iy >= SH ? 0 : SURF[iy * SW + ix];
}

// ---------- buildings: walls lean away from the camera, roofs get a ridge and two slopes

const BUILD = MAP.buildings, BG = grid(), LIGHT = [.6, .8]; // faces turned south-east lie in shadow
const WALLS = {
  h: ['#e8dfc8', '#f1ead8', '#d9c9a4', '#e3d0c0', '#f0e6b8', '#efe9df', '#dfe3d8', '#e6c79c', '#d6b596'],
  y: ['#cdbf9f', '#b99f7a', '#8f7152', '#d9cfb8'], i: ['#c8ccd2', '#d9dbde', '#b7bcc4', '#c4c8bc'],
  g: ['#d8d4c8', '#c9c5b9', '#e2ddd0'], m: ['#ece8dc'], c: ['#ece2c6'], s: ['#bdbdb6'], o: ['#8a8d92'], t: ['#ece2c6'],
};
function ridge(b, rise) { // split the outline along its long axis into the two slopes of a gable roof
  const mid = (b.v0 + b.v1) / 2, lp = b.lp, n = lp.length;
  b.halves = [[], []]; b.gables = [];
  for (let i = 0, k = 0; i < n; i += 2, k++) {
    const j = (i + 2) % n, da = lp[i + 1] - mid, db = lp[j + 1] - mid;
    b.halves[da >= 0 ? 0 : 1].push(lp[i], lp[i + 1], 0);
    if ((da >= 0) === (db >= 0)) continue;
    const t = da / (da - db), x = lp[i] + (lp[j] - lp[i]) * t;
    b.halves[0].push(x, mid, 1); b.halves[1].push(x, mid, 1);
    b.gables.push([k, lp[i], lp[i + 1], x, mid, lp[j], lp[j + 1]]);
  }
  b.rh = rise;
  const lit = -b.sa * LIGHT[0] + b.ca * LIGHT[1]; // how much the first slope faces the dark side
  b.tint = [lit, -lit].map(v => v > 0 ? `rgba(0,0,0,${(.3 * v).toFixed(2)})` : `rgba(255,240,210,${(-.18 * v).toFixed(2)})`);
  const xs = b.gables.map(g => g[3]);
  b.rx0 = Math.min(...xs); b.rx1 = Math.max(...xs); b.ry = mid;
}
function prepBuilding(b, r) {
  prepPoly(b);
  const base = pick2(WALLS[b.k] || WALLS.h, r), wide = b.v1 - b.v0;
  b.nx = []; b.ny = []; b.wall = [];
  for (let i = 0; i < b.p.length; i += 2) {
    const j = (i + 2) % b.p.length, ex = b.p[j] - b.p[i], ey = b.p[j + 1] - b.p[i + 1], l = Math.hypot(ex, ey) || 1;
    b.nx.push(ey / l); b.ny.push(-ex / l); // outward, polygons are clockwise
    b.wall.push(shade(base, .78 - .22 * (ey / l * LIGHT[0] - ex / l * LIGHT[1])));
  }
  b.lpath = new Path2D();
  for (let i = 0; i < b.lp.length; i += 2) if (i) b.lpath.lineTo(b.lp[i], b.lp[i + 1]); else b.lpath.moveTo(b.lp[i], b.lp[i + 1]);
  b.lpath.closePath();
  const k = b.k, big = b.a > 900, v = r();
  let gable = b.p.length <= 28 && wide > 2.5;
  if (k === 's' || k === 't') { b.roof = k === 's' ? TEX.concrete : TEX.slate; b.apex = k === 's' ? 2 : 9; gable = false; }
  else if (k === 'o') { b.roof = TEX.flatLight; gable = false; }
  else if (k === 'c') b.roof = TEX.slate;
  else if (k === 'm') { b.roof = b.a > 1500 ? TEX.flatLight : TEX.flat; gable = false; }
  else if (k === 'i') { b.roof = big ? [TEX.solar, TEX.flatLight, TEX.metal, TEX.flat][v * 4 | 0] : TEX.metal; gable = !big || b.roof === TEX.metal; }
  else if (k === 'g') { b.roof = v < .5 ? TEX.tar : v < .75 ? TEX.flat : TEX.tile3; gable = gable && v >= .75; }
  else if (k === 'y') b.roof = b.a > 350 ? [TEX.metalRed, TEX.metal, TEX.tile3][v * 3 | 0] : [TEX.tile3, TEX.tile2, TEX.tile4][v * 3 | 0];
  else if (big) { b.roof = v < .5 ? TEX.flat : TEX.flatLight; gable = false; }
  else b.roof = b.a > 350 ? [TEX.tile3, TEX.tile4, TEX.metalRed, TEX.slate][v * 4 | 0] : [TEX.tile1, TEX.tile1, TEX.tile2, TEX.tile4, TEX.tile3, TEX.slate][v * 6 | 0];
  const metal = b.roof === TEX.metal || b.roof === TEX.metalRed;
  if (gable) ridge(b, k === 'c' ? clamp(wide * .45, 2, 6) : clamp(wide * (metal ? .14 : .27), .7, 3.4));
  if (b.halves && b.gables.length < 2) b.halves = null;
  if (b.halves && k === 'h' && b.a > 60) b.chim = [lerp(b.rx0, b.rx1, .25 + r() * .5), b.ry + (r() < .5 ? -1 : 1)];
  if (b.halves && k === 'h' && b.a > 80 && r() < .22) b.pv = r() < .5 ? 0 : 1; // solar panels on one slope
  if (!b.halves && !b.apex && b.a > 400 && k !== 'o') // vents and air conditioning on flat roofs
    b.units = Array.from({length: Math.min(6, b.a / 500 | 0) + 1}, () => [lerp(b.u0, b.u1, .15 + r() * .7), lerp(b.v0, b.v1, .2 + r() * .6), 1.5 + r() * 2]);
  b.floors = clamp(Math.round(b.h / 3), 1, 3);
  if (k !== 'o') gridAdd(BG, b, b.x0 - 3, b.y0 - 3, b.x1 + 3, b.y1 + 3);
}
const pick2 = (a, r) => a[r() * a.length | 0];
{
  const r = rng(42);
  for (const b of [...BUILD]) {
    prepBuilding(b, r);
    if (b.k !== 'c' || b.a < 250) continue;
    // every church gets a tower at its western end
    const west = b.ca > 0 ? b.u0 + 3.4 : b.u1 - 3.4, cx = b.mx + west * b.ca, cy = b.my + west * b.sa, q = [];
    for (const [u, v] of [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4]]) q.push(cx + u * b.ca - v * b.sa, cy + u * b.sa + v * b.ca);
    const t = {p: q, h: 15, a: 46, k: 't'};
    BUILD.push(t);
    prepBuilding(t, r);
  }
}
const SOLID = BUILD.filter(b => b.k !== 'o');

const TREES = [], TG = grid();
{
  const r = rng(3);
  const add = (tx, ty, size) => {
    if ([[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].some(o => surfAt(tx + o[0], ty + o[1]))) return;
    if (at(BG, tx, ty).some(b => pushOut(tx, ty, 3, b.p))) return;
    const t = {x: tx, y: ty, r: size + r() * 1.8, h: 4 + r() * 5, s: r() * 3 | 0};
    TREES.push(t);
    gridAdd(TG, t, tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6);
  };
  const plant = (a, step, chance, size, jitter = 1) => {
    for (let y = Math.max(a.y0, -EDGE); y < Math.min(a.y1, H + EDGE); y += step)
      for (let x = Math.max(a.x0, -EDGE); x < Math.min(a.x1, W + EDGE); x += step) {
        const tx = x + r() * step * jitter, ty = y + r() * step * jitter;
        if (r() < chance && pip(tx, ty, a.p)) add(tx, ty, size);
      }
  };
  for (const a of AREAS) {
    if (a.k === 'forest') plant(a, 9, .85, 2.4);
    if (a.k === 'scrub') plant(a, 11, .6, 1.6);
    if (a.k === 'resi') plant(a, 24, .45, 2);
    if (a.k === 'meadow') plant(a, 38, .25, 2.2);
    if (a.k === 'orchard') plant(a, 8, 1, 1.4, .2);
    if (a.k === 'cem') plant(a, 18, .5, 1.8);
  }
  for (let i = 0; i < MAP.trees.length; i += 2) add(MAP.trees[i], MAP.trees[i + 1], 2.4);
}
const HEDGES = new Path2D();
for (const h of MAP.hedges) for (let i = 0; i < h.length; i += 2) if (i) HEDGES.lineTo(h[i], h[i + 1]); else HEDGES.moveTo(h[i], h[i + 1]);

// Every stretch of road: [ax, ay, bx, by, width, length, drivable].
const SEGS = [];
for (const r of MAP.roads) if (DRIVE.includes(r.t) || r.t === 'track') for (let i = 0; i + 3 < r.p.length; i += 2)
  SEGS.push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.w, Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]), r]);
const SEGMAX = Math.max(...SEGS.map(s => s[5]));
const blocked = (x, y, r) => at(BG, x, y).some(b => pushOut(x, y, r, b.p));

// Where you pull up for a place: at the edge of the nearest road, on the side the place is on.
function roadside(x, y) {
  let best = 1e9, q = null, seg = null;
  for (const s of SEGS) {
    const p = nearest(x, y, s[0], s[1], s[2], s[3]), d = Math.hypot(x - p[0], y - p[1]);
    if (d < best) { best = d; q = p; seg = s; }
  }
  const a = Math.atan2(seg[3] - seg[1], seg[2] - seg[0]);
  for (let off = Math.min(best, seg[4] / 2 + 2); off > 0; off -= 1) {
    const sx = q[0] + (x - q[0]) / (best || 1) * off, sy = q[1] + (y - q[1]) / (best || 1) * off;
    if (!blocked(sx, sy, 2.2)) return {x: sx, y: sy, a};
  }
  return {x: q[0], y: q[1], a};
}
const SPOT = {};
for (const k in MAP.pois) SPOT[k] = Object.assign(roadside(...MAP.pois[k]), {key: k, name: PLACES[k] || k});

// Signs on the roofs of the big landmarks.
for (const [key, text] of Object.entries(SIGNS)) {
  const [x, y] = MAP.pois[key];
  let best = null, bd = 60;
  for (const b of SOLID) {
    const d = pip(x, y, b.p) ? 0 : Math.hypot(b.mx - x, b.my - y);
    if (d < bd && b.k !== 't') { bd = d; best = b; }
  }
  if (best) best.label = text;
}

// Road distance from every junction to one place, for the yellow arrow and the police.
function nearNode(o, links) {
  let best = 0, bd = 1e9;
  NODES.forEach((n, i) => {
    const d = dist(n, o);
    if (n[links].length && d < bd && n.x > 20 && n.y > 20 && n.x < W - 20 && n.y < H - 20) { bd = d; best = i; }
  });
  return best;
}
function nearLink(o) { // the stretch of road next to `o`: [link, x, y of the closest point on it]
  let best = 1e9, link = null, qx = 0, qy = 0;
  for (const l of LINKS) {
    const a = NODES[l[0]], b = NODES[l[1]], q = nearest(o.x, o.y, a.x, a.y, b.x, b.y), d = (o.x - q[0]) ** 2 + (o.y - q[1]) ** 2;
    if (d < best) { best = d; link = l; qx = q[0]; qy = q[1]; }
  }
  return [link, qx, qy];
}
function field(o) {
  const d = new Float32Array(NODES.length).fill(1e9), [link, x, y] = nearLink(o), q = [...link];
  for (const n of link) d[n] = Math.hypot(NODES[n].x - x, NODES[n].y - y);
  while (q.length) {
    const i = q.shift();
    for (const e of NODES[i].gps) if (d[i] + e.len < d[e.n]) { d[e.n] = d[i] + e.len; q.push(e.n); }
  }
  return d;
}
function downhill(f, n) { // the next junction on the shortest way to the field's origin
  let best = -1, cost = 1e9;
  for (const e of NODES[n].gps) if (f[e.n] < f[n] && f[e.n] + e.len < cost) { cost = f[e.n] + e.len; best = e.n; }
  return best;
}
function waypoint(f, o, ahead) { // the point `ahead` metres down the road from `o`, or null where no road leads on
  const [link, qx, qy] = nearLink(o), cost = n => f[n] + Math.hypot(NODES[n].x - qx, NODES[n].y - qy);
  let n = cost(link[0]) < cost(link[1]) ? link[0] : link[1], x = qx, y = qy;
  if (f[n] > 1e8) return null;
  for (let go = ahead; ;) {
    const N = NODES[n], d = Math.hypot(N.x - x, N.y - y);
    if (d >= go) return {x: x + (N.x - x) / d * go, y: y + (N.y - y) / d * go};
    go -= d; x = N.x; y = N.y;
    const m = downhill(f, n);
    if (m < 0) return {x, y};
    n = m;
  }
}

// ---------- sprites

const TYPES = {
  car: {name: ['Familienkutsche', 'Rostlaube', 'Dorfschleuder', 'Kombi vom Nachbarn'], L: 4.4, Wd: 2, max: 38, acc: 15, hp: 100, mass: 1},
  sport: {name: ['Sportflitzer', 'Angeberkarre'], L: 4.4, Wd: 2, max: 48, acc: 20, hp: 80, mass: .9},
  van: {name: ['Kastenwagen', 'Handwerkerbus'], L: 5.6, Wd: 2.3, max: 30, acc: 11, hp: 140, mass: 1.7},
  police: {name: ['Streifenwagen'], L: 4.6, Wd: 2, max: 45, acc: 19, hp: 150, mass: 1.1},
  tractor: {name: ['Bulldog'], L: 4.2, Wd: 2.3, max: 16, acc: 10, hp: 220, mass: 2.4},
  truck: {name: ['Bierlaster'], L: 7.4, Wd: 2.5, max: 27, acc: 9, hp: 230, mass: 3},
  kipper: {name: ['Kipper'], L: 7, Wd: 2.5, max: 26, acc: 9, hp: 250, mass: 3.2},
  mixer: {name: ['Betonmischer'], L: 7.8, Wd: 2.6, max: 25, acc: 8.5, hp: 280, mass: 4},
  fire: {name: ['Löschfahrzeug LF 16/12'], L: 7.2, Wd: 2.5, max: 33, acc: 12, hp: 280, mass: 3},
};
for (const T of Object.values(TYPES)) { // a row of collision circles along the body
  T.r = T.Wd / 2;
  const e = T.L / 2 - T.r;
  T.offs = T.L > 6 ? [e, 0, -e] : [e, -e];
}
const COLORS = ['#c8322b', '#2b62c8', '#e8e6df', '#22242a', '#2f8f4a', '#9aa2ad', '#d9651e', '#7a3fb0', '#e0b21c', '#6b4a2a'];
const PAINT = {police: '#d9dcdf', tractor: '#2e7d32', truck: '#2b62c8', kipper: '#284d98', mixer: '#284d98', fire: '#c8201c', van: '#eeeee8'};
const SPRITES = new Map();
function carSprite(kind, col, frame = 0) { // drawn nose-right; col 'wreck' gives the burnt-out shell
  const key = kind + col + frame;
  if (SPRITES.has(key)) return SPRITES.get(key);
  const T = TYPES[kind], w = Math.round(T.L * PPM), h = Math.round(T.Wd * PPM), c = canvas(w, h), g = c.getContext('2d');
  const R = (x, y, ww, hh, f) => { g.fillStyle = f; g.fillRect(x, y, ww, hh); };
  const wreck = col === 'wreck', body = wreck ? '#2b2724' : col, glass = wreck ? '#141210' : '#182533', mid = h >> 1;
  const paint = f => wreck ? shade('#2b2724', .8 + (parseInt(f.slice(1, 3), 16) % 5) / 12) : f;
  const box = (x0, x1, f) => { // a rounded, outlined slab from x0 to x1
    R(x0 + 2, 0, x1 - x0 - 4, h, '#0b0b0d'); R(x0, 2, x1 - x0, h - 4, '#0b0b0d'); R(x0 + 1, 1, x1 - x0 - 2, h - 2, '#0b0b0d');
    R(x0 + 2, 1, x1 - x0 - 4, h - 2, f); R(x0 + 1, 2, x1 - x0 - 2, h - 4, f);
    R(x0 + 3, 1, x1 - x0 - 6, 1, shade(f, 1.25)); R(x0 + 3, h - 2, x1 - x0 - 6, 1, shade(f, .7));
  };
  const cab = len => { box(w - len, w, body); R(w - len + 5, 2, 4, h - 4, glass); R(w - len + 1, 3, 4, h - 6, shade(body, 1.1)); };
  const lamps = () => { if (!wreck) { R(w - 2, 2, 1, 3, '#ffe9a0'); R(w - 2, h - 5, 1, 3, '#ffe9a0'); R(1, 2, 1, 3, '#e02a2a'); R(1, h - 5, 1, 3, '#e02a2a'); } };
  if (kind === 'car' || kind === 'sport' || kind === 'police') {
    const a = Math.round(w * .2), b = Math.round(w * .6);
    box(0, w, body);
    if (kind === 'sport' && !wreck) R(2, mid - 1, w - 4, 2, '#f4f4ef');
    R(a, 2, b - a + 5, h - 4, glass);
    R(a + 3, 3, b - a - 3, h - 6, shade(body, 1.12));
    if (kind === 'sport' && !wreck) R(a + 3, mid - 1, b - a - 3, 2, '#f4f4ef');
    if (kind === 'police' && !wreck) {
      R(3, 1, w - 6, 2, '#1f5fbf'); R(3, h - 3, w - 6, 2, '#1f5fbf'); R(w - 9, 3, 6, h - 6, '#1f5fbf');
      R(a + 7, 3, 3, h - 6, '#cfd8e6');
    }
  } else if (kind === 'van') {
    box(0, w, body);
    R(w - 12, 2, 5, h - 4, glass);
    R(3, 2, w - 17, h - 4, shade(body, 1.06));
    if (!wreck) R(3, mid - 1, w - 17, 3, COLORS[frame % COLORS.length]); // company stripe
  } else if (kind === 'tractor') {
    R(1, 0, 12, 5, '#101012'); R(1, h - 5, 12, 5, '#101012'); R(w - 10, 1, 7, 3, '#101012'); R(w - 10, h - 4, 7, 3, '#101012');
    R(5, 4, w - 7, h - 8, '#0b0b0d'); R(6, 5, w - 9, h - 10, body);
    R(w - 13, 6, 10, h - 12, shade(body, 1.15)); R(w - 4, 6, 1, h - 12, '#333');
    R(5, 3, 13, h - 6, '#0b0b0d'); R(6, 4, 11, h - 8, glass); R(8, 6, 7, h - 12, shade(body, .8));
    R(w - 15, 5, 2, 2, '#444');
  } else if (kind === 'truck') {
    box(0, w - 14, paint('#efe6cc'));
    if (!wreck) {
      R(3, mid - 3, w - 20, 6, '#d99a1a'); R(3, mid - 1, w - 20, 2, '#f6efd9');
      for (let x = 7; x < w - 20; x += 8) R(x, 2, 1, h - 4, '#d6ccae');
    }
    cab(15);
  } else if (kind === 'kipper') {
    box(0, w - 14, paint('#6c6f76'));
    R(3, 3, w - 20, h - 6, paint('#8d867a'));
    if (!wreck) for (let i = 0; i < 40; i++) R(3 + (i * 37) % (w - 21), 3 + (i * 53) % (h - 7), 2, 1, ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9'][i % 4]);
    cab(15);
  } else if (kind === 'mixer') {
    const dw = w - 21, drum = paint('#d8d8d2');
    R(2, 3, w - 16, h - 6, '#26262a');
    R(5, 1, dw - 4, h - 2, '#0b0b0d'); R(3, 3, dw, h - 6, '#0b0b0d');
    R(5, 2, dw - 4, h - 4, drum); R(4, 4, dw - 2, h - 8, drum);
    if (!wreck) for (let x = -4 + frame * 2; x < dw; x += 8) for (let y = 2; y < h - 2; y++) { // the spiral on the drum turns
      const xx = 3 + x + (y >> 1);
      if (xx > 4 && xx < dw + 1 && (y > 3 && y < h - 4 || xx > 5 && xx < dw - 1)) R(xx, y, 2, 1, body);
    }
    R(5, 2, dw - 4, 1, shade(drum, 1.1));
    R(dw + 2, mid - 2, 3, 4, '#55565a');
    cab(15);
  } else if (kind === 'fire') {
    box(0, w, body);
    if (!wreck) {
      R(3, 1, w - 20, 3, '#c4c7cc'); R(3, h - 4, w - 20, 3, '#c4c7cc');
      for (let x = 8; x < w - 18; x += 6) { R(x, 1, 1, 3, '#8d9096'); R(x, h - 4, 1, 3, '#8d9096'); }
      R(5, mid - 3, w - 24, 1, '#e6e6e0'); R(5, mid + 2, w - 24, 1, '#e6e6e0');
      for (let x = 6; x < w - 20; x += 3) R(x, mid - 2, 1, 4, '#e6e6e0');
      R(w - 17, 1, 2, h - 2, '#f4f4ef');
    }
    R(w - 10, 2, 5, h - 4, glass); R(w - 14, 3, 3, h - 6, shade(body, 1.15));
  }
  lamps();
  SPRITES.set(key, c);
  return c;
}
const TRAILERS = {grain: {L: 5.2, Wd: 2.3}, log: {L: 13, Wd: 1.8}};
for (const [kind, T] of Object.entries(TRAILERS)) {
  const w = T.L * PPM | 0, h = T.Wd * PPM | 0, c = T.spr = canvas(w, h), g = c.getContext('2d');
  const R = (x, y, ww, hh, f) => { g.fillStyle = f; g.fillRect(x, y, ww, hh); };
  if (kind === 'grain') {
    R(4, 0, 8, h, '#101012'); R(w - 14, 0, 8, h, '#101012');
    R(0, 1, w - 3, h - 2, '#0b0b0d'); R(1, 2, w - 5, h - 4, '#6b4a2a'); R(3, 4, w - 9, h - 8, '#d9b23c');
    for (let i = 0; i < 50; i++) R(3 + (i * 29) % (w - 10), 4 + (i * 17) % (h - 9), 1, 1, i % 2 ? '#f0cf5a' : '#b8922a');
    R(w - 3, h / 2 - 1, 3, 2, '#333');
  } else { // the maypole: white and blue, wreath at the tip
    R(6, 0, 8, h, '#101012'); R(w - 26, 0, 8, h, '#101012'); R(4, 3, w - 12, h - 6, '#2a2a2e');
    R(0, h / 2 - 2, w - 6, 4, '#f4f4ef');
    for (let x = 2; x < w - 8; x += 8) R(x, h / 2 - 2, 4, 4, '#2b62c8');
    R(0, h / 2 - 4, 5, 8, '#2f8f4a'); R(w - 6, h / 2 - 1, 6, 2, '#333');
  }
}

const ICONS = {};
function icon(kind) { // little pixel pictures for the things you carry around
  if (ICONS[kind]) return ICONS[kind];
  const c = ICONS[kind] = canvas(12, 12), g = c.getContext('2d');
  const R = (x, y, w, h, f) => { g.fillStyle = f; g.fillRect(x, y, w, h); };
  if (kind === 'dose') { R(3, 1, 6, 10, '#111'); R(4, 2, 4, 8, '#1c1c1c'); R(4, 4, 4, 3, '#b3261e'); R(4, 1, 4, 1, '#c9c9c9'); R(5, 5, 2, 1, '#fff'); }
  else if (kind === 'cash') { R(1, 3, 10, 6, '#1e5a2a'); R(2, 4, 8, 4, '#4caf50'); R(5, 5, 2, 2, '#e8f5e9'); }
  else if (kind === 'fisch') { R(2, 4, 6, 4, '#8a9a7a'); R(3, 3, 4, 6, '#a8b894'); R(8, 3, 2, 6, '#6f7f62'); R(3, 5, 1, 1, '#111'); }
  else if (kind === 'essen') { R(2, 3, 8, 7, '#c69c6d'); R(3, 2, 6, 2, '#e8d2a8'); R(3, 5, 6, 2, '#b3261e'); }
  else if (kind === 'anzug') { R(2, 2, 8, 9, '#1d2c4d'); R(5, 2, 2, 5, '#f4f4ef'); R(5, 3, 2, 3, '#b3261e'); R(4, 0, 4, 2, '#888'); }
  else if (kind === 'krebs') { R(3, 4, 6, 5, '#c8322b'); R(1, 2, 3, 3, '#e04a3a'); R(8, 2, 3, 3, '#e04a3a'); R(4, 5, 1, 1, '#111'); R(7, 5, 1, 1, '#111'); }
  else if (kind === 'fass') { R(2, 1, 8, 10, '#6b4a2a'); R(1, 3, 10, 6, '#8a6238'); R(1, 3, 10, 1, '#b9b9b4'); R(1, 8, 10, 1, '#b9b9b4'); R(5, 5, 2, 2, '#3a2a1a'); }
  else { R(1, 2, 10, 8, '#6b4a2a'); R(2, 3, 8, 6, '#c69c6d'); R(1, 5, 10, 1, '#6b4a2a'); R(5, 2, 1, 8, '#6b4a2a'); }
  return c;
}

// ---------- state

let S;
const fmt = v => Math.round(v).toLocaleString('de-DE') + ' €';
const SAVE = 'gtw-save';
function load() { try { return JSON.parse(localStorage.getItem(SAVE)); } catch (e) { return null; } }
function store() { try { localStorage.setItem(SAVE, JSON.stringify({n: S.jobN, money: S.money, stats: S.stats})); } catch (e) { /* private mode */ } }

function reset(mode, save) {
  S = {mode, t: 0, money: 0, shown: 0, cars: [], peds: [], items: [], parts: [], decals: [], texts: [],
    job: null, jobN: 0, nextJob: 5, pager: {q: [], cur: '', n: 0, hold: 0, said: 0, idle: ''}, spawnT: 0, shake: 0, wasted: 0, paused: false,
    crashT: 0, wanted: 0, seen: 0, bust: 0, gps: null, gpsT: 0, copF: null, copT: 0, whereT: 0, note: 0, stuck: 0,
    stats: {missions: 0, stolen: 0, peds: 0, wrecks: 0, busted: 0, wasted: 0}, cam: {x: 1450, y: 900, z: 4.4}, P: null};
  if (save) { S.jobN = save.n; S.money = S.shown = save.money; Object.assign(S.stats, save.stats); }
  const hq = SPOT.hq, car = makeCar(hq.x, hq.y, hq.a, 'car', '#e0b21c');
  S.P = {x: hq.x + Math.sin(hq.a) * 2.4, y: hq.y - Math.cos(hq.a) * 2.4, a: hq.a, t: 0, car: null};
  if (mode === 'play') Object.assign(S.cam, {x: S.P.x, y: S.P.y, z: 12});
  car.radio = 0;
  parkCars();
  for (let i = 0; i < 45; i++) populate(1, mode === 'play' ? 45 : 0);
  for (let i = 0; i < 40; i++) dropCash();
}

function makeCar(x, y, a, kind, col = PAINT[kind] || pick(COLORS)) {
  const T = TYPES[kind];
  const c = {x, y, a, vx: 0, vy: 0, vf: 0, spin: 0, thr: 0, steer: 0, hb: false, T, kind, col, spr: carSprite(kind, col, kind === 'van' ? Math.random() * 9 | 0 : 0),
    name: pick(T.name), hp: T.hp, burn: 0, dead: false, ai: null, radio: kind === 'tractor' ? 1 : Math.random() < .15 ? -1 : Math.random() * 4 | 0};
  S.cars.push(c);
  return c;
}
function hitch(c, kind) { c.tr = {kind, a: c.a, T: TRAILERS[kind]}; return c; }

// ---------- effects

function puff(x, y, kind) {
  if (S.parts.length > 400) return;
  const a = rand(0, TAU), sp = kind === 'spark' ? rand(4, 12) : kind === 'blood' || kind === 'water' ? rand(1, 6) : rand(.2, 1.5);
  S.parts.push({x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, kind, life: 0,
    max: {spark: .3, smoke: 1.4, blood: .35, fire: .5, water: .6}[kind]});
}
function decal(x, y, kind) {
  for (let i = 0; i < 3; i++) S.decals.push({x: x + rand(-.8, .8), y: y + rand(-.8, .8), r: kind === 'blood' ? rand(.4, 1) : rand(1.5, 2.6), kind});
  if (S.decals.length > 120) S.decals.splice(0, 3);
}
const float = (o, s, col = '#ffd23e') => S.texts.push({x: o.x, y: o.y, s, life: 1.5, col});
function replay(el) { // show an element and restart its CSS animation
  el.hidden = false;
  el.style.animation = 'none';
  el.offsetWidth;
  el.style.animation = '';
}
function flash(big, small = '') {
  const el = $('flash');
  el.firstElementChild.textContent = big;
  el.lastElementChild.textContent = small;
  replay(el);
}
function info(text) { // small line at the bottom: car names, radio stations
  $('info').textContent = text;
  replay($('info'));
}

// ---------- cars

function bounce(c, h, off) { // push a car out along [nx, ny, depth]; returns the impact speed
  c.x += h[0] * h[2]; c.y += h[1] * h[2];
  const vn = c.vx * h[0] + c.vy * h[1];
  if (vn >= 0) return 0;
  c.vx -= 1.3 * vn * h[0]; c.vy -= 1.3 * vn * h[1];
  c.spin += off * (Math.cos(c.a) * h[1] - Math.sin(c.a) * h[0]) * -vn * .1;
  return -vn;
}

function damage(c, imp) {
  if (imp < 5 || c.dead) return;
  if (dist(c, S.P) < 80 && S.t - S.crashT > .08) {
    S.crashT = S.t;
    AUDIO.play('crash', imp);
    for (let i = 0; i < 6; i++) puff(c.x, c.y, 'spark');
  }
  c.hp -= (imp - 5) * .55 / c.T.mass;
  if (c.ai) c.ai.rage = 5;
  const j = S.job;
  if (j && j.fragile && c === S.P.car) { // the load does not like this
    j.cargo -= (imp - 5) * .012;
    float(c, pick(['KLIRR!', 'SCHEPPER!', 'AUWEH!']), '#ff5a1f');
    AUDIO.play('glass');
  }
  if (c.hp <= 0 && !c.burn) { c.burn = 4.5; bail(c); if (c === S.P.car) flash('Raus hier!', 'Die Karre brennt'); }
}

function bail(c) { // the driver jumps out and runs for it
  if (!c.ai) return;
  c.ai = null;
  c.thr = c.steer = 0; c.hb = false;
  const n = nearNode(c, 'walk'), p = spawnPed(c.x + Math.sin(c.a) * 2, c.y - Math.cos(c.a) * 2, n, pick(NODES[n].walk));
  p.flee = 4; p.a = c.a - Math.PI / 2 + rand(-.6, .6);
}

function explode(c) {
  c.burn = 0; c.dead = true; c.hp = 0;
  c.spr = carSprite(c.kind, 'wreck');
  bail(c);
  S.parts.push({x: c.x, y: c.y, vx: 0, vy: 0, kind: 'boom', life: 0, max: .45});
  for (let i = 0; i < 26; i++) puff(c.x + rand(-2, 2), c.y + rand(-2, 2), i % 2 ? 'fire' : 'smoke');
  decal(c.x, c.y, 'scorch');
  const P = S.P, far = dist(c, P);
  if (far < 150) { AUDIO.play('boom'); S.shake = Math.max(S.shake, clamp(1.2 - far / 60, 0, 1)); }
  S.stats.wrecks++;
  for (const o of S.cars) {
    const d = dist(o, c);
    if (o === c || o.dead || d > 9) continue;
    o.vx += (o.x - c.x) / (d || 1) * 7; o.vy += (o.y - c.y) / (d || 1) * 7;
    o.hp -= 60;
    if (o.hp <= 0 && !o.burn) { o.burn = rand(.6, 1.6); bail(o); }
  }
  for (const p of S.peds) if (dist(p, c) < 8) killPed(p);
  if (P.car === c || (!P.car && far < 7)) waste();
}

function sink(c) { // cars cannot swim
  for (let i = 0; i < 30; i++) puff(c.x + rand(-2, 2), c.y + rand(-2, 2), 'water');
  if (dist(c, S.P) < 150) AUDIO.play('splash');
  c.dead = c.gone = true; c.ai = null;
  if (S.P.car === c) waste('Abgesoffen!');
}

function stepCar(c, dt) {
  const T = c.T;
  if (c.burn > 0) {
    c.thr = 0;
    if (Math.random() < dt * 40) puff(c.x + rand(-1, 1), c.y + rand(-1, 1), 'fire');
    if ((c.burn -= dt) <= 0) explode(c);
  } else if (!c.dead && c.hp < T.hp * .5 && Math.random() < dt * (c.hp < T.hp * .25 ? 16 : 6)) {
    puff(c.x + Math.cos(c.a) * T.L * .35, c.y + Math.sin(c.a) * T.L * .35, 'smoke');
  }
  if (c.dead) c.thr = c.steer = 0;
  c.a += c.spin * dt;
  c.spin *= Math.exp(-3 * dt);
  const ground = surfAt(c.x, c.y), road = ground & 1 || c.ai;
  if ((ground & 9) === 8 && !c.dead) return sink(c);
  let fx = Math.cos(c.a), fy = Math.sin(c.a), vf = c.vx * fx + c.vy * fy;
  c.a += c.steer * (c.hb ? 3.5 : 2.8) / (1 + Math.abs(vf) / 26) * clamp(vf / 5, -1, 1) * dt;
  fx = Math.cos(c.a); fy = Math.sin(c.a);
  vf = c.vx * fx + c.vy * fy;
  let vl = c.vy * fx - c.vx * fy; // sideways slip
  const max = T.max * (road ? 1 : .7);
  if (c.thr > 0 && vf < max) vf += T.acc * (vf < 0 ? 2.5 : 1 - (vf / max) ** 2) * c.thr * dt; // punchy launch, tapering to top speed
  if (c.thr < 0 && vf > -max * .35) vf += (vf > 0 ? 30 : T.acc * .7) * c.thr * dt;
  const drag = (c.thr ? 0 : 4) + (c.hb ? 12 : 0) + (Math.abs(vf) > max ? 6 : 0) + (c.dead ? 8 : 0);
  vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
  vl *= Math.exp(-(c.hb ? 1.6 : road ? 8 : 4.5) * dt);
  if (!c.thr && Math.abs(vf) < .05 && Math.abs(vl) < .05) { vf = vl = 0; if (Math.abs(c.spin) < .02) c.spin = 0; }
  c.vx = fx * vf - fy * vl; c.vy = fy * vf + fx * vl; c.vf = vf;
  c.x += c.vx * dt; c.y += c.vy * dt;
  if (c.tr) c.tr.a = c.a - clamp(wrap(c.a - c.tr.a - vf / c.tr.T.L * Math.sin(c.a - c.tr.a) * dt), -1.3, 1.3); // the trailer swings in behind
  for (const off of T.offs) { // walls and tree trunks
    const px = c.x + fx * off, py = c.y + fy * off;
    if (surfAt(px, py) & 2) continue;
    for (const b of at(BG, px, py)) {
      if (px < b.x0 - T.r || px > b.x1 + T.r || py < b.y0 - T.r || py > b.y1 + T.r) continue;
      const h = pushOut(c.x + fx * off, c.y + fy * off, T.r, b.p);
      if (h) damage(c, bounce(c, h, off));
    }
    for (const t of at(TG, px, py)) {
      const dx = c.x + fx * off - t.x, dy = c.y + fy * off - t.y, d = Math.hypot(dx, dy);
      if (d && d < T.r + .4) damage(c, bounce(c, [dx / d, dy / d, T.r + .4 - d], off));
    }
  }
}

function collideCars() {
  const cs = S.cars, P = S.P;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    if (Math.abs(a.x - b.x) > 12 || Math.abs(a.y - b.y) > 12) continue;
    const ma = a.T.mass * (a.dead ? 2 : 1), mb = b.T.mass * (b.dead ? 2 : 1), min = a.T.r + b.T.r;
    for (const oa of a.T.offs) for (const ob of b.T.offs) {
      const dx = b.x + Math.cos(b.a) * ob - a.x - Math.cos(a.a) * oa, dy = b.y + Math.sin(b.a) * ob - a.y - Math.sin(a.a) * oa;
      const d = Math.hypot(dx, dy);
      if (!d || d >= min) continue;
      const nx = dx / d, ny = dy / d, pen = min - d;
      a.x -= nx * pen * mb / (ma + mb); a.y -= ny * pen * mb / (ma + mb);
      b.x += nx * pen * ma / (ma + mb); b.y += ny * pen * ma / (ma + mb);
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv >= 0) continue;
      const J = -1.3 * rv / (1 / ma + 1 / mb);
      a.vx -= J / ma * nx; a.vy -= J / ma * ny; b.vx += J / mb * nx; b.vy += J / mb * ny;
      a.spin -= oa * (Math.cos(a.a) * ny - Math.sin(a.a) * nx) * J / ma * .1;
      b.spin += ob * (Math.cos(b.a) * ny - Math.sin(b.a) * nx) * J / mb * .1;
      damage(a, -rv * mb / (ma + mb) * 1.6); damage(b, -rv * ma / (ma + mb) * 1.6);
      const other = a === P.car ? b : b === P.car ? a : null;
      if (other && -rv > 7) {
        if (other.ai && other.ai.cop) crime(.4); // ramming the police
        if (S.job && other === S.job.prey) { other.hits = (other.hits || 0) + 1; float(other, 'RUMMS!', '#ff5a1f'); }
      }
    }
  }
}

// ---------- traffic, police and pedestrians

function nextNode(from, to, ai) { // where an AI car turns next; wide roads and gentle turns are more likely
  const a = NODES[from], b = NODES[to];
  if (ai.cop && S.copF) { const n = downhill(S.copF, to); if (n >= 0) return n; }
  let opts = b.car.filter(e => e.n !== from);
  if (ai.flee) { // the getaway driver stays in the village
    const stay = opts.filter(e => { const n = NODES[e.n]; return n.x > 40 && n.y > 40 && n.x < W - 40 && n.y < H - 40; });
    opts = stay.length ? stay : b.car.filter(e => e.n === from);
  }
  if (!opts.length) return -1;
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  let total = 0;
  for (const e of opts) { const c = NODES[e.n]; total += e.k = e.w * e.w * (1.3 + Math.cos(Math.atan2(c.y - b.y, c.x - b.x) - dir)); }
  let r = Math.random() * total;
  return (opts.find(e => (r -= e.k) < 0) || opts[0]).n;
}

function driveAI(c, dt) {
  const ai = c.ai, a = NODES[ai.from], b = NODES[ai.to], P = S.P, hunt = ai.cop && S.wanted >= 1 && !S.wasted;
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const along = (c.x - a.x) * dx + (c.y - a.y) * dy, lane = Math.min(a.w, b.w) / 4; // drive on the right
  if (along > len - 2) {
    const n = nextNode(ai.from, ai.to, ai);
    if (n < 0) c.gone = true; // left the map
    else { ai.from = ai.to; ai.to = n; }
    return;
  }
  const s = Math.min(len, along + 5 + c.vf * .4), near = hunt && dist(c, P) < 45;
  let tx = a.x + dx * s - dy * lane, ty = a.y + dy * s + dx * lane;
  if (near) { tx = P.x + (P.car ? P.car.vx * .4 : 0); ty = P.y + (P.car ? P.car.vy * .4 : 0); } // close enough: go straight for the player
  const err = wrap(Math.atan2(ty - c.y, tx - c.x) - c.a), fast = hunt || ai.flee || ai.rage > 0;
  const want = (2 + Math.min(a.w, b.w) * 1.6) * (hunt || ai.flee ? 2 : ai.rage > 0 ? 1.6 : 1) * (1 - .7 * Math.min(1, Math.abs(err)));
  const fx = Math.cos(c.a), fy = Math.sin(c.a), reach = 5 + c.vf * .9;
  const ahead = o => { const rx = o.x - c.x, ry = o.y - c.y, f = rx * fx + ry * fy; return f > 0 && f < reach && Math.abs(ry * fx - rx * fy) < 1.7; };
  const block = !fast && !(ai.push > 0)
    && (S.cars.some(o => o !== c && ahead(o)) || S.peds.some(ahead) || (S.mode === 'play' && !P.car && ahead(P)));
  ai.wait = block ? ai.wait + dt : 0;
  if (ai.wait > 5) ai.push = 2; // tired of waiting: shove through
  ai.push -= dt; ai.rage -= dt;
  c.thr = block ? (c.vf > .3 ? -1 : 0) : c.vf < want ? (fast ? 1 : .7) : c.vf > want + 2 ? -.4 : 0;
  c.hb = block && c.vf < 1;
  c.steer = clamp(err * 2.2, -1, 1);
  if (near && dist(c, P) < 9 && (P.car ? Math.abs(P.car.vf) : 0) < 4) { c.thr = c.vf > 1 ? -1 : 0; c.hb = true; } // box the player in
  if (!block && !c.hb && Math.abs(c.vf) < .5) ai.stuck += dt; else if (c.vf > 1.5) ai.stuck = 0;
  if (ai.stuck > 1.5) { ai.stuck = 0; ai.rev = 1.3; ai.jams++; } // nose against something: back up
  if (ai.rev > 0) { ai.rev -= dt; c.thr = -1; c.steer = -c.steer; }
}
const newAI = (from, to, more) => Object.assign({from, to, wait: 0, push: 0, rage: 0, stuck: 0, rev: 0, jams: 0}, more);

function crime(heat) { S.wanted = Math.min(4, S.wanted + heat); S.seen = 8; }

function police(dt) {
  const P = S.P, cops = S.cars.filter(c => c.ai && c.ai.cop && !c.dead);
  const close = cops.reduce((m, c) => Math.min(m, dist(c, P)), 1e9);
  if (S.wanted > 0) {
    S.seen -= dt;
    S.wanted = Math.max(0, S.wanted - dt * (close < 90 ? .012 : S.seen > 0 ? .04 : .14)); // heat cools off once nobody is looking
  }
  if (S.wanted < 1) for (const c of cops) { c.ai.cop = false; c.siren = false; } // off duty: back to normal traffic
  AUDIO.siren(S.wanted >= 1 && close < 170 && S.mode === 'play' && !S.paused);
  if (S.wanted < 1 || S.mode !== 'play') { S.bust = 0; return; }
  if ((S.copT -= dt) <= 0) { S.copT = 1; S.copF = field(P); }
  if (cops.length < Math.min(3, Math.floor(S.wanted)) && Math.random() < dt * 1.2) {
    const spots = NODES.filter(n => { const d = dist(n, P); return d > 110 && d < 230 && n.gps.length && n.x > 0 && n.y > 0 && n.x < W && n.y < H; });
    const a = pick(spots);
    if (a) {
      const i = NODES.indexOf(a), to = downhill(S.copF, i);
      if (to >= 0) {
        const c = makeCar(a.x, a.y, Math.atan2(NODES[to].y - a.y, NODES[to].x - a.x), 'police');
        c.ai = newAI(i, to, {cop: true}); c.siren = true;
      }
    }
  }
  // caught: a patrol car right next to you while you are slow
  const slow = (P.car ? Math.hypot(P.car.vx, P.car.vy) : 0) < 3;
  S.bust = close < (P.car ? 7 : 5) && slow && !S.wasted ? S.bust + dt : Math.max(0, S.bust - dt * 2);
  if (S.bust > 1.6) busted();
}

function busted() {
  const P = S.P, fine = Math.round(S.money * .1 / 5) * 5, r = SPOT.rathaus;
  S.stats.busted++; S.money -= fine; S.wanted = 0; S.bust = 0;
  if (P.car) { Object.assign(P.car, {thr: 0, steer: 0}); P.car = null; AUDIO.radio(-1); }
  flash('Erwischt!', fine ? 'Strafzettel: ' + fmt(fine) : 'Nochmal Glück gehabt');
  AUDIO.play('fail');
  if (S.job) failJob('busted');
  for (const c of S.cars) if (c.ai && c.ai.cop) c.gone = true;
  Object.assign(P, {x: r.x, y: r.y, a: r.a});
  page(pick(TALK.busted));
}

const SHIRTS = ['#d9d4c8', '#b3372f', '#2f5fa8', '#3c8a4a', '#d8a31c', '#7a4a9a', '#22252b', '#d86a2a', '#e58fb0'];
const HAIR = ['#2a1d12', '#4a3018', '#8a6a3a', '#c8c2b4', '#15151a', '#a8452a'];

function spawnPed(x, y, from, to) {
  const p = {x, y, a: rand(0, TAU), from, to, side: pick([-1, 1]), sp: rand(1.1, 1.7), t: rand(0, 9), flee: 0,
    alert: Math.random() < .6, shirt: pick(SHIRTS), hair: pick(HAIR), dead: false};
  S.peds.push(p);
  return p;
}

function stepPed(p, dt) {
  let sp = p.sp;
  if (p.flee > 0) { p.flee -= dt; sp = 5; }
  else {
    const a = NODES[p.from], b = NODES[p.to];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1, off = (b.w / 2 + 1) * p.side; // walk beside the road
    const tx = b.x - dy / len * off, ty = b.y + dx / len * off;
    if (Math.hypot(tx - p.x, ty - p.y) < .9) {
      const opts = b.walk.filter(n => n !== p.from);
      [p.from, p.to] = [p.to, opts.length ? pick(opts) : p.from]; // dead end: turn around
    } else p.a += clamp(wrap(Math.atan2(ty - p.y, tx - p.x) - p.a), -6 * dt, 6 * dt);
  }
  p.x += Math.cos(p.a) * sp * dt; p.y += Math.sin(p.a) * sp * dt; p.t += sp * dt;
  shove(p, .35);
}

function killPed(p, byPlayer) {
  if (p.dead) return;
  p.dead = true;
  decal(p.x, p.y, 'blood');
  for (let i = 0; i < 10; i++) puff(p.x, p.y, 'blood');
  if (dist(p, S.P) < 80) AUDIO.play('splat');
  if (byPlayer) { S.stats.peds++; float(p, 'BATSCH!', '#ff5a1f'); crime(.6); }
}

function touching(o, c, r) { // is walker `o` under car `c`?
  for (const off of c.T.offs) if (Math.hypot(o.x - c.x - Math.cos(c.a) * off, o.y - c.y - Math.sin(c.a) * off) < c.T.r + r) return true;
  return false;
}

function walkersVsCars() {
  const P = S.P;
  for (const c of S.cars) {
    const sp = Math.hypot(c.vx, c.vy);
    for (const p of S.peds) {
      const dx = p.x - c.x, dy = p.y - c.y;
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) continue;
      const side = dx * c.vy - dy * c.vx; // which side of the car's path the walker is on
      if (sp > 5 && p.alert && p.flee <= 0 && dx * c.vx + dy * c.vy > 0 && Math.abs(side) / sp < 3) {
        p.flee = 1; p.a = Math.atan2(c.vy, c.vx) + (side > 0 ? -1 : 1) * Math.PI / 2; // jump out of the way
        if (c === P.car && Math.random() < .5) AUDIO.play('scream');
      }
      if (!touching(p, c, .35)) continue;
      if (sp > 3) { killPed(p, c === P.car); c.vx *= .96; c.vy *= .96; }
      else { const d = Math.hypot(dx, dy) || 1; p.x += dx / d * .2; p.y += dy / d * .2; }
    }
    if (S.mode === 'play' && !P.car && !S.wasted && touching(P, c, .35)) {
      if (sp > 4) waste();
      else { const d = dist(P, c) || 1; P.x += (P.x - c.x) / d * .2; P.y += (P.y - c.y) / d * .2; }
    }
  }
}

// Keep the streets around `f` busy; `near` is how close things may appear.
function populate(dt, near) {
  const P = S.P, f = S.mode === 'play' ? P : S.cam, j = S.job, keep = c => c === P.car || (j && (c === j.veh || c === j.prey));
  S.cars = S.cars.filter(c => keep(c) && !c.gone || !(c.gone || ((c.ai || c.dead) && dist(c, f) > 300) || (c.ai && c.ai.jams > 4 && dist(c, f) > 110)));
  S.peds = S.peds.filter(p => !p.dead && dist(p, f) < 230);
  if ((S.spawnT -= dt) > 0) return;
  S.spawnT = .3;
  const spots = NODES.filter(n => { const d = dist(n, f); return d > near && d < 250; });
  if (S.cars.filter(c => c.ai).length < 13) {
    const a = pick(spots.filter(n => n.car.length));
    if (a && !S.cars.some(c => dist(c, a) < 14)) {
      const to = pick(a.car).n, b = NODES[to], ang = Math.atan2(b.y - a.y, b.x - a.x), r = Math.random();
      const c = makeCar(a.x - Math.sin(ang) * a.w / 4, a.y + Math.cos(ang) * a.w / 4, ang,
        r < .6 ? 'car' : r < .78 ? 'van' : r < .86 ? 'sport' : r < .93 ? 'tractor' : r < .97 ? 'truck' : 'kipper');
      c.ai = newAI(NODES.indexOf(a), to);
      if (c.kind === 'tractor' && Math.random() < .5) hitch(c, 'grain');
    }
  }
  if (S.peds.length < 24) {
    const a = pick(spots.filter(n => n.walk.length));
    if (a) spawnPed(a.x + rand(-2, 2), a.y + rand(-2, 2), NODES.indexOf(a), pick(a.walk));
  }
}

function parkCars() { // fill the car parks in tidy rows
  const r = rng(11);
  for (const a of AREAS) if (a.k === 'park') {
    const ca = Math.cos(a.ang), sa = Math.sin(a.ang), R = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2;
    for (let u = -R; u < R; u += 2.8) for (let v = -R; v < R; v += 5.8) {
      const x = a.mx + ca * u - sa * v, y = a.my + sa * u + ca * v, ex = -sa * 2.7, ey = ca * 2.7, take = r() < .42, flip = r() < .5, kind = r();
      const free = (px, py) => pip(px, py, a.p) && !(surfAt(px, py) & 4);
      if (!take || !free(x, y) || !free(x + ex, y + ey) || !free(x - ex, y - ey)) continue;
      if (blocked(x, y, 3)) continue;
      makeCar(x, y, a.ang + Math.PI / 2 + (flip ? Math.PI : 0), kind < .8 ? 'car' : kind < .93 ? 'van' : 'sport', COLORS[r() * COLORS.length | 0]);
    }
  }
  for (let i = 0; i < 46; i++) { // and a few along the kerb in the village
    const s = SEGS[r() * SEGS.length | 0], t = r(), kind = r(), flip = r() < .5, col = COLORS[r() * COLORS.length | 0];
    if (!town(s[6]) || s[5] < 14) continue;
    const off = s[4] / 2 + .2, x = lerp(s[0], s[2], t) - (s[3] - s[1]) / s[5] * off, y = lerp(s[1], s[3], t) + (s[2] - s[0]) / s[5] * off;
    if (blocked(x, y, 2.6) || S.cars.some(c => Math.hypot(c.x - x, c.y - y) < 7) || NODES.some(n => n.car.length > 2 && Math.hypot(n.x - x, n.y - y) < 12)) continue;
    makeCar(x, y, Math.atan2(s[3] - s[1], s[2] - s[0]) + (flip ? Math.PI : 0), kind < .85 ? 'car' : kind < .95 ? 'van' : 'sport', col);
  }
}

// ---------- money on the street

function roadPoint(ok) { // random spot on a road (uniform by length) that passes `ok`
  for (let n = 0; n < 600; n++) {
    const s = pick(SEGS);
    if (Math.random() * SEGMAX > s[5]) continue;
    const t = Math.random(), o = rand(-.3, .3) * s[4];
    const x = lerp(s[0], s[2], t) - (s[3] - s[1]) / s[5] * o, y = lerp(s[1], s[3], t) + (s[2] - s[0]) / s[5] * o;
    if (x > 15 && y > 15 && x < W - 15 && y < H - 15 && !(surfAt(x, y) & 10) && ok(x, y)) return {x, y};
  }
}
function dropCash() {
  const spot = roadPoint((x, y) => Math.hypot(x - S.P.x, y - S.P.y) > 30 && !S.items.some(v => Math.hypot(v.x - x, v.y - y) < 20));
  if (spot) S.items.push({...spot, kind: 'cash', val: pick([5, 10, 10, 20, 20, 50, 100]), ph: rand(0, TAU)});
}
function grab(v) {
  AUDIO.play('coin');
  if (v.kind === 'cash') { S.money += v.val; float(v, '+' + fmt(v.val)); return dropCash(); }
  const j = S.job, left = S.items.filter(o => o.job).length;
  float(v, left ? `noch ${left}` : 'Alles da!');
  if (j) j.got++;
}

// ---------- the pager and Flo's jobs

function page(...msgs) { // Flo is calling
  const pg = S.pager;
  if (!pg.q.length && !pg.cur) { replay($('pager').firstElementChild); $('pager').classList.add('ring'); AUDIO.play('pager'); }
  pg.q.push(...msgs);
}

function place(o) { // a step's target: a place name or the mission car
  return typeof o === 'string' ? SPOT[o] : o;
}
function spawnAt(kind, key, trailer) {
  const s = SPOT[key];
  S.cars = S.cars.filter(c => c === S.P.car || dist(c, s) > 9); // make room
  const c = makeCar(s.x, s.y, s.a, kind);
  if (trailer) hitch(c, trailer);
  return c;
}

function startJob() {
  const m = MISSIONS[S.jobN];
  S.job = {m, i: -1, step: null, veh: null, prey: null, to: null, left: 0, timed: false, cargo: 1, fragile: false, hold: 0, got: 0, need: 0};
  S.items = S.items.filter(v => !v.job);
  page(...m.intro);
  nextStep();
}

function nextStep() {
  const j = S.job, st = j.m.steps[++j.i];
  if (!st) return endJob();
  if (j.i) AUDIO.play('step');
  j.step = st; j.hold = 0; j.to = st.to ? SPOT[st.to] : null;
  if (st.time) { j.left = st.time; j.timed = true; } else if (st.time === 0) j.timed = false;
  if (st.fragile != null) { j.fragile = st.fragile; j.cargo = 1; }
  if (st.drop) j.veh = null;
  if (st.wanted) { crime(st.wanted); AUDIO.play('alarm'); }
  if (st.say) page(st.say);
  S.pager.idle = st.obj;
  if (st.do === 'steal') { j.veh = spawnAt(st.veh, st.at, st.trailer); j.to = j.veh; }
  if (st.do === 'chase') {
    const s = SPOT[st.at], from = nearNode(s, 'car'), to = NODES[from].car[0].n;
    j.prey = makeCar(NODES[from].x, NODES[from].y, Math.atan2(NODES[to].y - NODES[from].y, NODES[to].x - NODES[from].x), st.veh);
    if (st.trailer) hitch(j.prey, st.trailer);
    j.prey.ai = newAI(from, to, {flee: true});
    j.to = j.prey;
  }
  if (st.do === 'take') { j.veh = j.prey; j.prey = null; j.to = j.veh; }
  if (st.do === 'collect') {
    const c = SPOT[st.near];
    j.got = 0; j.need = st.n;
    for (let i = 0; i < st.n; i++) {
      const spot = roadPoint((x, y) => Math.hypot(x - c.x, y - c.y) < st.r && !S.items.some(v => Math.hypot(v.x - x, v.y - y) < 25)) || c;
      S.items.push({...spot, kind: st.item, job: true, ph: rand(0, TAU)});
    }
  }
  S.gps = null;
}

function jobRules(dt) {
  const j = S.job, P = S.P, st = j.step, sp = P.car ? Math.hypot(P.car.vx, P.car.vy) : 0;
  const lost = c => c && (c.dead || c.burn > 0 || c.gone);
  if (lost(j.veh) || lost(j.prey)) return failJob(j.prey && j.prey.gone ? 'gone' : 'wreck');
  if (j.timed && (j.left -= dt) <= 0) return failJob('time');
  if (j.fragile && j.cargo <= 0) return failJob('cargo');
  const near = r => j.to && dist(P, j.to) < r;
  switch (st.do) {
    case 'steal': case 'take':
      if (P.car === j.veh) nextStep();
      break;
    case 'bring':
      if (P.car === j.veh && near(7) && sp < 8) nextStep();
      break;
    case 'goto':
      if (st.foot ? !P.car && near(3.5) : near(st.r || 7) && sp < 9) nextStep();
      break;
    case 'hold':
      if (near(st.r || 10) && (!st.veh || P.car === j.veh)) {
        j.hold += dt;
        if (st.fx === 'water') { for (let i = 0; i < 3; i++) puff(lerp(P.x, j.to.x, Math.random()), lerp(P.y, j.to.y, Math.random()), 'water'); if (Math.random() < dt * 5) AUDIO.play('spray'); }
        if (j.hold >= st.secs) nextStep();
      } else j.hold = Math.max(0, j.hold - dt);
      break;
    case 'collect':
      if (j.got >= j.need) nextStep();
      break;
    case 'lose':
      if (S.wanted < 1) nextStep();
      break;
    case 'chase':
      if ((j.prey.hits || 0) >= st.hits || j.prey.hp < j.prey.T.hp * .35) { bail(j.prey); Object.assign(j.prey, {thr: 0, hb: true}); nextStep(); }
      break;
  }
}

function endJob() {
  const j = S.job, m = j.m;
  S.job = null; S.jobN++; S.nextJob = 8;
  S.money += m.reward; S.stats.missions++;
  S.pager.idle = '';
  S.items = S.items.filter(v => !v.job);
  flash('Mission erfüllt!', '+' + fmt(m.reward));
  AUDIO.play('win');
  store();
  if (S.jobN >= MISSIONS.length) { page(...m.outro); S.nextJob = 1e9; S.finale = 9; return; }
  page(...m.outro);
}

function failJob(why) {
  const j = S.job;
  S.job = null; S.nextJob = 10;
  S.pager.idle = '';
  S.items = S.items.filter(v => !v.job);
  if (j.prey) { j.prey.ai = newAI(j.prey.ai ? j.prey.ai.from : 0, j.prey.ai ? j.prey.ai.to : 0); j.prey.gone = !j.prey.ai.to; }
  flash('Mission gescheitert!', {time: 'Zeit abgelaufen', wreck: 'Fahrzeug Schrott', cargo: 'Ladung kaputt', gone: 'Entkommen', busted: '', wasted: ''}[why]);
  AUDIO.play('fail');
  if (why !== 'busted') page(pick(TALK.scold));
}

function playRules(dt) { // pickups, missions and the grand finale
  const P = S.P, reach = P.car ? 2.9 : 1.7;
  if (S.wasted) return;
  const got = S.items.filter(v => Math.hypot(v.x - P.x, v.y - P.y) < reach);
  if (got.length) { S.items = S.items.filter(v => !got.includes(v)); got.forEach(grab); }
  if (P.car && S.wanted >= 1 && dist(P, SPOT.wasch) < 7) wash();
  if (S.job) jobRules(dt);
  else if ((S.nextJob -= dt) <= 0 && S.jobN < MISSIONS.length) startJob();
  if (S.finale && (S.finale -= dt) <= 0) finish();
}

function wash() { // the car wash at Murk: new paint, nobody recognises you
  const c = S.P.car;
  S.wanted = 0; S.money -= 15;
  c.col = pick(COLORS.filter(col => col !== c.col));
  c.spr = carSprite(c.kind, c.col);
  for (let i = 0; i < 40; i++) puff(c.x + rand(-3, 3), c.y + rand(-3, 3), 'water');
  flash('Blitzsauber!', 'Waschstraße: 14,90 €');
  AUDIO.play('splash');
}

function finish() {
  const st = S.stats, rank = RANKS.find(r => S.money >= r[0])[1];
  S.mode = 'end'; S.finale = 0;
  if (S.P.car) Object.assign(S.P.car, {thr: 0, steer: 0, hb: true});
  $('hud').hidden = true; $('end').hidden = false;
  $('total').textContent = fmt(S.money);
  $('stats').replaceChildren(...[`Rang: ${rank}`, `Aufträge für Flo: ${st.missions} · Autos geklaut: ${st.stolen}`,
    `Schrottkarren: ${st.wrecks} · Umgefahren: ${st.peds} · Erwischt: ${st.busted} · Erledigt: ${st.wasted}`]
    .map(t => Object.assign(document.createElement('li'), {textContent: t})));
  AUDIO.play('win'); AUDIO.radio(1); AUDIO.siren(false);
  try { localStorage.removeItem(SAVE); } catch (e) { /* private mode */ }
  $('again').focus();
}

// ---------- player

const keys = {}, pad = {x: 0, y: 0, brake: false, horn: false};
const axis = (neg, pos) => (pos.some(k => keys[k]) ? 1 : 0) - (neg.some(k => keys[k]) ? 1 : 0);

function shove(o, r) { // keep a walker out of buildings
  if (surfAt(o.x, o.y) & 2) return;
  for (const b of at(BG, o.x, o.y)) {
    const h = pushOut(o.x, o.y, r, b.p);
    if (h) { o.x += h[0] * h[2]; o.y += h[1] * h[2]; }
  }
}

function controlPlayer(dt) {
  const P = S.P, c = P.car, stick = Math.hypot(pad.x, pad.y);
  if (S.wasted) { if ((S.wasted -= dt) <= 0) respawn(); return; }
  let thr = axis(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']), steer = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
  const wet = (surfAt(P.x, P.y) & 9) === 8;
  if (c) {
    if (stick > .15) { // thumb stick: point where you want to go
      const err = wrap(Math.atan2(pad.y, pad.x) - c.a);
      steer = clamp(err * 2.2, -1, 1) * (c.vf < -1 ? -1 : 1);
      thr = Math.min(1, stick * 1.3) * (Math.abs(err) > 1.4 ? .55 : 1);
    }
    if (pad.brake) thr = -1;
    c.thr = thr; c.steer = steer; c.hb = !!keys.Space;
    c.siren = (c.kind === 'police' || c.kind === 'fire') && (keys.KeyH || pad.horn);
    return;
  }
  let sp = thr * (thr > 0 ? 4.5 : 2);
  if (stick > .15) { P.a = Math.atan2(pad.y, pad.x); sp = Math.min(1, stick * 1.3) * 4.5; }
  else P.a += steer * 3.5 * dt;
  if (wet) { sp *= .4; if (sp && Math.random() < dt * 8) puff(P.x, P.y, 'water'); } // wading
  P.x += Math.cos(P.a) * sp * dt; P.y += Math.sin(P.a) * sp * dt; P.t += Math.abs(sp) * dt;
  shove(P, .4);
}

function toggleCar() {
  const P = S.P, c = P.car;
  if (S.wasted || S.paused || S.mode !== 'play') return;
  if (c) {
    if (Math.hypot(c.vx, c.vy) > 5 && !c.burn) return; // jump out of a burning car at any speed
    const side = c.T.Wd / 2 + .8; // driver's door is on the left
    Object.assign(P, {x: c.x + Math.sin(c.a) * side, y: c.y - Math.cos(c.a) * side, a: c.a, car: null});
    c.thr = c.steer = 0; c.hb = false; c.siren = false;
    AUDIO.radio(-1);
    return AUDIO.play('door');
  }
  let best = null, bd = 4.2;
  for (const o of S.cars) { // the nearest car; the one Flo wants counts as closer
    const d = dist(o, P) - o.T.L / 4 - (S.job && o === S.job.veh ? 2.5 : 0);
    if (!o.dead && !o.burn && d < bd) { bd = d; best = o; }
  }
  if (!best) return;
  if (best.ai) {
    if (best.ai.cop) crime(1);
    else if (!(S.job && best === S.job.prey)) crime(.35);
    bail(best); S.stats.stolen++;
  }
  P.car = best;
  AUDIO.play('door');
  AUDIO.radio(best.radio);
  info(best.name + (best.radio >= 0 ? ' · ♪ ' + AUDIO.stations[best.radio] : ''));
}

function nextStation() {
  const c = S.P.car;
  if (!c) return;
  c.radio = c.radio >= AUDIO.stations.length - 1 ? -1 : c.radio + 1;
  AUDIO.radio(c.radio);
  info(c.radio < 0 ? 'Radio aus' : '♪ ' + AUDIO.stations[c.radio]);
}
function honk() {
  const c = S.P.car;
  if (!c || c.kind === 'police' || c.kind === 'fire') return;
  AUDIO.play('horn');
  for (const p of S.peds) if (dist(p, c) < 14 && p.flee <= 0) { p.flee = 1.2; p.a = Math.atan2(p.y - c.y, p.x - c.x); }
}

function waste(title = 'Erledigt!') {
  const P = S.P;
  if (S.wasted || S.mode !== 'play') return;
  const lost = Math.round(S.money * .1 / 5) * 5;
  S.wasted = 3.2; S.money -= lost; S.stats.wasted++; S.wanted = 0;
  if (P.car) { P.car.thr = P.car.steer = 0; P.car = null; AUDIO.radio(-1); }
  flash(title, lost ? 'Krankenhaus Höchstadt: ' + fmt(lost) : '');
  AUDIO.play('fail');
  for (let i = 0; i < 12; i++) puff(P.x, P.y, 'blood');
  decal(P.x, P.y, 'blood');
  if (S.job) failJob('wasted');
  page(pick(TALK.wasted));
}

function respawn() { // back on the road in a fresh car, at the nearest junction
  const P = S.P;
  const best = NODES[nearNode(P, 'car')], to = NODES[best.car[0].n];
  P.car = makeCar(best.x, best.y, Math.atan2(to.y - best.y, to.x - best.x), 'car', '#e0b21c');
  AUDIO.radio(P.car.radio);
  S.wasted = 0;
}

function camera(dt) {
  const cam = S.cam, P = S.P, c = P.car, tall = VH > VW ? .85 : 1;
  let tx = 1450 + Math.cos(S.t * .05) * 420, ty = 850 + Math.sin(S.t * .05) * 260, tz = 4.4; // title screen fly-over
  if (S.mode === 'end') { tx = SPOT.rathaus.x + Math.cos(S.t * .3) * 25; ty = SPOT.rathaus.y + Math.sin(S.t * .3) * 25; tz = 5; }
  if (S.mode === 'play') {
    tx = P.x + (c ? c.vx * .45 : 0); ty = P.y + (c ? c.vy * .45 : 0);
    tz = (c ? lerp(11.5, 7.5, clamp(Math.hypot(c.vx, c.vy) / 40, 0, 1)) : 13) * tall; // pull up when going fast
  }
  const k = 1 - Math.exp(-dt * 4);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 1.5));
  S.shake *= Math.exp(-dt * 4);
}

function update(dt) {
  const P = S.P;
  S.t += dt;
  if (S.mode === 'play') controlPlayer(dt);
  for (const c of S.cars) {
    if (c.ai) driveAI(c, dt);
    else if (c !== P.car && !c.burn && !c.vx && !c.vy && !c.spin) continue; // parked and at rest
    stepCar(c, dt);
  }
  collideCars();
  for (const p of S.peds) stepPed(p, dt);
  walkersVsCars();
  populate(dt, 85);
  police(dt);
  if (P.car) { P.x = P.car.x; P.y = P.car.y; P.a = P.car.a; }
  if (S.mode === 'play') playRules(dt);
  const o = P.car || P; // the map has an edge
  if (o.x < 6 || o.x > W - 6) { o.x = clamp(o.x, 6, W - 6); o.vx = 0; }
  if (o.y < 6 || o.y > H - 6) { o.y = clamp(o.y, 6, H - 6); o.vy = 0; }
  for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life += dt; }
  S.parts = S.parts.filter(p => p.life < p.max);
  for (const t of S.texts) { t.y -= 3 * dt; t.life -= dt; }
  S.texts = S.texts.filter(t => t.life > 0);
  camera(dt);
}

function guide(dt) { // keep the yellow arrow pointing down the road to the current target
  const j = S.job, P = S.P, to = j && j.to;
  if (!to) { S.gps = null; return; }
  if (!S.gps || Math.hypot(S.gps.x - to.x, S.gps.y - to.y) > 25) S.gps = {x: to.x, y: to.y, f: field(to), wp: null};
  if ((S.gpsT -= dt) > 0) return;
  S.gpsT = .25;
  S.gps.wp = dist(P, to) < 50 ? to : waypoint(S.gps.f, P, 40) || to;
}

function hud(dt) {
  const P = S.P, c = P.car, pg = S.pager, j = S.job;
  S.shown = Math.abs(S.money - S.shown) < 1 ? S.money : lerp(S.shown, S.money, Math.min(1, dt * 8));
  $('money').textContent = fmt(S.shown);
  $('heat').textContent = '★'.repeat(Math.floor(S.wanted));
  $('heat').classList.toggle('hot', S.bust > .3);
  $('dmg').hidden = !c;
  if (c) {
    const k = clamp(c.hp / c.T.hp, 0, 1), bar = $('dmg').querySelector('i');
    bar.style.width = k * 100 + '%';
    bar.style.background = k < .3 ? 'var(--hot)' : '';
  }
  // the pager types out Flo's messages one after the other, then shows what to do
  if (!pg.cur && pg.q.length) { pg.cur = pg.q.shift(); pg.n = 0; pg.said = 0; pg.hold = 1.4 + pg.cur.length * .028; }
  if (pg.cur) {
    if (pg.n < pg.cur.length) {
      pg.n += dt * 34;
      const n = Math.min(pg.cur.length, pg.n | 0);
      $('lcd').textContent = 'FLO: ' + pg.cur.slice(0, n);
      if (n - pg.said >= 3) { pg.said = n; if (/\w/.test(pg.cur[n - 1] || '')) AUDIO.babble(); }
    } else if ((pg.hold -= dt) <= 0) { pg.cur = ''; if (!pg.q.length) $('pager').classList.remove('ring'); }
  } else $('lcd').textContent = pg.idle ? '» ' + pg.idle : S.jobN >= MISSIONS.length ? 'Wachenroth gehört dir.' : '...';
  $('mission').hidden = !j || !(j.timed || j.fragile || j.need || j.step.do === 'hold' || j.step.do === 'chase');
  if (j && !$('mission').hidden) {
    const el = $('mission'), secs = Math.max(0, Math.ceil(j.left)), st = j.step, bits = [];
    if (j.timed) bits.push(`${secs / 60 | 0}:${String(secs % 60).padStart(2, '0')}`);
    if (st.do === 'collect') bits.push(`${j.got} / ${j.need}`);
    if (st.do === 'chase') bits.push(`Treffer ${j.prey.hits || 0} / ${st.hits}`);
    if (j.fragile) bits.push('Ladung');
    el.firstElementChild.textContent = bits.join('  ·  ');
    const bar = j.fragile ? j.cargo : st.do === 'hold' ? j.hold / st.secs : st.do === 'collect' ? j.got / j.need : j.timed ? j.left / (st.time || j.left) : 0;
    el.lastElementChild.hidden = !(j.fragile || st.do === 'hold' || st.do === 'collect');
    el.querySelector('i').style.width = clamp(bar, 0, 1) * 100 + '%';
    el.classList.toggle('hurry', j.timed && secs <= 15);
  }
  if ((S.whereT -= dt) <= 0) { // where am I?
    S.whereT = .5;
    let name = '', bd = 34;
    for (const k in SPOT) { const d = dist(P, SPOT[k]); if (d < bd && PLACES[k]) { bd = d; name = PLACES[k]; } }
    if (!name) {
      bd = 14;
      for (const s of SEGS) if (s[6].n && Math.abs(s[0] - P.x) < 150 && Math.abs(s[1] - P.y) < 150) {
        const q = nearest(P.x, P.y, s[0], s[1], s[2], s[3]), d = Math.hypot(P.x - q[0], P.y - q[1]);
        if (d < bd) { bd = d; name = s[6].n; }
      }
    }
    $('where').textContent = name;
  }
  AUDIO.engine(c ? c.vf : 0, c && S.mode === 'play' && !S.paused, c && c.kind);
}

function start(save) {
  AUDIO.init();
  reset('play', save);
  $('menu').hidden = $('end').hidden = true;
  $('hud').hidden = false;
  $('lcd').textContent = '';
  for (const id of ['flash', 'mission', 'pause', 'info']) $(id).hidden = true;
  replay($('hint'));
  document.activeElement.blur();
  AUDIO.radio(-1);
  page(...(save ? TALK.back : TALK.hello));
}

function pause(p) {
  if (S.mode !== 'play') return;
  S.paused = p;
  $('pause').hidden = !p;
  AUDIO.pause(p);
}

// ---------- input: keyboard, and a thumb stick plus buttons on touch screens

addEventListener('keydown', e => {
  if (S.mode !== 'play') return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyF' || e.code === 'Enter') toggleCar();
  if (e.code === 'KeyP' || e.code === 'Escape') pause(!S.paused);
  if (e.code === 'KeyM') AUDIO.mute(!AUDIO.muted);
  if (e.code === 'KeyR') nextStation();
  if (e.code === 'KeyH') honk();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

{
  const stick = $('stick'), knob = stick.firstElementChild, R = 52;
  let id = null, ox = 0, oy = 0;
  const move = e => {
    const dx = e.clientX - ox, dy = e.clientY - oy, d = Math.hypot(dx, dy), k = Math.min(1, d / R) / (d || 1);
    pad.x = dx * k; pad.y = dy * k;
    knob.style.transform = `translate(${pad.x * R}px, ${pad.y * R}px)`;
  };
  const zone = $('zone');
  zone.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    zone.setPointerCapture(id);
    stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
    stick.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
  const up = e => {
    if (e.pointerId !== id) return;
    id = null; pad.x = pad.y = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  const hold = (el, key) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); pad[key] = true; if (key === 'horn') honk(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { pad[key] = false; });
  };
  hold($('bB'), 'brake'); hold($('bH'), 'horn');
  $('bA').addEventListener('pointerdown', e => { e.preventDefault(); toggleCar(); });
  $('bR').addEventListener('pointerdown', e => { e.preventDefault(); nextStation(); });
  $('bP').addEventListener('pointerdown', e => { e.preventDefault(); pause(!S.paused); });
  $('bM').addEventListener('pointerdown', e => { e.preventDefault(); AUDIO.mute(!AUDIO.muted); $('bM').classList.toggle('off', AUDIO.muted); });
  $('pause').addEventListener('pointerdown', () => pause(false));
  const touchy = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) touchy();
  addEventListener('touchstart', touchy, {once: true, passive: true});
  document.addEventListener('contextmenu', e => e.preventDefault());
}

$('start').onclick = () => start();
$('again').onclick = () => start();
$('resume').onclick = () => start(load());
$('how').onclick = () => {
  $('help').hidden = !$('help').hidden;
  $('how').setAttribute('aria-expanded', !$('help').hidden);
};
{
  const save = load();
  $('resume').hidden = !(save && save.n > 0 && save.n < MISSIONS.length);
  if (save) $('resume').textContent = `Weiterspielen (Auftrag ${save.n + 1}/${MISSIONS.length})`;
}

// ---------- rendering

function strokeLayer(l, style, w, grow = 0) {
  ctx.strokeStyle = style;
  for (const [rw, path] of l) { ctx.lineWidth = (w || rw) + grow; ctx.stroke(path); }
}

function drawPitch(a) {
  const L = a.u1 - a.u0, Wd = a.v1 - a.v0, line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  ctx.save();
  local(a);
  ctx.strokeStyle = '#e8efe0'; ctx.lineWidth = .28; ctx.lineCap = 'butt';
  if (a.s === 'soccer') {
    for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#3f8a35' : '#49983d'; ctx.fillRect(a.u0 + L / 10 * i, a.v0, L / 10 + .05, Wd); }
    ctx.strokeRect(a.u0 + 1.5, a.v0 + 1.5, L - 3, Wd - 3);
    line(0, a.v0 + 1.5, 0, a.v1 - 1.5);
    ctx.beginPath(); ctx.arc(0, 0, Math.min(9.15, Wd * .18), 0, TAU); ctx.stroke();
    for (const s of [-1, 1]) {
      const x = s * (L / 2 - 1.5), bw = Math.min(40, Wd * .6), sw = Math.min(18, Wd * .3);
      ctx.strokeRect(Math.min(x, x - s * 16.5), -bw / 2, 16.5, bw);
      ctx.strokeRect(Math.min(x, x - s * 5.5), -sw / 2, 5.5, sw);
      ctx.fillStyle = '#f4f4ef'; ctx.fillRect(Math.min(x, x + s * 1.6), -3.7, 1.6, 7.4);
    }
  } else {
    ctx.fillStyle = a.s === 'tennis' ? TEX.clay : TEX.play;
    ctx.fill(a.lpath || (a.lpath = new Path2D(`M${a.lp.join(' ')}Z`)));
    const n = Math.max(1, Math.round(Wd / 18)), ch = Wd / n; // courts side by side
    for (let i = 0; i < n; i++) {
      const y = a.v0 + ch * i + ch / 2, cl = Math.min(L - 6, 23.8), cw = Math.min(ch - 5, 11);
      ctx.strokeRect(-cl / 2, y - cw / 2, cl, cw);
      ctx.strokeStyle = '#30343a'; line(0, y - cw / 2 - .8, 0, y + cw / 2 + .8); ctx.strokeStyle = '#e8efe0';
    }
  }
  ctx.restore();
  ctx.lineCap = 'round';
}

function drawGround(x0, y0, x1, y1) {
  ctx.fillStyle = TEX.grass;
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  const seen = a => a.x1 > x0 && a.x0 < x1 && a.y1 > y0 && a.y0 < y1;
  for (const a of AREAS) if (seen(a) && a.fill) { ctx.fillStyle = a.fill; ctx.fill(a.path); }
  for (const a of AREAS) if (seen(a) && a.k === 'pitch') drawPitch(a);
  strokeLayer(ROADS.stream, '#3a72a2');
  strokeLayer(ROADS.bank, '#3c6829');
  strokeLayer(ROADS.river, TEX.water);
  ctx.lineCap = 'butt';
  strokeLayer(ROADS.rail, TEX.gravel, 3.4);
  ctx.setLineDash([.35, .9]); strokeLayer(ROADS.rail, '#4a3420', 2.4); ctx.setLineDash([]);
  strokeLayer(ROADS.rail, '#a8a8a2', 1.5); strokeLayer(ROADS.rail, '#6c675d', 1.15);
  ctx.lineCap = 'round';
  strokeLayer(ROADS.dirt, TEX.dirt);
  strokeLayer(ROADS.foot, '#b9ad8a');
  strokeLayer(ROADS.kerb, '#3a3d36');
  strokeLayer(ROADS.walk, TEX.sidewalk);
  strokeLayer(ROADS.road, TEX.asphalt);
  strokeLayer(ROADS.cobble, TEX.cobble);
  ctx.setLineDash([3, 5]); ctx.lineCap = 'butt';
  strokeLayer(ROADS.line, '#d8d4c0', .28);
  ctx.setLineDash([]); ctx.lineCap = 'round';
  ctx.strokeStyle = '#2a5a22'; ctx.lineWidth = 1.7; ctx.stroke(HEDGES);
  ctx.strokeStyle = '#3b7d2e'; ctx.lineWidth = .9; ctx.stroke(HEDGES);
  const j = S.job, to = j && j.to;
  if (to && to !== j.veh && to !== j.prey) { // where to go: a pulsing ring on the ground
    const pulse = Math.sin(S.t * 5);
    ctx.fillStyle = 'rgba(255,210,62,.3)'; ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = .5;
    ctx.beginPath(); ctx.arc(to.x, to.y, 3.4 + pulse * .5, 0, TAU); ctx.fill(); ctx.stroke();
    if (j.step.do === 'hold') { ctx.beginPath(); ctx.arc(to.x, to.y, j.step.r || 10, 0, TAU); ctx.stroke(); }
  }
  if (DEBUG) for (const k in SPOT) { ctx.fillStyle = '#f0f'; ctx.beginPath(); ctx.arc(SPOT[k].x, SPOT[k].y, 1.5, 0, TAU); ctx.fill(); }
}

function drawShadows(builds, trees) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  for (const b of builds) { ctx.save(); ctx.translate(b.h * .35, b.h * .35); ctx.fill(b.path); ctx.restore(); }
  ctx.beginPath();
  for (const t of trees) { ctx.moveTo(t.x + 1.6 + t.r * .9, t.y + 1.6); ctx.arc(t.x + 1.6, t.y + 1.6, t.r * .9, 0, TAU); }
  ctx.fill();
}

// Buildings lean away from the screen centre, like looking straight down from a helicopter.
function drawBuildings(builds, cx, cy, hc) {
  for (const b of builds) b.d = (b.mx - cx) ** 2 + (b.my - cy) ** 2;
  builds.sort((a, b) => b.d - a.d);
  for (const b of builds) {
    const h = Math.min(b.h, hc * .5), s = hc / (hc - h), ox = cx * (1 - s), oy = cy * (1 - s), p = b.p;
    for (let i = 0, k = 0; i < p.length; i += 2, k++) {
      const ax = p[i], ay = p[i + 1];
      if (b.k === 'o') { // an open roof stands on posts
        ctx.strokeStyle = '#6c6f76'; ctx.lineWidth = .3;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax * s + ox, ay * s + oy); ctx.stroke();
        continue;
      }
      if ((cx - ax) * b.nx[k] + (cy - ay) * b.ny[k] <= 0) continue; // faces away
      const j = (i + 2) % p.length, bx = p[j], by = p[j + 1];
      ctx.fillStyle = ctx.strokeStyle = b.wall[k]; ctx.lineWidth = .15;
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx * s + ox, by * s + oy); ctx.lineTo(ax * s + ox, ay * s + oy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // a row of windows on every floor
      const tall = (s - 1) * Math.hypot((ax + bx) / 2 - cx, (ay + by) / 2 - cy);
      if (tall < .8 || b.h < 5 || b.k === 's') continue;
      ctx.strokeStyle = b.k === 'i' ? 'rgba(40,50,64,.5)' : 'rgba(30,36,48,.78)';
      ctx.lineWidth = tall * .34 / b.floors; ctx.lineCap = 'butt';
      ctx.setLineDash(b.k === 'i' || b.k === 'm' ? [2.6, 1.2] : [1.1, 1.5]);
      for (let f = 0; f < b.floors; f++) {
        const sm = 1 + (s - 1) * (f + .58) / b.floors, om = 1 - sm;
        ctx.beginPath(); ctx.moveTo(ax * sm + cx * om, ay * sm + cy * om); ctx.lineTo(bx * sm + cx * om, by * sm + cy * om); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineCap = 'round';
    }
    ctx.save();
    local(b);
    const lx = (cx - b.mx) * b.ca + (cy - b.my) * b.sa, ly = (cy - b.my) * b.ca - (cx - b.mx) * b.sa; // the camera in the roof's own frame
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = .3;
    const top = Math.min(h + (b.rh || b.apex || 0), hc * .62), s2 = hc / (hc - top), k1 = 1 - s, k2 = 1 - s2;
    if (b.halves) {
      for (const g of b.gables) { // the triangles under the ridge
        ctx.fillStyle = b.wall[g[0]];
        ctx.beginPath();
        ctx.moveTo(g[1] * s + lx * k1, g[2] * s + ly * k1); ctx.lineTo(g[3] * s2 + lx * k2, g[4] * s2 + ly * k2); ctx.lineTo(g[5] * s + lx * k1, g[6] * s + ly * k1);
        ctx.fill();
      }
      for (let n = 0; n < 2; n++) {
        const hp = b.halves[n];
        ctx.beginPath();
        for (let i = 0; i < hp.length; i += 3) {
          const ss = hp[i + 2] ? s2 : s, x = hp[i] * ss + lx * (1 - ss), y = hp[i + 1] * ss + ly * (1 - ss);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = b.roof; ctx.fill();
        ctx.fillStyle = b.tint[n]; ctx.fill();
        ctx.stroke();
      }
      const sm = (s + s2) / 2, km = 1 - sm;
      if (b.pv != null) { // solar panels
        const dir = b.pv ? -1 : 1, half = (b.v1 - b.v0) / 2, len = (b.rx1 - b.rx0) * .62, x = (b.rx0 + b.rx1) / 2 - len / 2;
        ctx.fillStyle = '#1d2c4d';
        ctx.fillRect(x * sm + lx * km, (b.ry + dir * half * (dir > 0 ? .22 : .78)) * sm + ly * km, len * sm, half * .56 * sm);
      }
      if (b.chim) { ctx.fillStyle = '#5a2c22'; ctx.fillRect(b.chim[0] * s2 + lx * k2 - .45, b.chim[1] * s2 + ly * k2 - .45, .9, .9); ctx.fillStyle = '#1c1c1c'; ctx.fillRect(b.chim[0] * s2 + lx * k2 - .2, b.chim[1] * s2 + ly * k2 - .2, .4, .4); }
    } else if (b.apex) { // spires and silo lids: every wall gets a triangle up to the tip
      const lp = b.lp;
      for (let i = 0, k = 0; i < lp.length; i += 2, k++) {
        const j = (i + 2) % lp.length;
        ctx.beginPath();
        ctx.moveTo(lp[i] * s + lx * k1, lp[i + 1] * s + ly * k1); ctx.lineTo(lp[j] * s + lx * k1, lp[j + 1] * s + ly * k1); ctx.lineTo(lx * k2, ly * k2);
        ctx.closePath();
        ctx.fillStyle = b.roof; ctx.fill();
        ctx.fillStyle = `rgba(0,0,0,${(.25 + .25 * (b.nx[k] * LIGHT[0] + b.ny[k] * LIGHT[1])).toFixed(2)})`; ctx.fill();
      }
      if (b.k === 't') { ctx.fillStyle = '#e0b21c'; ctx.fillRect(lx * k2 - .35, ly * k2 - .35, .7, .7); }
    } else {
      ctx.transform(s, 0, 0, s, lx * k1, ly * k1);
      ctx.fillStyle = b.roof; ctx.fill(b.lpath);
      ctx.lineWidth = .4; ctx.stroke(b.lpath);
      if (b.k !== 'o' && b.a > 30) { ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = .25; ctx.save(); ctx.clip(b.lpath); ctx.lineWidth = 1.6; ctx.stroke(b.lpath); ctx.restore(); } // parapet
      if (b.units) for (const [ux, uy, us] of b.units) {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(ux + .4, uy + .4, us, us * .7);
        ctx.fillStyle = '#c9cdd3'; ctx.fillRect(ux, uy, us, us * .7);
        ctx.fillStyle = '#7d828a'; ctx.fillRect(ux + us * .15, uy + us * .12, us * .7, us * .12);
      }
    }
    if (b.label) {
      const sl = b.halves ? s2 : 1, size = clamp(Math.min((b.u1 - b.u0) / (b.label.length * .56), (b.v1 - b.v0) * .5), 2.4, 13);
      if (b.halves) ctx.transform(s2, 0, 0, s2, lx * k2, ly * k2);
      ctx.font = `${size}px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = size * .14 / sl; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineJoin = 'round';
      ctx.strokeText(b.label, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.label, 0, 0);
    }
    ctx.restore();
  }
}

function drawTrees(trees, cx, cy, hc) {
  ctx.strokeStyle = '#4a3420'; ctx.lineWidth = .5;
  for (const t of trees) {
    const s = hc / (hc - t.h), x = t.x * s + cx * (1 - s), y = t.y * s + cy * (1 - s);
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = S.mode === 'play' && Math.hypot(x - S.P.x, y - S.P.y) < t.r + 2.5 ? .4 : 1; // see under the canopy
    ctx.drawImage(CANOPY[t.s], x - t.r, y - t.r, t.r * 2, t.r * 2);
  }
  ctx.globalAlpha = 1;
}

function drawPerson(p, shirt, hair) {
  const sw = Math.sin(p.t * 4) * .22, R = (x, y, w, h, f) => { ctx.fillStyle = f; ctx.fillRect(x, y, w, h); };
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1.3, 1.3); // a bit larger than life, to be seen
  R(-.15 + sw, -.34, .34, .22, '#1c1c22'); R(-.15 - sw, .12, .34, .22, '#1c1c22'); // feet
  R(-.08 - sw, -.6, .3, .16, '#e0b08a'); R(-.08 + sw, .44, .3, .16, '#e0b08a'); // hands
  R(-.24, -.5, .48, 1, shirt);
  R(-.2, -.22, .42, .44, hair);
  ctx.restore();
}

function drawProps() { // mission scenery: bonfires, tents, people waiting for a lift
  const j = S.job;
  for (const pr of j ? j.m.props || [] : []) {
    const s = SPOT[pr.at], x = s.x + (pr.dx || 0), y = s.y + (pr.dy || 0);
    if (pr.from > j.i || pr.until <= j.i) continue;
    if (pr.k === 'fire') {
      ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
      for (let i = 0; i < 7; i++) {
        const a = S.t * 3 + i * 2.4, r = 1.6 + Math.sin(S.t * 9 + i) * .7;
        ctx.fillStyle = i % 2 ? '#ff5a1f' : '#ffd23e';
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.3, r * .6, 0, TAU); ctx.fill();
      }
      if (Math.random() < .5) puff(x + rand(-1, 1), y + rand(-1, 1), Math.random() < .5 ? 'fire' : 'smoke');
    } else if (pr.k === 'zelt') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.a);
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f4ef' : '#2b62c8'; ctx.fillRect(-12 + i * 3, -5, 3, 10); }
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = .3; ctx.strokeRect(-12, -5, 24, 10);
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.restore();
    } else if (pr.k === 'wer') drawPerson({x, y, a: S.t * .8 + x, t: 0}, pr.col || '#b3372f', '#2a1d12');
  }
}

function drawSprites(x0, y0, x1, y1) {
  const P = S.P, seen = o => o.x > x0 - 14 && o.x < x1 + 14 && o.y > y0 - 14 && o.y < y1 + 14;
  for (const d of S.decals) {
    ctx.fillStyle = d.kind === 'blood' ? 'rgba(140,10,16,.8)' : 'rgba(15,12,10,.55)';
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
  }
  drawProps();
  for (const v of S.items) {
    if (!seen(v)) continue;
    const k = Math.sin(S.t * 5 + v.ph), w = (v.job ? 2.6 : 2) + k * .2;
    ctx.fillStyle = v.job ? 'rgba(255,210,62,.5)' : 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.arc(v.x, v.y, (v.job ? 2.4 : 1.7) + k * .3, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(Math.sin(S.t * 2 + v.ph) * .25);
    ctx.drawImage(icon(v.kind), -w / 2, -w / 2, w, w);
    ctx.restore();
  }
  if (S.mode === 'play' && !P.car && !S.wasted) {
    ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = .15;
    ctx.beginPath(); ctx.arc(P.x, P.y, 1 + Math.sin(S.t * 6) * .1, 0, TAU); ctx.stroke();
    drawPerson(P, '#19c2bd', '#3a2a1a');
  }
  for (const p of S.peds) if (seen(p)) drawPerson(p, p.shirt, p.hair);
  for (const c of S.cars) {
    if (!seen(c)) continue;
    const T = c.T, fx = Math.cos(c.a), fy = Math.sin(c.a);
    if (c.tr) { // the trailer hangs on the rear hitch
      const tt = c.tr.T, hx = c.x - fx * T.L / 2, hy = c.y - fy * T.L / 2;
      ctx.save();
      ctx.translate(hx - Math.cos(c.tr.a) * (tt.L / 2 + .4), hy - Math.sin(c.tr.a) * (tt.L / 2 + .4)); ctx.rotate(c.tr.a);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-tt.L / 2 + .4, -tt.Wd / 2 + .4, tt.L, tt.Wd);
      ctx.drawImage(tt.spr, -tt.L / 2, -tt.Wd / 2, tt.L, tt.Wd);
      ctx.restore();
    }
    for (const sh of [.4, 0]) { // shadow first, then the car
      ctx.save();
      ctx.translate(c.x + sh, c.y + sh); ctx.rotate(c.a);
      if (sh) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-T.L / 2, -T.Wd / 2, T.L, T.Wd); }
      else {
        const spin = c.kind === 'mixer' && !c.dead ? carSprite('mixer', c.col, (S.t * 5 | 0) % 4) : c.spr;
        ctx.drawImage(spin, -T.L / 2, -T.Wd / 2, T.L, T.Wd);
        if (c.siren && !c.dead) { // blue lights
          const on = (S.t * 6 | 0) % 2, x = c.kind === 'fire' ? T.L / 2 - 2.3 : -.2;
          ctx.fillStyle = on ? '#4aa3ff' : '#12327a'; ctx.fillRect(x, -T.Wd / 2 + .3, .5, .6);
          ctx.fillStyle = on ? '#12327a' : '#4aa3ff'; ctx.fillRect(x, T.Wd / 2 - .9, .5, .6);
        }
      }
      ctx.restore();
    }
  }
}

function drawParticles() {
  for (const p of S.parts) {
    const k = p.life / p.max;
    if (p.kind === 'spark' || p.kind === 'blood' || p.kind === 'water') {
      ctx.fillStyle = p.kind === 'spark' ? '#ffd23e' : p.kind === 'blood' ? '#b0121a' : '#9fd0f0';
      ctx.fillRect(p.x, p.y, .35, .35);
      continue;
    }
    ctx.fillStyle = p.kind === 'smoke' ? `rgba(60,60,64,${.5 * (1 - k)})` : p.kind === 'boom' ? `rgba(255,190,90,${1 - k})`
      : k < .5 ? '#ffd23e' : '#ff5a1f';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.kind === 'smoke' ? .5 + p.life * 1.2 : p.kind === 'boom' ? 2 + k * 8 : .8 - k * .6, 0, TAU);
    ctx.fill();
  }
}

function render() {
  const z = S.cam.z, cx = S.cam.x + rand(-1, 1) * S.shake, cy = S.cam.y + rand(-1, 1) * S.shake, hw = VW / 2 / z, hh = VH / 2 / z;
  const x0 = cx - hw, y0 = cy - hh, x1 = cx + hw, y1 = cy + hh, hc = 520 / z; // hc = camera height in metres
  ctx.setTransform(z, 0, 0, z, Math.round(VW / 2 - cx * z), Math.round(VH / 2 - cy * z));
  ctx.lineJoin = ctx.lineCap = 'round';
  const builds = gridFind(BG, x0 - 30, y0 - 30, x1 + 30, y1 + 30).concat(BUILD.filter(b => b.k === 'o' && b.x1 > x0 - 30 && b.x0 < x1 + 30 && b.y1 > y0 - 30 && b.y0 < y1 + 30));
  const trees = gridFind(TG, x0 - 12, y0 - 12, x1 + 12, y1 + 12);
  drawGround(x0, y0, x1, y1);
  drawShadows(builds, trees);
  drawSprites(x0, y0, x1, y1);
  drawBuildings(builds, cx, cy, hc);
  drawParticles();
  drawTrees(trees, cx, cy, hc);
  // the world ends here
  ctx.fillStyle = 'rgba(8,10,14,.7)';
  const m = v => Math.max(0, v);
  ctx.fillRect(x0, y0, x1 - x0, m(-y0)); ctx.fillRect(x0, H, x1 - x0, m(y1 - H));
  ctx.fillRect(x0, 0, m(-x0), H); ctx.fillRect(W, 0, m(x1 - W), H);
  if (S.mode === 'play') drawOverlay(cx, cy, z);
}

function drawOverlay(cx, cy, z) { // labels and pointers, in screen pixels
  const P = S.P, j = S.job, sx = x => (x - cx) * z + VW / 2, sy = y => (y - cy) * z + VH / 2;
  const label = (s, x, y, col) => { ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = col; ctx.fillText(s, x, y); };
  const arrow = (px, py, a, col, size = 1) => {
    ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.scale(size, size);
    for (const [grow, fill] of [[3, '#000'], [0, col]]) {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(10 + grow, 0); ctx.lineTo(-6 - grow, -8 - grow); ctx.lineTo(-6 - grow, 8 + grow); ctx.fill();
    }
    ctx.restore();
  };
  const pointer = (o, col, text) => { // arrow on the screen edge towards something out of view
    const x = sx(o.x), y = sy(o.y), pad = 26;
    if (x > pad && x < VW - pad && y > pad && y < VH - pad) return false;
    const a = Math.atan2(y - VH / 2, x - VW / 2), ca = Math.cos(a), sa = Math.sin(a);
    const k = Math.min((VW / 2 - pad) / Math.abs(ca || 1e-6), (VH / 2 - pad) / Math.abs(sa || 1e-6));
    const px = VW / 2 + ca * k, py = VH / 2 + sa * k;
    arrow(px, py, a, col);
    if (text) label(text, clamp(px - ca * 30, 60, VW - 60), clamp(py - sa * 22, 14, VH - 10), col);
    return true;
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = 'bold 11px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const v of S.items) if (v.job) pointer(v, '#ffd23e');
  if (j && j.to) {
    const to = j.to, far = Math.round(dist(P, to));
    pointer(to, '#ffd23e', (to.name || (to.T && to.name) || 'ZIEL').toUpperCase() + ' ' + far + 'm');
    if (to === j.veh || to === j.prey) { // the car you are after
      const bob = Math.sin(S.t * 6) * 3;
      arrow(sx(to.x), sy(to.y) - 3.2 * z - 12 + bob, Math.PI / 2, to === j.prey ? '#ff5a1f' : '#ffd23e', .8);
    }
    const wp = S.gps && S.gps.wp;
    if (wp && far > 12) { // the yellow arrow by the player shows the way along the roads
      const a = Math.atan2(wp.y - P.y, wp.x - P.x), r = 3.4 * z + 14;
      arrow(sx(P.x) + Math.cos(a) * r, sy(P.y) + Math.sin(a) * r, a, '#ffd23e', .75);
    }
  }
  if (DEBUG) for (const k in SPOT) label(k, sx(SPOT[k].x), sy(SPOT[k].y) - 8, '#f0f');
  ctx.font = 'bold 14px "Courier New", monospace';
  for (const t of S.texts) label(t.s, sx(t.x), sy(t.y), t.col);
}

// ---------- main loop

function resize() {
  const a = innerWidth / innerHeight;
  if (a >= 1) { VH = 450; VW = Math.round(450 * Math.min(a, 2.6)); }
  else { VW = 400; VH = Math.round(400 / Math.max(a, .42)); }
  cv.width = VW; cv.height = VH;
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
resize();

let last = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0);
  last = now;
  if (!S.paused) {
    for (let n = dt > .02 ? 2 : 1, i = 0; i < n; i++) update(dt / n);
    if (S.mode === 'play') guide(dt);
  }
  render();
  if (!S.paused) hud(dt);
  requestAnimationFrame(frame);
}
reset('menu');
requestAnimationFrame(frame);

// Hooks for play-testing from the browser console.
const GTW = {
  get S() { return S; }, SPOT, NODES, MISSIONS,
  tp(key) { const s = SPOT[key], o = S.P.car || S.P; Object.assign(o, {x: s.x, y: s.y, vx: 0, vy: 0}); },
  skip() { if (S.job) { S.job.i = S.job.m.steps.length - 1; nextStep(); } },
  job(n) { S.job = null; S.jobN = n; S.nextJob = 0; },
};

if (location.search.includes('selftest')) { // open index.html?selftest and read the console
  const sq = [0, 0, 10, 0, 10, 10, 0, 10], a = pushOut(10.5, 5, 1, sq), b = pushOut(9, 5, 1, sq), home = field(SPOT.hq);
  const ride = (from, to) => { // follow the yellow arrow from one place to another, as the crow walks the roads
    const f = field(to), o = {x: from.x, y: from.y};
    for (let i = 0; i < 400 && dist(o, to) > 50; i++) { const w = waypoint(f, o, 40); if (!w) return false; const d = dist(o, w) || 1; o.x += (w.x - o.x) / d * 12; o.y += (w.y - o.y) / d * 12; }
    return dist(o, to) <= 50;
  };
  const used = new Set(MISSIONS.flatMap(m => [...m.steps.flatMap(s => [s.to, s.at, s.near]), ...(m.props || []).map(p => p.at)]).filter(Boolean));
  const checks = {
    'clear of a wall: no push': pushOut(20, 5, 1, sq) === null,
    'touching a wall: pushed straight out': a && a[0] === 1 && Math.abs(a[2] - .5) < 1e-9,
    'inside a building: pushed out through the nearest wall': b && b[0] === 1 && Math.abs(b[2] - 2) < 1e-9,
    'every mission place exists': [...used].every(k => SPOT[k] || console.error('unknown place', k)),
    'every place has room for a car': Object.values(SPOT).every(s => !blocked(s.x, s.y, 1.2) || console.error('blocked', s.key)),
    'no place is under water': Object.values(SPOT).every(s => (surfAt(s.x, s.y) & 9) !== 8 || console.error('wet', s.key)),
    'a road leads from the HQ to every place': Object.values(SPOT).every(s => home[nearNode(s, 'gps')] < 1e8 || console.error('cut off', s.key)),
    'the yellow arrow leads from the HQ to every place and back': Object.values(SPOT).every(s => ride(SPOT.hq, s) && ride(s, SPOT.hq) || console.error('arrow lost', s.key)),
    'every mission pays and talks': MISSIONS.every(m => m.reward > 0 && m.intro.length && m.outro.length && m.steps.every(s => s.obj)),
  };
  for (const k in checks) console.assert(checks[k], k);
  document.title = Object.values(checks).every(Boolean) ? 'selftest ok' : 'selftest FAILED';
}

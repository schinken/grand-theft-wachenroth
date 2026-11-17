/**
 * @fileoverview The fold-out map (Tab): the whole village on paper, true to
 * scale.
 */

import {MAP} from '../map.js';
import * as audio from './audio.js';
import {BUILD} from './buildings.js';
import {paintRelief} from './draw-ground.js';
import {AREAS, DRIVE, ROADS, SEGS} from './land.js';
import {PLACES} from './missions.js';
import {field, pathLength, routeLine} from './places.js';
import {state} from './state.js';
import {TAU, WORLD_H, WORLD_W, byId, canvas, clamp, metres} from './util.js';

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
  'koppel',
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
  paintRelief(g);
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
  const streets = [...ROADS.road, ...ROADS.cobble, ...ROADS.lane];
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
export function showMap(on) {
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

/** Draws the map with the route, the target and the player. */
export function drawMap() {
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

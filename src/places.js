/**
 * @fileoverview The places of the map, and the roads to them: the nearest
 * junction, the distance of every junction from a place, and the way down the
 * road.
 */

import {MAP} from '../map.js';
import {BUILD, NEW_ESTATE} from './buildings.js';
import {nearest} from './geometry.js';
import {LINKS, NODES} from './land.js';
import {PLACES} from './missions.js';
import {ROOFS, fromFrame} from './roofs.js';
import {blocked, roadside} from './scenery.js';
import {WORLD_H, WORLD_W, dist} from './util.js';

export const SPOT = {};
for (const k of Object.keys(MAP.pois)) {
  SPOT[k] = Object.assign(roadside(...MAP.pois[k]), {
    key: k,
    name: PLACES[k] || k,
  });
}

export const NEW_HOUSES = BUILD.filter(
  b => b.rd && b.rd[2][6].n === NEW_ESTATE
);

/**
 * Where a car stands on the drive of a house, nose to the street.
 * @param {!Building} b A house that knows its street.
 * @return {{x: number, y: number, a: number}}
 */
export function driveSpot(b) {
  const spec = ROOFS[b.poi];
  if (spec && spec.park) {
    const [x, y] = fromFrame(b, spec.park[0], spec.park[1]);
    return {x, y, a: Math.atan2(b.ca, -b.sa)};
  }
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
export const HOME = BUILD.find(b => b.poi === 'hq');
// The modelled buildings whose plot is painted by hand, see paintYard()
export const MODELLED = BUILD.filter(b => ROOFS[b.poi] && ROOFS[b.poi].yard);

/**
 * Index of the junction closest to a point.
 * @param {!Point} o
 * @param {string} links The links the junction must have: 'car', 'gps' or
 *     'walk'.
 * @return {number}
 */
export function nearNode(o, links) {
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
export function nearLink(o) {
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
export function field(o) {
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
export function downhill(f, n) {
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
export function waypoint(f, o, ahead) {
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

export const pathLength = p => {
  let d = 0;
  for (let i = 2; i < p.length; i += 2) {
    d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  }
  return d;
};

/**
 * The way between two points along the roads.
 * @param {!Float32Array} f
 * @param {!Point} o
 * @param {!Point} to
 * @return {!Array<number>} A flat list of x, y pairs.
 */
export function routeLine(f, o, to) {
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

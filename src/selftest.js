/**
 * @fileoverview The built-in checks: open index.html?selftest.
 */

import {MAP} from '../map.js';
import {BUILD} from './buildings.js';
import {inFront, parting} from './draw-buildings.js';
import {FENCE_TILES, FURROWS, fieldMasks} from './draw-ground.js';
import {pushOut} from './geometry.js';
import {ROADS, surfAt} from './land.js';
import {MISSIONS} from './missions.js';
import {knockPed, stepPed} from './people.js';
import {HOME, SPOT, field, nearNode, waypoint} from './places.js';
import {HOME_GABLES, HOME_SLOPES, ROOFS} from './roofs.js';
import {TREES, blocked} from './scenery.js';
import {state} from './state.js';
import {
  CROSSINGS,
  DAY,
  RAIL_LEN,
  TRAIN,
  TRAIN_DUE,
  placeTrain,
} from './train.js';
import {dist} from './util.js';

/** Runs the checks: the page title says how they went. */
export function selftest() {
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
    'the map has its surveyed trees, roof colours, yards, fields and fences':
      FENCE_TILES.size > 100 &&
      fieldMasks.length === FURROWS.length &&
      TREES.length > 4000 &&
      BUILD.filter(b => b.c).length > 1000 &&
      MAP.yards.length > 1000,
    'the house between the camera and another one is drawn last': (() => {
      const box = (id, x, y) => {
        const p = [x, y, x + 10, y, x + 10, y + 10, x, y + 10];
        return {id: -id, p, a: 100, mx: x + 5, my: y + 5};
      };
      const west = box(1, 0, 0);
      const east = box(2, 12, 0);
      // An L-shaped house with a shed in its corner: no line keeps them apart.
      const ell = {id: -3, a: 300, mx: 10, my: 10};
      ell.p = [0, 0, 20, 0, 20, 20, 10, 20, 10, 10, 0, 10];
      const shed = {
        id: -4,
        a: 16,
        mx: 5,
        my: 15,
        p: [3, 13, 7, 13, 7, 17, 3, 17],
      };
      return (
        inFront(west, east, -20, 5) &&
        !inFront(west, east, 40, 5) &&
        inFront(east, west, 40, 5) &&
        parting(ell, shed) === null &&
        inFront(ell, shed, 5, -20) &&
        inFront(shed, ell, 5, 40)
      );
    })(),
    "Flo's house has its own roof: slopes, gable walls and solar panels":
      HOME.planes.filter(f => f.wall).length === HOME_GABLES.length &&
      HOME.planes.filter(f => !f.wall).length === HOME_SLOPES.length &&
      BUILD.filter(b => ROOFS[b.poi]).length === Object.keys(ROOFS).length &&
      ROADS.lane.length === 1 &&
      HOME.planes.every(f => f.p.every(v => v > -40 && v < 40)) &&
      HOME.planes.filter(f => f.pv && f.pv.length).length === 2,
    'the surveyed roofs are there, closed by gable walls':
      BUILD.filter(b => b.f).length >= 5 &&
      BUILD.filter(b => b.f).every(
        b =>
          b.planes.filter(f => !f.wall).length === b.f.length &&
          b.planes.filter(f => f.wall).length >= 2 &&
          b.planes.every(f => f.p.every(v => v > -40 && v < 40))
      ),
    'a pedestrian who is hit flies, lands and runs off, unhurt': (() => {
      const p = {x: 50, y: 50, a: 0, fly: 0, flyT: 1, vx: 0, vy: 0};
      Object.assign(p, {spin: 0, spinV: 0, flee: 0, t: 0});
      knockPed(p, 10, 0);
      const flying = p.fly > 0;
      for (let i = 0; i < 90; i++) {
        stepPed(p, 1 / 60);
      }
      return flying && p.fly <= 0 && p.flee > 0 && p.x > 53;
    })(),
    'the steel train runs the whole rail, and comes once a day': (() => {
      const away = placeTrain(TRAIN_DUE - 10) < 0;
      const under = placeTrain(TRAIN_DUE + 200) > 0 && TRAIN.every(v => v.on);
      const later = placeTrain(TRAIN_DUE + DAY + 200) > 0;
      placeTrain(state.t);
      return RAIL_LEN > 2000 && CROSSINGS.length > 0 && away && under && later;
    })(),
    'the church has its surveyed tower, standing on the church': BUILD.some(
      b => b.k === 't' && b.apex > 10 && b.on && b.on.k === 'c'
    ),
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

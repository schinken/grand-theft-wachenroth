/**
 * @fileoverview The built-in checks: open index.html?selftest.
 */

import {MAP} from '../map.js';
import {BUILD} from './buildings.js';
import {hill, pedals, rollCar} from './cars.js';
import {inFront, parting} from './draw-buildings.js';
import {FENCE_TILES, FURROWS, fieldMasks} from './draw-ground.js';
import {tyreMarks} from './effects.js';
import {enclosed} from './jobs.js';
import {pushOut} from './geometry.js';
import {look, near} from './hills.js';
import {ROADS, heightAt, surfAt} from './land.js';
import {MISSIONS} from './missions.js';
import {knockPed, stepPed} from './people.js';
import {HOME, MODELLED, SPOT, field, nearNode, waypoint} from './places.js';
import {slidePath, stepSlide} from './player.js';
import {HOME_GABLES, HOME_SLOPES, ROOFS} from './roofs.js';
import {TREES, blocked} from './scenery.js';
import {TYPES, carSprite} from './sprites.js';
import {state} from './state.js';
import {
  CROSSINGS,
  DAY,
  RAIL_LEN,
  TRAIN,
  TRAIN_DUE,
  placeTrain,
} from './train.js';
import {canvas, dist} from './util.js';
import {paintYard} from './yards.js';

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
      ...m.steps.flatMap(s => [s.to, s.at, s.near, ...(s.via || [])]),
      ...m.steps.flatMap(s => s.shut || []),
      ...(m.walk || []),
      m.home,
      ...(m.props || []).map(p => p.at),
    ]).filter(Boolean)
  );
  const rolling = (kind, steer = 1) => ({
    x: 0,
    y: 0,
    a: 0,
    wheelAngle: 0,
    steer,
    type: TYPES[kind],
  });
  const driveCircle = (c, speed, seconds = 2) => {
    for (let i = 0; i < seconds * 120; i++) {
      rollCar(c, speed, 0, 1 / 120, true);
    }
    return c;
  };
  const checks = {
    'the handbrake stops strongly even with throttle and never reverses speed':
      (() => {
        const brake = {thr: 1, hb: true, type: TYPES.car};
        const coast = {thr: 0, hb: false, type: TYPES.car};
        let stopped = 30;
        let rollingSpeed = 30;
        for (let i = 0; i < 120; i++) {
          stopped = pedals(brake, stopped, 38, 15, 1 / 120);
          rollingSpeed = pedals(coast, rollingSpeed, 38, 15, 1 / 120);
        }
        return (
          stopped < rollingSpeed * 0.4 &&
          pedals(brake, 0.1, 38, 15, 0.1) === 0 &&
          pedals(brake, -0.1, 38, 15, 0.1) === 0
        );
      })(),
    'the hills are in the map: Flo lives some 20 m above the church':
      Math.abs(heightAt(...MAP.pois.hq) - heightAt(...MAP.pois.church) - 20) <
      3,
    'from above the church its ground looks as it is, the hill of Flo nearer':
      (() => {
        const [x, y] = MAP.pois.church;
        look({x, y, h: 50, z: 9, ox: 0, oy: 0, flat: false});
        return near(x, y) === 1 && near(...MAP.pois.hq) > 1.1;
      })(),
    'Bergstraße climbs to the north, and a car left alone on it stays put':
      (() => {
        const up = hill(1114, 727, 0, -1);
        const coast = {thr: 0, hb: false, type: TYPES.car};
        return (
          up > 0.2 &&
          hill(1114, 727, 0, 1) === -up &&
          pedals(coast, -9.81 * 0.4 * 0.01, 38, 15, 0.01) === 0 &&
          pedals(coast, 9.81 * 0.4 * 0.01, 38, 15, 0.01) === 0
        );
      })(),
    'a car slide crosses the body and rejects cars behind or moving fast':
      (() => {
        const car = {x: 0, y: 0, a: 0, vx: 0, vy: 0, type: TYPES.car};
        const player = {x: 0, y: -2, a: Math.PI / 2};
        const path = slidePath(player, car);
        return (
          path &&
          player.y + path.distance > car.type.width / 2 + 0.4 &&
          slidePath({...player, a: -Math.PI / 2}, car) === null &&
          slidePath(player, {...car, vx: 8}) === null &&
          slidePath(player, {...car, type: TYPES.heli}) === null
        );
      })(),
    'a slide lands once, keeps the player on foot and has a cooldown': (() => {
      const player = {
        x: 1,
        y: 2,
        car: null,
        slide: {x: 1, y: 2, dx: 3, dy: 4, t: 0, duration: 0.5},
      };
      stepSlide(player, 0.25);
      const midway =
        player.x > 1 && player.x < 4 && player.y > 2 && player.y < 6;
      stepSlide(player, 1);
      return (
        midway &&
        player.x === 4 &&
        player.y === 6 &&
        !player.slide &&
        !player.car &&
        player.slideCool > 0
      );
    })(),
    'tyre marks form two bounded tracks and stop when grip returns': (() => {
      const saved = state.skids;
      state.skids = [];
      try {
        const car = {x: 0, y: 0, a: 0, skid: 1, type: TYPES.car};
        tyreMarks(car);
        car.x += 0.5;
        tyreMarks(car);
        const pair =
          state.skids.length === 2 && state.skids[0].y * state.skids[1].y < 0;
        for (let i = 0; i < 1000; i++) {
          car.x += 0.5;
          tyreMarks(car);
        }
        const bounded = state.skids.length <= 1600;
        const count = state.skids.length;
        car.skid = 0;
        car.x++;
        tyreMarks(car);
        return pair && bounded && state.skids.length === count && !car.skidFrom;
      } finally {
        state.skids = saved;
      }
    })(),
    'steering at rest turns the wheels without rotating the vehicle': (() => {
      const c = driveCircle(rolling('car'), 0);
      return c.x === 0 && c.y === 0 && c.a === 0 && c.wheelAngle > 0.6;
    })(),
    'short wheelbases turn tighter and reversing reverses the turn': (() => {
      const compact = rolling('car');
      compact.type = {...compact.type, wheelbase: 1.84};
      const small = driveCircle(compact, 4);
      const normal = driveCircle(rolling('car'), 4);
      const large = driveCircle(rolling('truck'), 4);
      const reverse = driveCircle(rolling('car'), -4);
      return (
        small.a > normal.a &&
        normal.a > large.a &&
        Math.abs(reverse.a + normal.a) < 1e-9
      );
    })(),
    'the rear axle rolls around its turn centre, the body drifts outwards':
      (() => {
        const c = rolling('car', 0.4 / 0.62);
        c.wheelAngle = 0.4;
        const rear = c.type.wheelbase / 2;
        const radius = c.type.wheelbase / Math.tan(c.wheelAngle);
        driveCircle(c, 4);
        const x = c.x - Math.cos(c.a) * rear;
        const y = c.y - Math.sin(c.a) * rear;
        const sideSpeed =
          c.vy * Math.cos(c.a) -
          c.vx * Math.sin(c.a) -
          (4 * Math.tan(c.wheelAngle)) / 2;
        return (
          Math.abs(Math.hypot(x + rear, y - radius) - radius) < 1e-8 &&
          sideSpeed < 0 &&
          sideSpeed > -0.05
        );
      })(),
    'fast steering remains responsive and stays straight with no input':
      (() => {
        const fast = driveCircle(rolling('car'), 38);
        const straight = driveCircle(rolling('car', 0), 10);
        const radius = fast.type.wheelbase / Math.tan(fast.wheelAngle);
        return (
          radius > 20 &&
          radius < 35 &&
          fast.wheelAngle < 0.2 &&
          Math.abs(straight.x - 20) < 1e-8 &&
          straight.y === 0 &&
          straight.a === 0
        );
      })(),
    'clear of a wall: no push': pushOut(20, 5, 1, sq) === null,
    'touching a wall: pushed straight out':
      a && a[0] === 1 && Math.abs(a[2] - 0.5) < 1e-9,
    'inside a building: pushed out through the nearest wall':
      b && b[0] === 1 && Math.abs(b[2] - 2) < 1e-9,
    'the map has its surveyed trees, roof colours, yards, fields, fences and hills':
      FENCE_TILES.size > 100 &&
      fieldMasks.length === FURROWS.length &&
      TREES.length > 4000 &&
      BUILD.filter(b => b.c).length > 1000 &&
      MAP.yards.length > 1000 &&
      MAP.relief.length > 1000,
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
    'the plots that ROOFS says are painted are the ones paintYard() paints':
      BUILD.filter(b => ROOFS[b.poi]).every(
        b =>
          MODELLED.includes(b) === paintYard(canvas(1, 1).getContext('2d'), b)
      ),
    'every kind of vehicle has its picture': Object.keys(TYPES).every(
      k => carSprite(k, '#e8e6df').width > 0
    ),
    'the posts of the fire brigade close the roads round the lantern walk':
      MISSIONS.filter(m => m.walk).every(m => {
        const far = field(SPOT[m.walk[1]]);
        const zones = m.steps
          .filter(s => s.shut)
          .map(s => enclosed(s.shut, far));
        // Shut in, the roads are few; through a gap the whole village leaks.
        return zones[0].size > 10 && zones.every(zone => zone.size < 60);
      }),
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

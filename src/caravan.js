/**
 * @fileoverview The visitor, his interpreter and the caravan escort.
 */

import {hitch, makeCar} from './cars.js';
import {info, page} from './effects.js';
import {nearest} from './geometry.js';
import {DRIVE, NODES, SEGS, surfAt, town} from './land.js';
import {SPOT, field, nearLink, routeLine} from './places.js';
import {shove} from './player.js';
import {blocked} from './scenery.js';
import {state} from './state.js';
import {dist, wrap} from './util.js';

/**
 * A clear pavement stretch northwest of the centre, away from the visitor.
 * @return {!Array<!Point>} The ends of the student's walking route.
 */
function studentWalk() {
  const centre = SPOT.church;
  const target = {x: centre.x - 120, y: centre.y - 100};
  let best = null;
  let score = Infinity;
  for (const seg of SEGS) {
    const [ax, ay, bx, by, width, length, road] = seg;
    if (
      !DRIVE.includes(road.t) ||
      !town(road) ||
      road.t === 'service' ||
      length < 24
    ) {
      continue;
    }
    const dx = (bx - ax) / length;
    const dy = (by - ay) / length;
    const half = Math.min(12, length / 2 - 6);
    for (const side of [-1, 1]) {
      const off = (width / 2 + 0.9) * side;
      const middle = {
        x: (ax + bx) / 2 - dy * off,
        y: (ay + by) / 2 + dx * off,
      };
      const cost = dist(middle, target);
      if (
        cost >= score ||
        middle.x > centre.x - 40 ||
        middle.y > centre.y - 30
      ) {
        continue;
      }
      const ends = [-half, half].map(d => ({
        x: middle.x + dx * d,
        y: middle.y + dy * d,
      }));
      let clear = true;
      for (let d = -half; d <= half; d += 0.5) {
        const x = middle.x + dx * d;
        const y = middle.y + dy * d;
        if (
          blocked(x, y, 0.45) ||
          surfAt(x, y) & 8 ||
          SEGS.some(s => {
            const q = nearest(x, y, s[0], s[1], s[2], s[3]);
            return Math.hypot(x - q[0], y - q[1]) < s[4] / 2 + 0.35;
          })
        ) {
          clear = false;
          break;
        }
      }
      if (clear) {
        best = ends;
        score = cost;
      }
    }
  }
  return best;
}

/**
 * Starts a conversation step or the escort, keeping its cast between steps.
 * @param {!Object} j
 */
export function beginCaravan(j) {
  if (!j.caravan) {
    const [link, x, y] = nearLink(SPOT.townhall);
    const a = NODES[link[0]];
    const b = NODES[link[1]];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const lane = Math.min(a.w, b.w) / 4;
    const rig = hitch(
      makeCar(
        x - Math.sin(angle) * lane,
        y + Math.cos(angle) * lane,
        angle,
        'car',
        '#c3ba87'
      ),
      'caravan'
    );
    // Reserve space for the entire parked rig, including its trailer.
    state.cars = state.cars.filter(
      c => c === rig || c === state.player.car || dist(c, rig) > 14
    );
    const visitor = {
      x: rig.x - Math.sin(angle) * 3.5,
      y: rig.y + Math.cos(angle) * 3.5,
      a: angle,
      t: 0,
    };
    shove(visitor, 0.4);
    const walk = studentWalk();
    j.caravan = {
      rig,
      visitor,
      student: {...walk[0], a: angle, t: 0},
      walk,
      walkTo: 1,
      energy: false,
      aboard: false,
      health: rig.hp,
      wait: 0,
      far: false,
      trail: [],
    };
    // Mission vehicles are kept when the player leaves the area.
    j.prey = rig;
  }
  const c = j.caravan;
  const phase = j.step.phase;
  if (phase === 'visitor' || phase === 'translate') {
    j.to = c.visitor;
  }
  if (['find', 'drink', 'board'].includes(phase)) {
    j.to = c.student;
  }
  if (phase === 'escort') {
    page(
      'Wohnwagenfahrer: Nu fahr när sachte vor, iech kumm fei hinnerdrher. Mei Wuhngwaachn muss heil bleim!'
    );
    const line = routeLine(field(state.player), c.rig, state.player);
    c.trail = [];
    for (let i = 2; i < line.length; i += 2) {
      c.trail.push({x: line[i], y: line[i + 1]});
    }
    c.last = {...state.player};
    c.rig.ai = {escort: c, wait: 0};
  }
}

/**
 * Walks the student between nearby pavement spots while he plays on his phone.
 * @param {!Object} c
 * @param {number} dt
 */
function walkStudent(c, dt) {
  const p = c.student;
  if (dist(p, c.walk[c.walkTo]) < 0.1) {
    c.walkTo = 1 - c.walkTo;
  }
  const target = c.walk[c.walkTo];
  p.a = Math.atan2(target.y - p.y, target.x - p.x);
  const step = Math.min(dist(p, target), dt * 0.9);
  p.x += Math.cos(p.a) * step;
  p.y += Math.sin(p.a) * step;
  p.t += step;
}

/**
 * Keeps the interpreter with the player, and records the lead car's route.
 * @param {!Object} j
 * @param {number} dt
 */
export function moveCaravan(j, dt) {
  const c = j.caravan;
  if (!c) {
    return;
  }
  const p = state.player;
  const phase = j.step.phase;
  if (['visitor', 'family', 'find'].includes(phase)) {
    // Pause when approached, so the conversation target cannot walk away.
    if (p.car || dist(p, c.student) > 6) {
      walkStudent(c, dt);
    }
  }
  if (c.aboard && !p.car) {
    const d = dist(c.student, p);
    if (d > 2) {
      c.student.a = Math.atan2(p.y - c.student.y, p.x - c.student.x);
      const step = Math.min(d - 2, 3.5 * dt);
      c.student.x += Math.cos(c.student.a) * step;
      c.student.y += Math.sin(c.student.a) * step;
      c.student.t += step;
      shove(c.student, 0.4);
    }
  } else if (c.aboard) {
    Object.assign(c.student, {x: p.x, y: p.y, a: p.a});
  }
  if (p.car === c.rig) {
    j.caught = 'escort';
  }
  if (phase !== 'escort') {
    return;
  }
  // Store only the route actually driven; a shortcut is never invented.
  if (p.car && dist(p, c.last) > 2) {
    c.trail.push({x: p.x, y: p.y});
    c.last = {x: p.x, y: p.y};
  }
  if (c.trail.length > 2500) {
    j.caught = 'escort';
  }
  const far = dist(p, c.rig) > 65;
  if (far && !c.far) {
    info('Warte auf das Wohnwagengespann!');
  }
  c.far = far;
  if (c.health - c.rig.hp > c.health * 0.25) {
    j.caught = 'escort';
  }
}

/**
 * Checks conversations, the bought drink, boarding and arrival together.
 * @param {!Object} j
 * @param {number} dt
 * @return {boolean} Whether this mission step is finished.
 */
export function caravanDone(j, dt) {
  const c = j.caravan;
  const p = state.player;
  const near = dist(p, j.to) < 3.5 && !p.car;
  const stopped = p.car && Math.abs(p.car.vf) < 1;
  switch (j.step.phase) {
    case 'visitor':
      if (near) {
        page(
          'Wohnwagenfahrer: Nu gugge när! Mei Audoo rucklt un dr Wuhngwaachn hängt aa noch droo. Wu issn do e Wärkschdadd? Iech verschdie eich fei net!'
        );
      }
      return near;
    case 'family':
    case 'find':
    case 'drink':
      return near;
    case 'buy':
      return c.energy;
    case 'board':
      if (
        stopped &&
        !['heli', 'tractor', 'digger'].includes(p.car.kind) &&
        dist(p, c.student) < 7
      ) {
        c.aboard = true;
        return true;
      }
      return false;
    case 'translate':
      if (
        c.aboard &&
        ((p.car &&
          Math.hypot(p.car.vx, p.car.vy) < 2 &&
          dist(p, c.visitor) < 12) ||
          (near && dist(c.student, c.visitor) < 8))
      ) {
        page(
          'Wohnwagenfahrer: Dr Moddor hot fei kaan Zuch mehr. Iech brauch e Wärkschdadd, sunsd bleim mir do midn Wuhngwaachn schdehn. Kannsd när vorfoahrn?'
        );
        return true;
      }
      return false;
    case 'escort':
      c.wait =
        stopped &&
        dist(p, SPOT.garage) < 18 &&
        dist(c.rig, SPOT.garage) < 24 &&
        Math.abs(c.rig.vf) < 1.5
          ? c.wait + dt
          : 0;
      if (c.wait > 2) {
        page(
          'Wohnwagenfahrer: Do simmer! Nu bassds. Habt fei vieln Dank, ihr gudn Leit!'
        );
        return true;
      }
      return false;
    default:
      throw new Error(`unknown caravan phase: ${j.step.phase}`);
  }
}

/**
 * Leaves a stopped rig and removes the temporary mission driver.
 * @param {!Object} j
 */
export function parkCaravan(j) {
  if (j.caravan) {
    const rig = j.caravan.rig;
    rig.ai = null;
    rig.thr = 0;
    rig.hb = true;
  }
}

/**
 * The cast to draw at the current stage, outside the ordinary pedestrian pool.
 * @param {!Object} j
 * @return {!Array<!Object>} People, including the student's phone.
 */
export function caravanPeople(j) {
  const c = j && j.caravan;
  if (!c) {
    return [];
  }
  const phase = j.step.phase;
  const people = [];
  if (phase !== 'escort') {
    people.push({...c.visitor, col: '#b07b44'});
  }
  if (phase === 'family') {
    people.push({...SPOT.grubers, col: '#b65d82', t: 0});
  }
  if (!c.aboard || !state.player.car) {
    people.push({...c.student, col: '#71b43d', phone: !c.aboard});
  }
  return people;
}

/**
 * Steering for the slow, damaged visitor along the recorded lead-car route.
 * @param {!Object} car
 * @param {number} dt
 */
export function driveEscort(car, dt) {
  const c = car.ai.escort;
  const points = c.trail;
  while (points.length > 1 && dist(car, points[0]) < 4) {
    points.shift();
  }
  const p = state.player;
  const gap = dist(car, p);
  const target = points[0];
  const err = target
    ? wrap(Math.atan2(target.y - car.y, target.x - car.x) - car.a)
    : 0;
  const speed = Math.max(2, 9 * (1 - Math.min(0.8, Math.abs(err))));
  const fx = Math.cos(car.a);
  const fy = Math.sin(car.a);
  const obstacle = state.cars.some(o => {
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    return (
      o !== car &&
      dx * fx + dy * fy > 0 &&
      dx * fx + dy * fy < 6 + Math.max(0, car.vf) &&
      Math.abs(dy * fx - dx * fy) < (car.type.width + o.type.width) / 2
    );
  });
  const wait = !p.car || !target || obstacle || (points.length < 4 && gap < 15);
  car.thr = wait ? (car.vf > 0.2 ? -1 : 0) : car.vf < speed ? 0.65 : -0.4;
  car.hb = wait && car.vf < 1;
  car.steer = Math.max(-1, Math.min(1, err * 2.2));
  car.ai.wait = wait ? car.ai.wait + dt : 0;
}

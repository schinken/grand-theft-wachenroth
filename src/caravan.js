/**
 * @fileoverview The visitor, his interpreter and the caravan escort.
 */

import {hitch, makeCar} from './cars.js';
import {speak} from './dialogue.js';
import {info} from './effects.js';
import {nearest} from './geometry.js';
import {DRIVE, NODES, SEGS, surfAt, town} from './land.js';
import {SPOT, field, nearLink} from './places.js';
import {shove} from './player.js';
import {blocked} from './scenery.js';
import {state} from './state.js';
import {clamp, dist, wrap} from './util.js';

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
    const garage = field(SPOT.garage);
    const forward = garage[link[1]] < garage[link[0]];
    const a = NODES[link[forward ? 0 : 1]];
    const b = NODES[link[forward ? 1 : 0]];
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
    speak(
      'visitor',
      'Nu fahr när sachte vor, iech kumm fei hinnerdrher. Mei Wuhngwaachn muss heil bleim!'
    );
    // Never chase the player's parking manoeuvre or position on foot. Wait
    // until the lead car has passed the rig before beginning its trail.
    c.trail = [{x: c.rig.x, y: c.rig.y}];
    c.last = null;
    c.departed = false;
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
  const dx = p.x - c.rig.x;
  const dy = p.y - c.rig.y;
  const fx = Math.cos(c.rig.a);
  const fy = Math.sin(c.rig.a);
  if (
    !c.departed &&
    p.car &&
    dx * fx + dy * fy > 8 &&
    Math.abs(dy * fx - dx * fy) < 8
  ) {
    c.departed = true;
    c.last = {x: c.rig.x, y: c.rig.y};
  }
  // Record forward driving only. Reversing to park must not send the
  // caravan back towards a stop or through the same turning manoeuvre.
  if (p.car && c.departed && p.car.vf >= -0.5 && dist(p, c.last) > 1.5) {
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
        speak(
          'visitor',
          'Nu gugge när! Mei Audoo rucklt un dr Wuhngwaachn hängt aa noch droo. Wu issn do e Wärkschdadd? Iech verschdie eich fei net!'
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
        speak(
          'visitor',
          'Dr Moddor hot fei kaan Zuch mehr. Iech brauch e Wärkschdadd, sunsd bleim mir do midn Wuhngwaachn schdehn. Kannsd när vorfoahrn?'
        );
        return true;
      }
      return false;
    case 'escort':
      c.wait =
        dist(c.rig, SPOT.garage) < 24 && Math.hypot(c.rig.vx, c.rig.vy) < 1.5
          ? c.wait + dt
          : 0;
      if (c.wait > 2) {
        speak(
          'visitor',
          'Do simmer! Nu bassds. Habt fei vieln Dank, ihr gudn Leit!'
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
  const p = state.player;
  const fx = Math.cos(car.a);
  const fy = Math.sin(car.a);
  const wheelbase = car.type.wheelbase;
  const rear = {
    x: car.x - (fx * wheelbase) / 2,
    y: car.y - (fy * wheelbase) / 2,
  };
  // Project onto the next few metres of the recorded path, then discard
  // only the part already passed. A missed point can never cause a U-turn.
  let best = Infinity;
  let segment = 0;
  let projection = points[0];
  let scanned = 0;
  for (let i = 0; i + 1 < points.length && scanned < 18; i++) {
    const a = points[i];
    const b = points[i + 1];
    const q = nearest(rear.x, rear.y, a.x, a.y, b.x, b.y);
    const d = Math.hypot(rear.x - q[0], rear.y - q[1]);
    if (d < best - 0.05) {
      best = d;
      segment = i;
      projection = {x: q[0], y: q[1]};
    }
    scanned += dist(a, b);
  }
  points.splice(0, segment);
  if (projection) {
    points[0] = projection;
  }
  const v = Math.max(0, car.vf);
  let look = 3.5 + v * 0.7;
  let remaining = 0;
  let target = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = dist(a, b);
    remaining += length;
    if (!target && length >= look) {
      const t = length ? look / length : 0;
      target = {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
    }
    look -= length;
  }
  target ||= points[points.length - 1];
  const err = target
    ? wrap(Math.atan2(target.y - rear.y, target.x - rear.x) - car.a)
    : 0;
  const want = Math.min(
    9,
    9 / (1 + Math.abs(err) * 2),
    Math.sqrt(Math.max(0, remaining - 11) * 4)
  );
  const wait = !p.car || !c.departed || remaining <= 11;
  car.thr = wait
    ? car.vf > 0.2
      ? -1
      : 0
    : clamp((want - car.vf) * 0.6, -1, 0.65);
  car.hb = wait && car.vf < 1;
  const limit = Math.min(
    0.62,
    Math.atan(((14 + v) * wheelbase) / (v * v || 1))
  );
  const distance = target ? Math.max(1, dist(rear, target)) : 1;
  car.steer = clamp(
    Math.atan((2 * wheelbase * Math.sin(err)) / distance) / limit,
    -1,
    1
  );
  car.ai.wait = wait ? car.ai.wait + dt : 0;
}

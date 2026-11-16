/**
 * @fileoverview The game as a whole: a fresh world, one step of it, the rules
 * of play, the camera, the yellow arrow, start, pause and the finale.
 */

import * as audio from './audio.js';
import {collideCars, makeCar, stepCar} from './cars.js';
import {float, page, puff, replay} from './effects.js';
import {onShow} from './hud.js';
import {dropCash, grab} from './items.js';
import {jobCast, jobRules, startJob} from './jobs.js';
import {MISSIONS, RANKS, TALK} from './missions.js';
import {stepPed, walkersVsCars} from './people.js';
import {
  HOME,
  SPOT,
  driveSpot,
  field,
  pathLength,
  routeLine,
  waypoint,
} from './places.js';
import {controlPlayer} from './player.js';
import {streetProps} from './scenery.js';
import {shops, wash} from './shops.js';
import {fmt, setState, state, store} from './state.js';
import {driveAI, parkCars, police, populate} from './traffic.js';
import {moveTrain} from './train.js';
import {WORLD_H, WORLD_W, byId, clamp, dist, lerp, rand} from './util.js';
import {viewH, viewW} from './view.js';

/**
 * Builds a fresh world.
 * @param {string} mode 'menu' or 'play'.
 * @param {?Object=} save A saved game to continue.
 */
export function reset(mode, save) {
  for (const p of streetProps) {
    p.down = 0;
  }
  setState({
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
    // Seconds of being drunk left, and when the next hic comes
    drunk: 0,
    hicT: 0,
    // An open shop, and the place whose shop was last open: it opens again
    // only once you have left
    shop: null,
    shopCool: '',
    thiefF: null,
    whereT: 0,
    finale: 0,
    map: false,
    stats: {missions: 0, stolen: 0, peds: 0, wrecks: 0, busted: 0, wasted: 0},
    cam: {x: 1450, y: 900, z: 4.4},
    player: null,
  });
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
  // A job may want its things fetched on foot (hens caught by hand, trees cut
  // with the saw, rockers met with the hammer) or with its own vehicle
  // (Christmas trees onto the cart).
  const job = state.job;
  const st = job ? job.step : {};
  const got = state.items.filter(
    v =>
      Math.hypot(v.x - player.x, v.y - player.y) < reach &&
      !(v.job && st.foot && player.car) &&
      !(v.job && st.veh && player.car !== job.veh)
  );
  if (got.length) {
    state.items = state.items.filter(v => !got.includes(v));
    got.forEach(grab);
  }
  if (player.car && state.wanted >= 1 && dist(player, SPOT.carwash) < 7) {
    wash();
  }
  shops();
  if (state.drunk > 0) {
    state.drunk -= dt;
    if ((state.hicT -= dt) <= 0) {
      state.hicT = rand(3, 6);
      float(player, 'hic!', '#ffe9a0');
      audio.play('hic');
    }
  }
  if (state.job) {
    jobCast(state.job, dt);
    jobRules(dt);
  } else if ((state.nextJob -= dt) <= 0 && state.jobN < MISSIONS.length) {
    startJob();
  }
  if (state.finale && (state.finale -= dt) <= 0) {
    finish();
  }
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
      `Schrottkarren: ${st.wrecks} · Angefahren: ${st.peds} · Erwischt: ${st.busted} · Erledigt: ${st.wasted}`,
    ].map(t => Object.assign(document.createElement('li'), {textContent: t}))
  );
  audio.play('win');
  audio.radio(1);
  audio.siren(false);
  store(); // with every job done: a saved game goes on in free play
  byId('free').focus();
}

/** After the finale: on through Wachenroth with the money, without jobs. */
export function freePlay() {
  state.mode = 'play';
  byId('end').hidden = true;
  byId('hud').hidden = false;
  onShow.clear();
  document.activeElement.blur();
  page(...TALK.free);
}

/**
 * Follows the player and pulls up when going fast.
 * @param {number} dt
 */
export function camera(dt) {
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
      tall * // pull up when going fast, and more when flying
      (c && c.alt ? 1 - 0.4 * c.alt : 1);
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
export function update(dt) {
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
    c.awake = 2; // it may move, so collideCars() has to look at it
    stepCar(c, dt);
  }
  collideCars();
  moveTrain();
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
  // What has run its time is dropped from the lists in place: a new list on
  // every update is work for the garbage collector
  let n = 0;
  for (const sp of state.sprays) {
    // broken hydrants are fountains for a while
    sp.t -= dt;
    if (dist(sp, player) < 90) {
      for (let i = 0; i < 2; i++) {
        puff(sp.x + rand(-0.3, 0.3), sp.y + rand(-0.3, 0.3), 'water');
      }
    }
    if (sp.t > 0) {
      state.sprays[n++] = sp;
    }
  }
  state.sprays.length = n;
  n = 0;
  for (const p of state.parts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life += dt;
    if (p.life < p.max) {
      state.parts[n++] = p;
    }
  }
  state.parts.length = n;
  n = 0;
  for (const t of state.texts) {
    t.y -= 3 * dt;
    t.life -= dt;
    if (t.life > 0) {
      state.texts[n++] = t;
    }
  }
  state.texts.length = n;
  camera(dt);
}

/**
 * Keeps the yellow arrow pointing down the road to the current target.
 * @param {number} dt
 */
export function guide(dt) {
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
  if (player.car && player.car.kind === 'heli') {
    // a helicopter flies straight there, roads or not
    state.gps.wp = to;
    state.gps.far = dist(player, to);
    return;
  }
  state.gps.wp =
    dist(player, to) < 50 ? to : waypoint(state.gps.f, player, 40) || to;
  // How far it is by road
  state.gps.far = pathLength(routeLine(state.gps.f, player, to));
}

/**
 * Starts a game.
 * @param {?Object=} save A saved game to continue.
 */
export function start(save) {
  audio.init();
  reset('play', save);
  byId('hud').hidden = false;
  byId('lcd').textContent = '';
  onShow.clear(); // the page was just reset by hand: write everything afresh
  for (const id of 'menu end shop flash mission pause info map'.split(' ')) {
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
  if (PICKED >= 0) {
    // straight to the job asked for, without the greeting
    state.jobN = PICKED;
    state.nextJob = 0.5;
    return;
  }
  const free = save && save.n >= MISSIONS.length;
  page(...(free ? TALK.free : save ? TALK.back : TALK.hello));
}

// index.html?job=koppel, or ?job=12, jumps straight to a job: by its name in
// missions.js, or by its number counted from 1. -1 when none is asked for.
export const PICKED = (() => {
  const pick = new URLSearchParams(location.search).get('job');
  const named = MISSIONS.findIndex(m => m.id === pick);
  const n = named >= 0 ? named : Math.round(Number(pick)) - 1;
  return pick && n >= 0 ? clamp(n, 0, MISSIONS.length - 1) : -1;
})();

/**
 * Pauses or resumes.
 * @param {boolean} p
 */
export function pause(p) {
  if (state.mode !== 'play' || state.map) {
    return;
  }
  state.paused = p;
  byId('pause').hidden = !p;
  audio.pause(p);
}

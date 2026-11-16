/**
 * @fileoverview Grand Theft Wachenroth: the main loop, and hooks for
 * play-testing.
 */

import * as audio from './audio.js';
import {BUILD} from './buildings.js';
import {makeCar} from './cars.js';
import {inFront} from './draw-buildings.js';
import {camera, guide, reset, update} from './game.js';
import {hud} from './hud.js';
import {inSight, nextStep} from './jobs.js';
import {AREAS, NODES, surfAt} from './land.js';
import {MISSIONS} from './missions.js';
import {drawMap, showMap} from './paper-map.js';
import {
  SPOT,
  field,
  nearLink,
  nearNode,
  pathLength,
  routeLine,
  waypoint,
} from './places.js';
import {pad, toggleCar} from './player.js';
import {poster, render} from './render.js';
import {TREES, streetProps} from './scenery.js';
import {selftest} from './selftest.js';
import {buy, closeShop} from './shops.js';
import {TYPES} from './sprites.js';
import {state} from './state.js';
import {CROSSINGS, TRAIN} from './train.js';
import {dist, wrap} from './util.js';
import {resize} from './view.js';
import './input.js';

addEventListener('resize', () => {
  resize();
  if (state.map) {
    showMap(true);
  }
});
resize();

let last = 0;
/**
 * One tick of the main loop.
 * @param {number} now
 */
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (state.map) {
    drawMap();
  } // the game holds its breath while you read the map
  else {
    if (!state.paused && !state.shop) {
      for (let n = dt > 0.02 ? 2 : 1, i = 0; i < n; i++) {
        update(dt / n);
      }
      if (state.mode === 'play') {
        guide(dt);
      }
    }
    render();
    if (!state.paused) {
      hud(dt);
    }
  }
  requestAnimationFrame(frame);
}
reset('menu');
requestAnimationFrame(frame);

// Hooks for play-testing: the browser console and tools/playtest.js reach the
// game through window.GTW.
window.GTW = {
  get state() {
    return state;
  },
  MISSIONS,
  SPOT,
  NODES,
  AREAS,
  BUILD,
  PROPS: streetProps,
  TREES,
  inFront,
  inSight,
  poster,
  buy,
  closeShop,
  TRAIN,
  CROSSINGS,
  TYPES,
  pad,
  audio,
  update,
  guide,
  render,
  camera,
  hud,
  toggleCar,
  showMap,
  makeCar,
  field,
  waypoint,
  nearLink,
  nearNode,
  routeLine,
  pathLength,
  dist,
  wrap,
  surfAt,
  tp(key) {
    const s = SPOT[key];
    const o = state.player.car || state.player;
    Object.assign(o, {x: s.x, y: s.y, vx: 0, vy: 0});
  },
  skip() {
    if (state.job) {
      state.job.i = state.job.m.steps.length - 1;
      nextStep();
    }
  },
  job(n) {
    state.job = null;
    state.jobN = n;
    state.nextJob = 0;
  },
};

if (location.search.includes('selftest')) {
  selftest();
}

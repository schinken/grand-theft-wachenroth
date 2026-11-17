/**
 * @fileoverview Draws what moves or lies about: vehicles, people, things, the
 * festival and particles.
 */

import {MAP} from '../map.js';
import {makeSign} from './buildings.js';
import {braking} from './cars.js';
import {puff} from './effects.js';
import {stand} from './hills.js';
import {SHIRTS} from './people.js';
import {SPOT} from './places.js';
import {carSprite, icon} from './sprites.js';
import {state} from './state.js';
import {drawTrain} from './train.js';
import {TAU, clamp, pick2, rand, rng} from './util.js';
import {ctx} from './view.js';
import {box} from './yards.js';

/**
 * Tyres below the body sprite, in the vehicle's local frame. The front
 * pair turns, with a slightly greater angle on the inside of the bend.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Car} c
 */
function drawWheels(g, c) {
  const type = c.type;
  if (!type.wheelbase) {
    return;
  }
  const length = clamp(type.wheelbase * 0.26, 0.5, 0.95);
  const width = clamp(type.width * 0.15, 0.2, 0.36);
  const track = type.width - width * 0.5;
  const angle = c.wheelAngle || 0;
  const curvature = Math.tan(angle) / type.wheelbase;
  g.fillStyle = '#45464a';
  for (const axle of [-1, 1]) {
    for (const side of [-1, 1]) {
      const y = (side * track) / 2;
      g.save();
      g.translate((axle * type.wheelbase) / 2, y);
      if (axle > 0) {
        g.rotate(Math.atan(Math.tan(angle) / (1 - y * curvature)));
      }
      g.fillRect(-length / 2, -width / 2, length, width);
      g.restore();
    }
  }
}

/**
 * Red brake lights and matching white reversing lights.
 * Coordinates follow the sprite's pixel grid, including Baby's finer grid.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Car} c
 */
function drawRearLights(g, c) {
  if (!c.type.wheelbase || c.dead || c.burn) {
    return;
  }
  const brakes = braking(c);
  const reversing = c.vf < -0.2;
  if (!brakes && !reversing) {
    return;
  }
  const baby = c.kind === 'baby';
  const x = baby ? 2 : 1;
  const y = baby ? 3 : 2;
  const width = baby ? 2 : 1;
  const h = c.spr.height;
  g.save();
  g.translate(-c.type.length / 2, -c.type.width / 2);
  g.scale(c.type.length / c.spr.width, c.type.width / h);
  if (brakes) {
    // A tight red fringe and brighter centre stay visible at game zoom.
    g.fillStyle = 'rgba(255,35,25,0.3)';
    g.fillRect(x - 1, y - 1, width + 2, 5);
    g.fillRect(x - 1, h - y - 4, width + 2, 5);
    g.fillStyle = '#ff3030';
    g.fillRect(x, y, width, 3);
    g.fillRect(x, h - y - 3, width, 3);
    g.fillStyle = '#ff9a85';
    g.fillRect(x, y + 1, width, 1);
    g.fillRect(x, h - y - 2, width, 1);
  }
  if (reversing) {
    // Keep the outer half red; only the half facing the car's centre is white.
    g.save();
    g.beginPath();
    g.rect(x - 1, y + 1.5, width + 2, 2.5);
    g.rect(x - 1, h - y - 4, width + 2, 2.5);
    g.clip();
    g.fillStyle = 'rgba(235,235,225,0.22)';
    g.fillRect(x - 1, y - 1, width + 2, 5);
    g.fillRect(x - 1, h - y - 4, width + 2, 5);
    g.fillStyle = '#e0e0da';
    g.fillRect(x, y, width, 3);
    g.fillRect(x, h - y - 3, width, 3);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y + 1, width, 1);
    g.fillRect(x, h - y - 2, width, 1);
    g.restore();
  }
  g.restore();
}

/**
 * @param {!Object} p
 * @param {string} shirt
 * @param {string} hair
 * @param {boolean=} mane Long hair down the back, as rockers wear it.
 */
function drawPerson(p, shirt, hair, mane = false) {
  const sw = Math.sin(p.t * 4) * 0.22;
  const rect = (x, y, w, h, f) => {
    ctx.fillStyle = f;
    ctx.fillRect(x, y, w, h);
  };
  // Knocked over: how high in the air, 0 to 1
  const up = p.slide
    ? Math.sin((Math.PI * p.slide.t) / p.slide.duration) * 0.6
    : p.fly > 0
      ? Math.sin(Math.PI * (1 - p.fly / p.flyT))
      : 0;
  if (up) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.55, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(p.x, p.y - up * 0.9);
  ctx.rotate(p.a + (p.spin || 0));
  ctx.scale(1.3 + up * 0.6, 1.3 + up * 0.6); // a bit larger than life
  if (p.slide) {
    // Feet first, on one hip, one arm stretched out over the car.
    rect(0.05, -0.28, 0.65, 0.2, '#1c1c22');
    rect(0.12, 0.08, 0.65, 0.2, '#1c1c22');
    rect(-0.45, -0.32, 0.65, 0.64, shirt);
    rect(-0.58, -0.55, 0.7, 0.14, '#e0b08a');
    rect(-0.12, 0.32, 0.45, 0.14, '#e0b08a');
    rect(-0.72, -0.2, 0.35, 0.4, hair);
    ctx.restore();
    return;
  }
  rect(-0.15 + sw, -0.34, 0.34, 0.22, '#1c1c22');
  rect(-0.15 - sw, 0.12, 0.34, 0.22, '#1c1c22'); // feet
  rect(-0.08 - sw, -0.6, 0.3, 0.16, '#e0b08a');
  rect(-0.08 + sw, 0.44, 0.3, 0.16, '#e0b08a'); // hands
  rect(-0.24, -0.5, 0.48, 1, shirt);
  if (mane) {
    rect(-0.45, -0.24, 0.3, 0.48, hair); // long hair down the back
  }
  rect(-0.2, -0.22, 0.42, 0.44, hair);
  ctx.restore();
}

/**
 * The Zerstampfer, a big hammer, in the hand of someone on foot.
 * @param {!Point} p With its facing a.
 */
function drawHammer(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.scale(1.3, 1.3);
  ctx.fillStyle = '#8a5a2a';
  ctx.fillRect(0.05, 0.42, 1.35, 0.16);
  ctx.fillStyle = '#4a4d53';
  ctx.fillRect(1.15, 0.05, 0.55, 0.9);
  ctx.fillStyle = '#9a9da3';
  ctx.fillRect(1.15, 0.05, 0.55, 0.14);
  ctx.restore();
}

// The festival's banner over the stage and where its people and tents are,
// made when first needed.
let festival = null;

/**
 * The Koppel of Rock at its crossroads: a stage with its lights in the
 * meadow to the north-east, the crowd in front of it and a beer stand, and
 * across the crossroads to the south-west the tents of those who stay the
 * night.
 * @param {number} x The crossroads.
 * @param {number} y
 */
function drawFestival(x, y) {
  if (!festival) {
    const r = rng(1984);
    festival = {
      banner: makeSign('KOPPEL OF ROCK', ['#15151a', '#e8c21c']),
      crowd: Array.from({length: 46}, () => [
        6 + r() * 16,
        -21 + r() * r() * 12,
        pick2(SHIRTS, r),
        r() * TAU,
      ]),
      tents: Array.from({length: 21}, (v, i) => [
        -51 + (i % 7) * 5.5 + r(),
        14 + ((i / 7) | 0) * 6 + r(),
        pick2(['#d86a2a', '#2f5fa8', '#3c7a30', '#c8201c', '#e8c21c'], r),
      ]),
    };
  }
  ctx.save();
  ctx.translate(x, y);
  // The campground
  for (const [tx, ty, col] of festival.tents) {
    ctx.fillStyle = col;
    ctx.fillRect(tx, ty, 3, 2.4);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(tx, ty + 1.2, 3, 1.2);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(tx, ty + 1.1, 3, 0.2);
  }
  // The beer stand
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(27, -16, 6, 3);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#f4f4ef' : '#c8201c';
    ctx.fillRect(27 + i * 1.5, -17.5, 1.5, 1.5);
  }
  // The crowd jumps to the beat
  for (const [cx, cy, col, phase] of festival.crowd) {
    const hop = Math.max(0, Math.sin(state.t * 9 + phase)) * 0.35;
    ctx.fillStyle = col;
    ctx.fillRect(cx - 0.35, cy - 0.3 - hop, 0.7, 0.6);
    ctx.fillStyle = '#e6c79c';
    ctx.fillRect(cx - 0.2, cy - 0.2 - hop, 0.4, 0.4);
  }
  ctx.save();
  ctx.translate(14, -2); // the stage, at the corner of the meadow
  // The stage: boards, the boxes left and right, lights that change colour
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-8.4, -29.4, 18, 8);
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(-9, -30, 18, 8);
  ctx.fillStyle = '#15151a';
  ctx.fillRect(-11.5, -28, 2.2, 5);
  ctx.fillRect(9.3, -28, 2.2, 5);
  const lights = ['#ff3b3b', '#3bb0ff', '#e8c21c', '#c85aa8', '#58e06a'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = lights[(i + ((state.t * 4) | 0)) % lights.length];
    ctx.beginPath();
    ctx.arc(-7.5 + i * 3, -23.2, 0.55, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#c9cdd3'; // the drums and three who play
  ctx.beginPath();
  ctx.arc(0, -27.5, 1, 0, TAU);
  ctx.fill();
  for (const bx of [-4.5, 0, 4.5]) {
    ctx.fillStyle = '#22252b';
    ctx.fillRect(bx - 0.4, -25.4, 0.8, 0.7);
  }
  const wide = 15;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    festival.banner,
    -wide / 2,
    -33.2,
    wide,
    (wide * festival.banner.height) / festival.banner.width
  );
  ctx.imageSmoothingEnabled = false;
  ctx.restore();
  ctx.restore();
}

/**
 * The main rotor of a helicopter, in its own frame: two blades turned by a,
 * and the blur of their disc while they spin.
 * @param {!Object} type
 * @param {number} a
 * @param {boolean} spin
 */
function drawRotor(type, a, spin) {
  const hub = type.length * 0.15;
  if (spin) {
    ctx.fillStyle = 'rgba(20,20,24,.18)';
    ctx.beginPath();
    ctx.arc(hub, 0, 5, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = '#2b2b2e';
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  for (const k of [a, a + Math.PI / 2]) {
    ctx.moveTo(hub + Math.cos(k) * 5, Math.sin(k) * 5);
    ctx.lineTo(hub - Math.cos(k) * 5, -Math.sin(k) * 5);
  }
  ctx.stroke();
}

/**
 * Whatever flies, above roofs and trees: its shadow far below, the body a
 * little larger the higher it is, and the rotor turning over it.
 */
export function drawAir() {
  for (const c of state.cars) {
    if (!(c.alt > 0.3)) {
      continue;
    }
    stand(c.x, c.y);
    const type = c.type;
    const lift = c.alt * 5;
    for (const sh of [lift, 0]) {
      ctx.save();
      ctx.translate(c.x + sh, c.y + sh);
      ctx.rotate(c.a);
      if (sh) {
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.fillRect(
          -type.length / 2,
          -type.width / 2,
          type.length,
          type.width
        );
      } else {
        ctx.scale(1 + 0.5 * c.alt, 1 + 0.5 * c.alt);
        ctx.drawImage(
          c.spr,
          -type.length / 2,
          -type.width / 2,
          type.length,
          type.width
        );
        drawRotor(type, state.t * 25, true);
      }
      ctx.restore();
    }
  }
}

/** Mission scenery: bonfires, tents, people waiting for a lift. */
function drawProps() {
  const j = state.job;
  for (const pr of j ? j.m.props || [] : []) {
    const s = SPOT[pr.at];
    const x = s.x + (pr.dx || 0);
    const y = s.y + (pr.dy || 0);
    if (pr.from > j.i || pr.until <= j.i) {
      continue;
    }
    // A tent and the stage stand at the place itself, the rest beside it.
    stand(...(pr.k === 'tent' || pr.k === 'stage' ? MAP.pois[pr.at] : [x, y]));
    if (pr.k === 'fire') {
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 7; i++) {
        const a = state.t * 3 + i * 2.4;
        const r = 1.6 + Math.sin(state.t * 9 + i) * 0.7;
        ctx.fillStyle = i % 2 ? '#ff5a1f' : '#ffd23e';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.3, r * 0.6, 0, TAU);
        ctx.fill();
      }
      if (Math.random() < 0.5) {
        puff(
          x + rand(-1, 1),
          y + rand(-1, 1),
          Math.random() < 0.5 ? 'fire' : 'smoke'
        );
      }
    } else if (pr.k === 'tent') {
      // A tent stands on the ground itself; the way there ends beside it.
      ctx.save();
      ctx.translate(...MAP.pois[pr.at]);
      ctx.rotate(s.a);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f4f4ef' : '#2b62c8';
        ctx.fillRect(-12 + i * 3, -5, 3, 10);
      }
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(-12, -5, 24, 10);
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.restore();
    } else if (pr.k === 'stage') {
      drawFestival(...MAP.pois[pr.at]);
    } else if (pr.k === 'person') {
      drawPerson(
        {x, y, a: state.t * 0.8 + x, t: 0},
        pr.col || '#b3372f',
        '#2a1d12'
      );
    }
  }
}

// The colour of what is left on the ground, by its kind; anything else is
// soot.
const STAINS = {
  blood: 'rgba(140,10,16,.8)',
  stump: '#7a5634',
  dirt: 'rgba(107,74,42,.9)',
};

/**
 * A stain on the ground, or the stump of a tree.
 * @param {!Object} d
 */
function drawDecal(d) {
  ctx.fillStyle = STAINS[d.kind] || 'rgba(15,12,10,.55)';
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r, 0, TAU);
  ctx.fill();
  if (d.kind === 'stump') {
    ctx.strokeStyle = '#c8a070'; // the year rings
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 0.55, 0, TAU);
    ctx.stroke();
  }
}

/**
 * A thing to pick up, on its glowing spot: an icon that rocks, or a rocker
 * who bangs his head.
 * @param {!Object} v
 */
function drawItem(v) {
  const k = Math.sin(state.t * 5 + v.ph);
  const w = (v.job ? 2.6 : 2) + k * 0.2;
  ctx.fillStyle = v.job ? 'rgba(255,210,62,.5)' : 'rgba(255,255,255,.25)';
  ctx.beginPath();
  ctx.arc(v.x, v.y, (v.job ? 2.4 : 1.7) + k * 0.3, 0, TAU);
  ctx.fill();
  if (v.kind === 'rocker') {
    const a = v.ph + Math.sin(state.t * 9 + v.ph) * 0.35;
    drawPerson(
      {x: v.x, y: v.y, a, t: state.t * 2 + v.ph},
      '#16161a',
      v.hair,
      true
    );
    return;
  }
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(Math.sin(state.t * 2 + v.ph) * 0.25);
  ctx.drawImage(icon(v.kind), -w / 2, -w / 2, w, w);
  ctx.restore();
}

/** The player on foot, in a yellow ring, with the hammer if a job has one. */
function drawPlayer() {
  const player = state.player;
  stand(player.x, player.y);
  ctx.strokeStyle = '#ffd23e';
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.arc(player.x, player.y, 1 + Math.sin(state.t * 6) * 0.1, 0, TAU);
  ctx.stroke();
  drawPerson(player, '#19c2bd', '#3a2a1a');
  if (state.job && state.job.step.item === 'rocker') {
    drawHammer(player);
  }
}

/**
 * A guard and the light of his lamp.
 * @param {!Object} g
 */
function drawGuard(g) {
  ctx.fillStyle = 'rgba(255,224,102,.28)';
  ctx.beginPath();
  ctx.moveTo(g.x, g.y);
  ctx.arc(g.x, g.y, g.r, g.a - g.fov, g.a + g.fov);
  ctx.closePath();
  ctx.fill();
  drawPerson(g, '#3c5a2a', '#2a1d14');
}

/**
 * A shepherd dog: body, head and a tail that wags.
 * @param {!Object} d
 */
function drawDog(d) {
  box(ctx, d.x, d.y, 1.1, 0.45, d.a, '#5a3a1e');
  box(
    ctx,
    d.x + Math.cos(d.a) * 0.6,
    d.y + Math.sin(d.a) * 0.6,
    0.4,
    0.35,
    d.a,
    '#2a1d14'
  );
  const wag = Math.sin(d.t * 3 + state.t * 8) * 0.5;
  box(
    ctx,
    d.x - Math.cos(d.a + wag) * 0.7,
    d.y - Math.sin(d.a + wag) * 0.7,
    0.4,
    0.12,
    d.a + wag,
    '#5a3a1e'
  );
}

/**
 * Mama Doris with her broom.
 * @param {!Object} dz
 */
function drawDoris(dz) {
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  ctx.moveTo(dz.x, dz.y);
  ctx.lineTo(dz.x + Math.cos(dz.a) * 1.5, dz.y + Math.sin(dz.a) * 1.5);
  ctx.stroke();
  ctx.fillStyle = '#d9b23c'; // the bristles
  ctx.beginPath();
  ctx.arc(
    dz.x + Math.cos(dz.a) * 1.6,
    dz.y + Math.sin(dz.a) * 1.6,
    0.35,
    0,
    TAU
  );
  ctx.fill();
  drawPerson(dz, '#c85aa8', '#d8d4cc');
}

/**
 * The trailer of a vehicle, which hangs on the rear hitch, and its shadow.
 * @param {!Car} c
 */
function drawTrailer(c) {
  const tt = c.tr.type;
  const hx = c.x - (Math.cos(c.a) * c.type.length) / 2;
  const hy = c.y - (Math.sin(c.a) * c.type.length) / 2;
  ctx.save();
  ctx.translate(
    hx - Math.cos(c.tr.a) * (tt.length / 2 + 0.4),
    hy - Math.sin(c.tr.a) * (tt.length / 2 + 0.4)
  );
  ctx.rotate(c.tr.a);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-tt.length / 2 + 0.4, -tt.width / 2 + 0.4, tt.length, tt.width);
  ctx.drawImage(tt.spr, -tt.length / 2, -tt.width / 2, tt.length, tt.width);
  ctx.restore();
}

/**
 * A vehicle on the ground: its trailer, its shadow, then the vehicle with
 * its rotor or its blue lights.
 * @param {!Car} c
 */
function drawCar(c) {
  const type = c.type;
  if (c.tr) {
    drawTrailer(c);
  }
  ctx.save();
  ctx.translate(c.x + 0.4, c.y + 0.4);
  ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-type.length / 2, -type.width / 2, type.length, type.width);
  ctx.restore();
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  drawWheels(ctx, c);
  // the drum of a concrete mixer turns
  const turning = c.kind === 'mixer' && !c.dead;
  const spr = turning
    ? carSprite('mixer', c.col, ((state.t * 5) | 0) % 4)
    : c.spr;
  ctx.drawImage(
    spr,
    -type.length / 2,
    -type.width / 2,
    type.length,
    type.width
  );
  drawRearLights(ctx, c);
  if (c.kind === 'heli') {
    drawRotor(type, 0.6, false); // standing still
  }
  if (c.siren && !c.dead) {
    // blue lights
    const on = ((state.t * 6) | 0) % 2;
    const x = c.kind === 'fire' ? type.length / 2 - 2.3 : -0.2;
    ctx.fillStyle = on ? '#4aa3ff' : '#12327a';
    ctx.fillRect(x, -type.width / 2 + 0.3, 0.5, 0.6);
    ctx.fillStyle = on ? '#12327a' : '#4aa3ff';
    ctx.fillRect(x, type.width / 2 - 0.9, 0.5, 0.6);
  }
  ctx.restore();
}

/**
 * Stains, pickups, people and vehicles.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function drawSprites(x0, y0, x1, y1) {
  const job = state.job;
  // Whether a thing is in view. If it is, the canvas is put on its spot on
  // the hills.
  const seen = o => {
    if (o.x < x0 - 14 || o.x > x1 + 14 || o.y < y0 - 14 || o.y > y1 + 14) {
      return false;
    }
    stand(o.x, o.y);
    return true;
  };
  for (const mark of state.skids) {
    if (seen(mark)) {
      // A minute at full strength, then ten seconds fading away.
      const fade = clamp((70 - (state.t - mark.born)) / 10, 0, 1);
      ctx.strokeStyle = `rgba(24,24,27,${mark.alpha * fade})`;
      ctx.lineWidth = mark.width;
      ctx.beginPath();
      ctx.moveTo(mark.x, mark.y);
      ctx.lineTo(mark.x1, mark.y1);
      ctx.stroke();
    }
  }
  for (const d of state.decals) {
    if (seen(d)) {
      drawDecal(d);
    }
  }
  drawProps();
  for (const v of state.items) {
    if (seen(v)) {
      drawItem(v);
    }
  }
  if (
    state.mode === 'play' &&
    !state.player.car &&
    !state.wasted &&
    !state.player.slide
  ) {
    drawPlayer();
  }
  for (const p of state.peds) {
    if (seen(p) && !(p.fly > 0)) {
      drawPerson(p, p.shirt, p.hair, p.mane);
    }
  }
  for (const g of (job && job.guards) || []) {
    if (seen(g)) {
      drawGuard(g);
    }
  }
  for (const d of (job && job.dogs) || []) {
    if (seen(d)) {
      drawDog(d);
    }
  }
  if (job && job.doris && seen(job.doris)) {
    drawDoris(job.doris);
  }
  for (const c of state.cars) {
    if (seen(c) && !(c.alt > 0.3)) {
      drawCar(c);
    }
  }
  drawTrain(x0, y0, x1, y1);
  if (
    state.mode === 'play' &&
    !state.player.car &&
    !state.wasted &&
    state.player.slide
  ) {
    drawPlayer(); // the sliding player passes above the car body
  }
  for (const p of state.peds) {
    if (seen(p) && p.fly > 0) {
      drawPerson(p, p.shirt, p.hair, p.mane); // up in the air, above the cars
    }
  }
}

/**
 */
export function drawParticles() {
  for (const p of state.parts) {
    stand(p.x, p.y);
    const k = p.life / p.max;
    if (
      p.kind === 'spark' ||
      p.kind === 'blood' ||
      p.kind === 'water' ||
      p.kind === 'dung' ||
      p.kind === 'dirt'
    ) {
      ctx.fillStyle =
        p.kind === 'spark'
          ? '#ffd23e'
          : p.kind === 'blood'
            ? '#b0121a'
            : p.kind === 'dung'
              ? '#ecebe4'
              : p.kind === 'dirt'
                ? '#6b4a2a'
                : '#9fd0f0';
      ctx.fillRect(p.x, p.y, 0.35, 0.35);
      continue;
    }
    ctx.fillStyle =
      p.kind === 'smoke'
        ? `rgba(60,60,64,${0.5 * (1 - k)})`
        : p.kind === 'boom'
          ? `rgba(255,190,90,${1 - k})`
          : k < 0.5
            ? '#ffd23e'
            : '#ff5a1f';
    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      p.kind === 'smoke'
        ? 0.5 + p.life * 1.2
        : p.kind === 'boom'
          ? 2 + k * 8
          : 0.8 - k * 0.6,
      0,
      TAU
    );
    ctx.fill();
  }
}

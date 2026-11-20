/**
 * @fileoverview Night: the picture turns dark and blue and keeps its colours
 * only where a lamp shines. The lamps are painted on a canvas of their own,
 * the light map, and that is laid over the finished picture: it darkens
 * whatever no lamp reaches.
 */

import {braking} from './cars.js';
import {put, stand} from './hills.js';
import {state} from './state.js';
import {canvas, lerp} from './util.js';
import {ctx, viewH, viewW} from './view.js';

const light = canvas(1, 1).getContext('2d');
// The colour of what no lamp reaches
const DARK = [44, 56, 112];

/**
 * A round patch of light that fades towards its rim.
 * @param {string} rgb Its colour, as 'r,g,b'.
 * @return {!HTMLCanvasElement}
 */
function patch(rgb) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, `rgba(${rgb},1)`);
  fade.addColorStop(0.45, `rgba(${rgb},.5)`);
  fade.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 64);
  return c;
}
const WARM = patch('255,236,196');
const RED = patch('255,36,28');
const BLUE = patch('70,130,255');
// The colours of paper lanterns, as 'r,g,b', and their light. The first is
// also that of a fire.
export const PAPER = ['255,170,60', '255,222,96', '255,96,72', '150,230,120'];
const PAPERS = PAPER.map(patch);
// The beam of a pair of head lamps: from the middle of its left edge it fans
// out to the right and fades. Four fans, each a little wider, make its sides
// soft.
const BEAM = canvas(128, 96);
{
  const g = BEAM.getContext('2d');
  const fade = g.createRadialGradient(0, 48, 0, 0, 48, 128);
  fade.addColorStop(0, 'rgba(255,244,214,.34)');
  fade.addColorStop(0.55, 'rgba(255,244,214,.2)');
  fade.addColorStop(1, 'rgba(255,244,214,0)');
  g.fillStyle = fade;
  for (let wide = 30; wide <= 48; wide += 6) {
    g.beginPath();
    g.moveTo(0, 44);
    g.lineTo(128, 48 - wide);
    g.lineTo(128, 48 + wide);
    g.lineTo(0, 52);
    g.fill();
  }
}

// The lamps that glow over the dark picture, drawn once the night has
// fallen: eleven numbers for each (see lay()), and its picture.
const glows = [];
const glowOf = [];

/**
 * Lays a picture of light down around a point of the world, turned about
 * that point: on the light map now, and if it is to glow, over the dark
 * picture later.
 * @param {!HTMLCanvasElement} sprite
 * @param {number} alpha How strong it is on the light map.
 * @param {number} glow How strong it glows over the dark picture.
 * @param {number} px The point, in metres.
 * @param {number} py
 * @param {number} turn
 * @param {number} x Where the picture lies from the point.
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function lay(sprite, alpha, glow, px, py, turn, x, y, w, h) {
  if (alpha) {
    light.setTransform(put.z, 0, 0, put.z, put.e, put.f);
    light.translate(px, py);
    light.rotate(turn);
    light.globalAlpha = alpha * state.night;
    light.drawImage(sprite, x, y, w, h);
  }
  if (glow) {
    glows.push(glow, put.z, put.e, put.f, px, py, turn, x, y, w, h);
    glowOf.push(sprite);
  }
}

/**
 * The lamps of a vehicle that is driven: the beam ahead, a little light on
 * itself, and the tail lamps, which shine far when it brakes.
 * @param {!Car} c
 */
function carLamps(c) {
  const front = c.type.length / 2;
  lay(BEAM, 1, 0.35, c.x, c.y, c.a, front - 1, -11, 30, 22);
  lay(WARM, 0.5, 0, c.x, c.y, c.a, -5, -5, 10, 10);
  const r = braking(c) ? 8 : 3;
  lay(
    RED,
    0.8,
    braking(c) ? 0.6 : 0.3,
    c.x,
    c.y,
    c.a,
    -front - r,
    -r,
    2 * r,
    2 * r
  );
}

/**
 * The blue light of the police and the fire brigade, flashing: also on a
 * fire engine that stands across the road with nobody at the wheel.
 * @param {!Car} c
 */
function blueLamp(c) {
  const on = ((state.t * 6) | 0) % 2;
  lay(on ? BLUE : RED, 0.9, 0.5, c.x, c.y, c.a, -12, -12, 24, 24);
}

/**
 * Night begins a frame: the light map is wiped, and the lamps that shine on
 * the ground are painted on it: street lanterns, vehicles, your pocket lamp
 * and the flare where the job wants you. Buildings come after that, so no
 * lamp shines through them.
 * @param {!Array<number>} view The ground in view: x0, y0, x1 and y1.
 * @param {!Array<!Prop>} props The street furniture in view.
 */
export function dusk([x0, y0, x1, y1], props) {
  if (!state.night) {
    return;
  }
  const c = light.canvas;
  if (c.width !== viewW || c.height !== viewH) {
    c.width = viewW;
    c.height = viewH;
  }
  light.setTransform(1, 0, 0, 1, 0, 0);
  light.globalCompositeOperation = 'source-over';
  light.clearRect(0, 0, viewW, viewH);
  light.globalCompositeOperation = 'lighter';
  const seen = o =>
    o.x > x0 - 30 && o.x < x1 + 30 && o.y > y0 - 30 && o.y < y1 + 30;
  for (const p of props) {
    if (p.k !== 'hydrant' && !p.down) {
      // The lantern hangs out over the street.
      const x = p.x + Math.cos(p.a) * 1.4;
      const y = p.y + Math.sin(p.a) * 1.4;
      stand(x, y);
      lay(WARM, 0.95, 0.12, x, y, 0, -12, -12, 24, 24);
    }
  }
  const player = state.player;
  for (const car of state.cars) {
    if (!seen(car) || !car.type.wheelbase || car.dead || car.burn) {
      continue;
    }
    stand(car.x, car.y);
    if (car.ai || car === player.car) {
      carLamps(car);
    }
    if (car.siren) {
      blueLamp(car);
    }
  }
  if (!player.car && state.mode === 'play') {
    stand(player.x, player.y);
    lay(WARM, 0.7, 0, player.x, player.y, 0, -6, -6, 12, 12);
  }
  const to = state.job && state.job.to;
  if (to && seen(to)) {
    const r = 9 + Math.sin(state.t * 9) * 0.8; // it flickers
    stand(to.x, to.y);
    lay(WARM, 1, 0.35, to.x, to.y, 0, -r, -r, 2 * r, 2 * r);
  }
}

/**
 * A building stands in front of the lamps behind it: what they shine on the
 * ground does not show on its walls and roof. Called once stand() has put the
 * building on its spot.
 * @param {!Building} b
 * @param {number} cx Camera centre, in metres.
 * @param {number} cy
 * @param {number} s How far the perspective pushes its top out.
 */
export function shade(b, cx, cy, s) {
  if (!state.night) {
    return;
  }
  const p = b.p;
  const n = p.length;
  const ox = cx * (1 - s);
  const oy = cy * (1 - s);
  light.setTransform(put.z, 0, 0, put.z, put.e, put.f);
  light.globalCompositeOperation = 'destination-out';
  light.globalAlpha = 1;
  // The ground it stands on and its top, pushed out
  light.beginPath();
  for (const k of [1, s]) {
    light.moveTo(p[0] * k + cx * (1 - k), p[1] * k + cy * (1 - k));
    for (let i = 2; i < n; i += 2) {
      light.lineTo(p[i] * k + cx * (1 - k), p[i + 1] * k + cy * (1 - k));
    }
    light.closePath();
  }
  light.fill();
  // and the walls that face the camera, between the two
  light.beginPath();
  for (let i = 0, k = 0; i < n; i += 2, k++) {
    if ((cx - p[i]) * b.nx[k] + (cy - p[i + 1]) * b.ny[k] > 0) {
      const j = (i + 2) % n;
      light.moveTo(p[i], p[i + 1]);
      light.lineTo(p[j], p[j + 1]);
      light.lineTo(p[j] * s + ox, p[j + 1] * s + oy);
      light.lineTo(p[i] * s + ox, p[i + 1] * s + oy);
      light.closePath();
    }
  }
  light.fill();
  light.globalCompositeOperation = 'lighter';
}

/**
 * The windows of a building with the light on keep their colour in the
 * dark.
 * @param {function(!CanvasRenderingContext2D)} trace Draws their outlines
 *     into the path of a canvas, as on the picture.
 */
export function litWindows(trace) {
  light.setTransform(put.z, 0, 0, put.z, put.e, put.f);
  light.globalAlpha = state.night;
  light.fillStyle = '#fff';
  light.beginPath();
  trace(light);
  light.fill();
}

/**
 * The crown of a tree hides the lamps below it.
 * @param {!HTMLCanvasElement} crown Its picture.
 * @param {number} x Its middle, in metres.
 * @param {number} y
 * @param {number} r
 * @param {number} alpha How much of it the picture shows.
 */
export function shadeCrown(crown, x, y, r, alpha) {
  if (!state.night) {
    return;
  }
  light.setTransform(put.z, 0, 0, put.z, put.e, put.f);
  light.globalCompositeOperation = 'destination-out';
  light.globalAlpha = alpha;
  light.drawImage(crown, x - r, y - r, r * 2, r * 2);
  light.globalCompositeOperation = 'lighter';
}

/**
 * The head of a street lantern glows. Called once stand() has put the
 * lantern on its spot.
 * @param {number} x The head, in metres.
 * @param {number} y
 */
export function lanternGlow(x, y) {
  if (state.night) {
    lay(WARM, 0, 0.9, x, y, 0, -1.7, -1.7, 3.4, 3.4);
  }
}

/**
 * A small light of a colour of its own, a paper lantern or a fire: it lights
 * the ground around it and glows in the dark. Called once stand() has put it
 * on its spot.
 * @param {number} x Where it is, in metres.
 * @param {number} y
 * @param {number} r How far it shines, in metres.
 * @param {number} n Which of the PAPER colours it has.
 */
export function shine(x, y, r, n) {
  if (!state.night) {
    return;
  }
  lay(PAPERS[n], 0.55, 0, x, y, 0, -r, -r, 2 * r, 2 * r);
  lay(PAPERS[n], 0, 0.9, x, y, 0, -r / 7, -r / 7, r / 3.5, r / 3.5);
}

/**
 * Night falls over the finished picture: what no lamp reaches turns dark
 * and blue, and then the lamps themselves glow.
 */
export function nightFall() {
  const n = state.night;
  if (!n) {
    return;
  }
  light.setTransform(1, 0, 0, 1, 0, 0);
  light.globalAlpha = 1;
  light.globalCompositeOperation = 'destination-over';
  light.fillStyle = `rgb(${DARK.map(v => Math.round(lerp(255, v, n)))})`;
  light.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(light.canvas, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0, k = 0; i < glows.length; i += 11, k++) {
    ctx.setTransform(
      glows[i + 1],
      0,
      0,
      glows[i + 1],
      glows[i + 2],
      glows[i + 3]
    );
    ctx.translate(glows[i + 4], glows[i + 5]);
    ctx.rotate(glows[i + 6]);
    ctx.globalAlpha = glows[i] * n;
    ctx.drawImage(
      glowOf[k],
      glows[i + 7],
      glows[i + 8],
      glows[i + 9],
      glows[i + 10]
    );
  }
  glows.length = glowOf.length = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

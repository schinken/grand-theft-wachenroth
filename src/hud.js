/**
 * @fileoverview The HUD, which is ordinary HTML over the canvas.
 */

import * as audio from './audio.js';
import {nearest} from './geometry.js';
import {SEGS} from './land.js';
import {MISSIONS, PLACES} from './missions.js';
import {SPOT} from './places.js';
import {fmt, state} from './state.js';
import {byId, clamp, dist, lerp} from './util.js';

// The HUD is ordinary HTML, and writing to it makes the browser lay the page
// out again even when the value is the same. So what is on show is
// remembered, and only changes are written.
export const onShow = new Map();

/**
 * Whether a HUD value differs from what is on show; remembers the new one.
 * @param {string} key
 * @param {(string|number|boolean)} value
 * @return {boolean}
 */
export function changed(key, value) {
  if (onShow.get(key) === value) {
    return false;
  }
  onShow.set(key, value);
  return true;
}

/**
 * Writes a HUD value, if it differs from what is on show.
 * @param {string} key
 * @param {(string|number|boolean)} value
 * @param {function()} write
 */
function show(key, value, write) {
  if (changed(key, value)) {
    write();
  }
}

/**
 * Money, police stars, NoS and the state of the car.
 * @param {number} dt
 */
function showGauges(dt) {
  const c = state.player.car;
  state.shown =
    Math.abs(state.money - state.shown) < 1
      ? state.money
      : lerp(state.shown, state.money, Math.min(1, dt * 8));
  const money = Math.round(state.shown);
  show('money', money, () => {
    byId('money').textContent = fmt(money);
  });
  const stars = Math.floor(state.wanted);
  show('stars', stars, () => {
    byId('heat').textContent = '★'.repeat(stars);
  });
  const hot = state.bust > 0.3;
  show('hot', hot, () => byId('heat').classList.toggle('hot', hot));
  const hasNos = !!c && c.nos !== undefined;
  show('hasNos', hasNos, () => {
    byId('nos').hidden = byId('bN').hidden = !hasNos;
  });
  if (hasNos) {
    const nosLeft = Math.round(c.nos * 100);
    show('nosLeft', nosLeft, () => {
      byId('nos').querySelector('i').style.width = `${nosLeft}%`;
    });
  }
  show('onFoot', !c, () => {
    byId('bB').textContent = c ? 'BREMSE' : 'RENNEN';
    byId('dmg').hidden = !c;
  });
  if (c) {
    const health = Math.round(clamp(c.hp / c.type.hp, 0, 1) * 100);
    show('health', health, () => {
      const bar = byId('dmg').querySelector('i');
      bar.style.width = `${health}%`;
      bar.style.background = health < 30 ? 'var(--hot)' : '';
    });
  }
}

/**
 * What the pager shows while Flo has nothing to say: the task, or that
 * there is none.
 * @return {string}
 */
function idleLine() {
  if (state.pager.idle) {
    return `» ${state.pager.idle}`;
  }
  return state.jobN >= MISSIONS.length ? 'Wachenroth gehört dir.' : '...';
}

/**
 * The pager types out Flo's messages one after the other, then shows what
 * to do.
 * @param {number} dt
 */
function showPager(dt) {
  const pg = state.pager;
  if (!pg.cur && pg.q.length) {
    pg.cur = pg.q.shift();
    pg.n = 0;
    pg.said = 0;
    // Time to read it once it is typed: about 15 letters a second, and never
    // less than three seconds. A tap on the pager skips ahead.
    pg.hold = Math.max(3, pg.cur.length / 15);
  }
  if (!pg.cur) {
    const idle = idleLine();
    show('lcd', idle, () => {
      byId('lcd').textContent = idle;
    });
    return;
  }
  if (pg.n < pg.cur.length) {
    pg.n += dt * 28; // letters a second
    const n = Math.min(pg.cur.length, pg.n | 0);
    const typed = `FLO: ${pg.cur.slice(0, n)}`;
    show('lcd', typed, () => {
      byId('lcd').textContent = typed;
    });
    if (n - pg.said >= 3) {
      pg.said = n;
      if (/\w/.test(pg.cur[n - 1] || '')) {
        audio.babble();
      }
    }
    return;
  }
  if ((pg.hold -= dt) <= 0) {
    pg.cur = '';
    if (!pg.q.length) {
      byId('pager').classList.remove('ring');
    }
  }
}

/**
 * The gauge of a job: the load or the wood that is left, or how far a hold
 * or a collection has got. Other steps have none.
 * @param {!Object} j
 * @return {?number} From 0 to 1.
 */
function jobGauge(j) {
  const st = j.step;
  if (j.fragile) {
    return j.cargo;
  }
  if (st.logs) {
    return j.logs / st.logs;
  }
  if (st.do === 'hold') {
    return j.hold / st.secs;
  }
  if (st.do === 'collect') {
    return j.got / j.need;
  }
  if (st.do === 'race') {
    return j.cp / st.via.length;
  }
  return null;
}

/** The mission bar: the clock, the count and the gauge of the job. */
function showMission() {
  const j = state.job;
  const st = j && j.step;
  const noBar =
    !j ||
    !(
      j.timed ||
      j.fragile ||
      j.logs ||
      j.need ||
      st.do === 'hold' ||
      st.do === 'chase' ||
      st.do === 'race'
    );
  show('noBar', noBar, () => {
    byId('mission').hidden = noBar;
  });
  if (noBar) {
    return;
  }
  const el = byId('mission');
  const secs = Math.max(0, Math.ceil(j.left));
  const bits = [];
  if (j.timed) {
    bits.push(`${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`);
  }
  if (st.do === 'collect') {
    bits.push(st.db ? `${st.db - 10 * j.got} dB` : `${j.got} / ${j.need}`);
  }
  if (st.do === 'chase') {
    bits.push(`Treffer ${j.prey.hits || 0} / ${st.hits}`);
  }
  if (st.do === 'race') {
    bits.push(`Platz ${j.place} von ${st.rivals.length + 1}`);
  }
  if (j.fragile) {
    bits.push('Ladung');
  }
  if (st.logs) {
    bits.push(`Holz ${j.logs} / ${st.logs}`);
  }
  const line = bits.join('  ·  ');
  show('missionLine', line, () => {
    el.firstElementChild.textContent = line;
  });
  const bar = jobGauge(j);
  show('noGauge', bar === null, () => {
    el.lastElementChild.hidden = bar === null;
  });
  const gauge = Math.round(clamp(bar, 0, 1) * 100);
  show('gauge', gauge, () => {
    el.querySelector('i').style.width = `${gauge}%`;
  });
  const hurry = j.timed && secs <= 15;
  show('hurry', hurry, () => el.classList.toggle('hurry', hurry));
}

/**
 * The name of the place the player is at, or else of the street.
 * @return {string}
 */
function whereName() {
  const player = state.player;
  let name = '';
  let bd = 34;
  for (const k of Object.keys(SPOT)) {
    const d = dist(player, SPOT[k]);
    if (d < bd && PLACES[k]) {
      bd = d;
      name = PLACES[k];
    }
  }
  if (name) {
    return name;
  }
  bd = 14;
  for (const s of SEGS) {
    const close =
      s[6].n &&
      Math.abs(s[0] - player.x) < 150 &&
      Math.abs(s[1] - player.y) < 150;
    if (!close) {
      continue;
    }
    const q = nearest(player.x, player.y, s[0], s[1], s[2], s[3]);
    const d = Math.hypot(player.x - q[0], player.y - q[1]);
    if (d < bd) {
      bd = d;
      name = s[6].n;
    }
  }
  return name;
}

/**
 * Refreshes money, pager, mission bar and the engine sound.
 * @param {number} dt
 */
export function hud(dt) {
  const c = state.player.car;
  showGauges(dt);
  showPager(dt);
  showMission();
  if ((state.whereT -= dt) <= 0) {
    state.whereT = 0.5;
    const name = whereName();
    show('where', name, () => {
      byId('where').textContent = name;
    });
  }
  audio.engine(
    c ? c.vf : 0,
    c && state.mode === 'play' && !state.paused,
    c && (c.sound || c.kind)
  );
}

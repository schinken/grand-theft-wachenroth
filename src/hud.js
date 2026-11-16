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
 * Refreshes money, pager, mission bar and the engine sound.
 * @param {number} dt
 */
export function hud(dt) {
  const player = state.player;
  const c = player.car;
  const pg = state.pager;
  const j = state.job;
  state.shown =
    Math.abs(state.money - state.shown) < 1
      ? state.money
      : lerp(state.shown, state.money, Math.min(1, dt * 8));
  const money = Math.round(state.shown);
  if (changed('money', money)) {
    byId('money').textContent = fmt(money);
  }
  const stars = Math.floor(state.wanted);
  if (changed('stars', stars)) {
    byId('heat').textContent = '★'.repeat(stars);
  }
  const hot = state.bust > 0.3;
  if (changed('hot', hot)) {
    byId('heat').classList.toggle('hot', hot);
  }
  const hasNos = !!c && c.nos !== undefined;
  if (changed('hasNos', hasNos)) {
    byId('nos').hidden = byId('bN').hidden = !hasNos;
  }
  const nosLeft = hasNos ? Math.round(c.nos * 100) : -1;
  if (hasNos && changed('nosLeft', nosLeft)) {
    byId('nos').querySelector('i').style.width = `${nosLeft}%`;
  }
  if (changed('onFoot', !c)) {
    byId('bB').textContent = c ? 'BREMSE' : 'RENNEN';
    byId('dmg').hidden = !c;
  }
  const health = c ? Math.round(clamp(c.hp / c.type.hp, 0, 1) * 100) : -1;
  if (c && changed('health', health)) {
    const bar = byId('dmg').querySelector('i');
    bar.style.width = `${health}%`;
    bar.style.background = health < 30 ? 'var(--hot)' : '';
  }
  // the pager types out Flo's messages one after the other, then shows what to
  // do
  if (!pg.cur && pg.q.length) {
    pg.cur = pg.q.shift();
    pg.n = 0;
    pg.said = 0;
    // Time to read it once it is typed: about 15 letters a second, and never
    // less than three seconds. A tap on the pager skips ahead.
    pg.hold = Math.max(3, pg.cur.length / 15);
  }
  if (pg.cur) {
    if (pg.n < pg.cur.length) {
      pg.n += dt * 28; // letters a second
      const n = Math.min(pg.cur.length, pg.n | 0);
      const typed = `FLO: ${pg.cur.slice(0, n)}`;
      if (changed('lcd', typed)) {
        byId('lcd').textContent = typed;
      }
      if (n - pg.said >= 3) {
        pg.said = n;
        if (/\w/.test(pg.cur[n - 1] || '')) {
          audio.babble();
        }
      }
    } else if ((pg.hold -= dt) <= 0) {
      pg.cur = '';
      if (!pg.q.length) {
        byId('pager').classList.remove('ring');
      }
    }
  } else {
    const idle = pg.idle
      ? `» ${pg.idle}`
      : state.jobN >= MISSIONS.length
        ? 'Wachenroth gehört dir.'
        : '...';
    if (changed('lcd', idle)) {
      byId('lcd').textContent = idle;
    }
  }
  const noBar =
    !j ||
    !(
      j.timed ||
      j.fragile ||
      j.logs ||
      j.need ||
      j.step.do === 'hold' ||
      j.step.do === 'chase'
    );
  if (changed('noBar', noBar)) {
    byId('mission').hidden = noBar;
  }
  if (j && !noBar) {
    const el = byId('mission');
    const secs = Math.max(0, Math.ceil(j.left));
    const st = j.step;
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
    if (j.fragile) {
      bits.push('Ladung');
    }
    if (st.logs) {
      bits.push(`Holz ${j.logs} / ${st.logs}`);
    }
    const line = bits.join('  ·  ');
    if (changed('missionLine', line)) {
      el.firstElementChild.textContent = line;
    }
    // The gauge: the load or the wood that is left, or how far a hold or a
    // collection has got; other steps have none.
    const bar = j.fragile
      ? j.cargo
      : st.logs
        ? j.logs / st.logs
        : st.do === 'hold'
          ? j.hold / st.secs
          : st.do === 'collect'
            ? j.got / j.need
            : null;
    if (changed('noGauge', bar === null)) {
      el.lastElementChild.hidden = bar === null;
    }
    const gauge = Math.round(clamp(bar, 0, 1) * 100);
    if (changed('gauge', gauge)) {
      el.querySelector('i').style.width = `${gauge}%`;
    }
    const hurry = j.timed && secs <= 15;
    if (changed('hurry', hurry)) {
      el.classList.toggle('hurry', hurry);
    }
  }
  if ((state.whereT -= dt) <= 0) {
    // where am I?
    state.whereT = 0.5;
    let name = '';
    let bd = 34;
    for (const k of Object.keys(SPOT)) {
      const d = dist(player, SPOT[k]);
      if (d < bd && PLACES[k]) {
        bd = d;
        name = PLACES[k];
      }
    }
    if (!name) {
      bd = 14;
      for (const s of SEGS) {
        if (
          s[6].n &&
          Math.abs(s[0] - player.x) < 150 &&
          Math.abs(s[1] - player.y) < 150
        ) {
          const q = nearest(player.x, player.y, s[0], s[1], s[2], s[3]);
          const d = Math.hypot(player.x - q[0], player.y - q[1]);
          if (d < bd) {
            bd = d;
            name = s[6].n;
          }
        }
      }
    }
    if (changed('where', name)) {
      byId('where').textContent = name;
    }
  }
  audio.engine(
    c ? c.vf : 0,
    c && state.mode === 'play' && !state.paused,
    c && (c.sound || c.kind)
  );
}

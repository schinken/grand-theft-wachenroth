/**
 * @fileoverview Input: keyboard, and a thumb stick plus buttons on touch
 * screens.
 */

import * as audio from './audio.js';
import {PICKED, freePlay, pause, start} from './game.js';
import {MISSIONS} from './missions.js';
import {showMap} from './paper-map.js';
import {honk, keys, nextStation, pad, toggleCar} from './player.js';
import {buy, closeShop} from './shops.js';
import {load, state, store} from './state.js';
import {byId} from './util.js';

addEventListener('keydown', e => {
  if (state.mode !== 'play') {
    return;
  }
  if (state.shop) {
    // 1 to 9 buys, Escape or F leaves
    e.preventDefault();
    const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (n) {
      buy(+n[2] - 1);
    } else if (['Escape', 'KeyF', 'Enter', 'Space'].includes(e.code)) {
      closeShop();
    }
    return;
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') {
    e.preventDefault();
  }
  if (e.code === 'Tab' && !e.repeat) {
    showMap(!state.map);
    return;
  }
  if (state.map) {
    if (e.code === 'Escape') {
      showMap(false);
    }
    return;
  }
  keys[e.code] = true;
  if (e.repeat) {
    return;
  }
  if (e.code === 'KeyF' || e.code === 'Enter') {
    toggleCar();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    pause(!state.paused);
  }
  if (e.code === 'KeyM') {
    audio.mute(!audio.isMuted());
  }
  if (e.code === 'KeyR') {
    nextStation();
  }
  if (e.code === 'KeyH') {
    honk();
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) {
    keys[k] = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    return;
  }
  showMap(false);
  pause(true);
  // Free play has no jobs left that save the game: it is saved when the page
  // goes out of sight.
  if (state.mode === 'play' && state.jobN >= MISSIONS.length) {
    store();
  }
});

{
  const stick = byId('stick');
  const knob = stick.firstElementChild;
  const radius = 52;
  let id = null;
  let ox = 0;
  let oy = 0;
  const move = e => {
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, d / radius) / (d || 1);
    pad.x = dx * k;
    pad.y = dy * k;
    knob.style.transform = `translate(${pad.x * radius}px, ${pad.y * radius}px)`;
  };
  const zone = byId('zone');
  zone.addEventListener('pointerdown', e => {
    if (id !== null) {
      return;
    }
    id = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    zone.setPointerCapture(id);
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
    stick.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId === id) {
      move(e);
    }
  });
  const up = e => {
    if (e.pointerId !== id) {
      return;
    }
    id = null;
    pad.x = pad.y = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  const hold = (el, key) => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      pad[key] = true;
      if (key === 'horn') {
        honk();
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(ev, () => {
        pad[key] = false;
      });
    }
  };
  hold(byId('bB'), 'brake');
  hold(byId('bN'), 'nos');
  hold(byId('bH'), 'horn');
  byId('bA').addEventListener('pointerdown', e => {
    e.preventDefault();
    toggleCar();
  });
  byId('bR').addEventListener('pointerdown', e => {
    e.preventDefault();
    nextStation();
  });
  byId('bP').addEventListener('pointerdown', e => {
    e.preventDefault();
    pause(!state.paused);
  });
  byId('bM').addEventListener('pointerdown', e => {
    e.preventDefault();
    audio.mute(!audio.isMuted());
    byId('bM').classList.toggle('off', audio.isMuted());
  });
  // The volume, remembered in the browser. Square law: the slider feels even.
  const vol = byId('vol');
  try {
    vol.value = localStorage.getItem('gtw-vol') ?? vol.value;
  } catch {
    /* private mode */
  }
  const setVolume = () => {
    audio.setVolume((vol.value / 100) ** 2);
    try {
      localStorage.setItem('gtw-vol', vol.value);
    } catch {
      /* private mode */
    }
  };
  setVolume();
  vol.addEventListener('input', setVolume);
  vol.addEventListener('change', () => vol.blur()); // arrows steer, not this
  byId('pause').addEventListener('pointerdown', () => pause(false));
  byId('bMap').addEventListener('pointerdown', e => {
    e.preventDefault();
    showMap(true);
  });
  byId('map').addEventListener('pointerdown', () => showMap(false));
  byId('pager').addEventListener('pointerdown', () => {
    const pg = state.pager;
    if (pg.n < pg.cur.length) {
      pg.n = pg.cur.length;
    } else {
      pg.hold = 0;
    }
  }); // tap: next message
  const touchy = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) {
    touchy();
  }
  addEventListener('touchstart', touchy, {once: true, passive: true});
  document.addEventListener('contextmenu', e => e.preventDefault());
}

byId('start').onclick = byId('again').onclick = () => start();
byId('free').onclick = freePlay;
byId('resume').onclick = () => start(load());
byId('how').onclick = () => {
  byId('help').hidden = !byId('help').hidden;
  byId('how').setAttribute('aria-expanded', !byId('help').hidden);
};
{
  const save = load();
  byId('resume').hidden =
    PICKED >= 0 || !(save && save.n > 0 && save.n <= MISSIONS.length);
  if (save) {
    byId('resume').textContent =
      save.n >= MISSIONS.length
        ? 'Weiterspielen (freies Spiel)'
        : `Weiterspielen (Auftrag ${save.n + 1}/${MISSIONS.length})`;
  }
  if (PICKED >= 0) {
    // the link asked for a job: say which one the button starts
    byId('start').textContent =
      `Auftrag ${PICKED + 1}: ${MISSIONS[PICKED].title}`;
  }
}

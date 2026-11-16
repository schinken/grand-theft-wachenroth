/**
 * @fileoverview Shops: Bernhard's garage, Mara's bar and the car wash.
 */

import * as audio from './audio.js';
import {repaint} from './cars.js';
import {flash, puff} from './effects.js';
import {SPOT} from './places.js';
import {COLORS} from './sprites.js';
import {fmt, state} from './state.js';
import {byId, dist, pick, rand} from './util.js';

/**
 * Opens a shop when you come in: Bernhard's garage by car, Mara's bar on
 * foot. It opens again only once you have left.
 */
export function shops() {
  const player = state.player;
  const c = player.car;
  if (state.shopCool && dist(player, SPOT[state.shopCool]) > 9) {
    state.shopCool = '';
  }
  if (state.shopCool || state.mode !== 'play' || state.wasted) {
    return;
  }
  if (c && !c.burn && dist(player, SPOT.garage) < 6) {
    if (Math.hypot(c.vx, c.vy) < 3) {
      state.shopCool = 'garage';
      openGarage(c);
    }
  } else if (!c && dist(player, SPOT.maras) < 3) {
    state.shopCool = 'maras';
    openShop('Maras Marktschänke', 'Mara stellt ein Stamperl auf den Tresen.', [
      {
        label: 'Wurzelsepp (Kräuterschnaps)',
        price: 3,
        ok: () => true,
        buy() {
          state.drunk = Math.max(state.drunk, 60);
          state.hicT = 2;
        },
      },
    ]);
  }
}

/**
 * Bernhard's garage, Mechanic Monkeys: repairs, and what makes a car yours.
 * @param {!Car} c
 */
function openGarage(c) {
  const extra = (key, label, price) => ({
    label,
    price,
    ok: () => !c.extras.includes(key),
    buy() {
      c.extras += key;
      repaint(c);
    },
  });
  openShop('Mechanic Monkeys', 'Der Bernhard wischt sich die Hände ab.', [
    {
      label: 'Reparieren, Fahndung weg',
      price: 250,
      credit: true, // Bernhard puts it on the slate when you are broke
      ok: () => c.hp < c.type.hp || state.wanted >= 1,
      buy() {
        c.hp = c.type.hp;
        state.wanted = 0;
        state.bust = 0;
      },
    },
    {
      label: 'Motorsound V6-Blubbern',
      price: 300,
      ok: () => c.sound !== 'v6',
      buy() {
        c.sound = 'v6';
      },
    },
    {
      label: 'Motorsound 300-PS-Benziner',
      price: 500,
      ok: () => c.sound !== 'turbo',
      buy() {
        c.sound = 'turbo';
      },
    },
    {
      label: 'Tuning: schneller, besser in Kurven',
      price: 1000,
      ok: () => !c.boost,
      buy() {
        c.boost = 1.25;
      },
    },
    {
      // Fitted once, filled up after that
      get label() {
        return c.nos === undefined ? 'NoS einbauen' : 'NoS auffüllen';
      },
      get price() {
        return c.nos === undefined ? 1200 : 150;
      },
      ok: () => c.nos === undefined || c.nos < 1,
      buy() {
        c.nos = 1;
      },
    },
    {
      label: 'Neue Farbe',
      price: 100,
      ok: () => true,
      buy() {
        c.col = COLORS[(COLORS.indexOf(c.col) + 1) % COLORS.length];
        repaint(c);
      },
    },
    extra('r', 'Rennstreifen', 300),
    extra('f', 'Flammen', 500),
    extra('s', 'Heckspoiler (nur Optik)', 800),
  ]);
}

/**
 * Shows a shop; the game holds still until you leave it.
 * @param {string} title
 * @param {string} line
 * @param {!Array<!Object>} offers Each with label, price, ok() and buy().
 */
function openShop(title, line, offers) {
  state.shop = {title, line, offers};
  audio.play('till');
  showShop();
}

/** Draws the open shop afresh, or hides it. */
function showShop() {
  const sh = state.shop;
  const el = byId('shop');
  el.hidden = !sh;
  if (!sh) {
    return;
  }
  el.querySelector('h3').textContent = sh.title;
  el.querySelector('p').textContent = `${sh.line} Kasse: ${fmt(state.money)}`;
  const rows = sh.offers.map((o, i) => {
    const b = document.createElement('button');
    const price = Object.assign(document.createElement('b'), {
      textContent:
        o.credit && state.money < o.price && o.ok()
          ? `${fmt(o.price)} (anschreiben)`
          : fmt(o.price),
    });
    b.append(`${i + 1}. ${o.label}`, price);
    b.disabled = !canBuy(o);
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      buy(i);
    });
    const li = document.createElement('li');
    li.append(b);
    return li;
  });
  const leave = document.createElement('button');
  leave.append('Weiter');
  leave.addEventListener('pointerdown', e => {
    e.preventDefault();
    closeShop();
  });
  const li = document.createElement('li');
  li.append(leave);
  el.querySelector('ol').replaceChildren(...rows, li);
}

/**
 * Whether an offer can be bought now.
 * @param {!Object} o
 * @return {boolean}
 */
function canBuy(o) {
  return o.ok() && (o.credit || state.money >= o.price);
}

/**
 * Buys an offer of the open shop.
 * @param {number} i
 */
export function buy(i) {
  const o = state.shop && state.shop.offers[i];
  if (!o || !canBuy(o)) {
    return;
  }
  state.money -= o.price;
  o.buy();
  audio.play('coin');
  showShop();
}

/** Leaves the shop. */
export function closeShop() {
  state.shop = null;
  showShop();
}

/** The car wash at Murk: new paint, nobody recognises you. */
export function wash() {
  const c = state.player.car;
  state.wanted = 0;
  state.money -= 15;
  c.col = pick(COLORS.filter(col => col !== c.col));
  repaint(c);
  for (let i = 0; i < 40; i++) {
    puff(c.x + rand(-3, 3), c.y + rand(-3, 3), 'water');
  }
  flash('Blitzsauber!', 'Waschstraße: 14,90 €');
  audio.play('splash');
}

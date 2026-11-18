/**
 * @fileoverview Spoken dialogue, separate from Flo's pager messages.
 */

import {state} from './state.js';

// A portrait may later point to an image asset. Null keeps its space hidden.
export const SPEAKERS = {
  visitor: {name: 'Wohnwagenfahrer', color: '#ffd26b', portrait: null},
  leon: {name: 'Leon-Maximilian', color: '#75d4ff', portrait: null},
  gruber: {name: 'Frau Gruber', color: '#ff92c9', portrait: null},
  flo: {name: 'Flo', color: '#19c2bd', portrait: null},
};

/** Clears the current conversation, for a restart or a failed mission. */
export function clearDialogue() {
  state.dialogue = {q: [], cur: null, left: 0};
}

/**
 * Queues a person's words in readable subtitle-sized blocks.
 * @param {string} speaker Key in SPEAKERS.
 * @param {string} text
 */
export function speak(speaker, text) {
  let rest = text.trim();
  while (rest) {
    let end = rest.length;
    if (end > 180) {
      const prefix = rest.slice(0, 180);
      const sentence = Math.max(
        prefix.lastIndexOf('. '),
        prefix.lastIndexOf('! '),
        prefix.lastIndexOf('? ')
      );
      end = sentence > 60 ? sentence + 1 : prefix.lastIndexOf(' ');
      if (end < 1) {
        end = 180;
      }
    }
    state.dialogue.q.push({speaker, text: rest.slice(0, end)});
    rest = rest.slice(end).trim();
  }
  stepDialogue(0);
}

/**
 * Advances the conversation on game time; menus and pauses hold it still.
 * @param {number} dt
 */
export function stepDialogue(dt) {
  if (state.mode !== 'play' || state.paused || state.shop || state.map) {
    return;
  }
  const d = state.dialogue;
  if (d.cur) {
    d.left -= dt;
    if (d.left > 0) {
      return;
    }
    d.cur = null;
  }
  if (d.q.length) {
    d.cur = d.q.shift();
    d.left = Math.max(3, d.cur.text.length / 17 + 0.8);
  }
}

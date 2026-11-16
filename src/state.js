/**
 * @fileoverview The game state, and the saved game in the browser.
 */

export let state;

/**
 * Puts a fresh game state in place.
 * @param {!Object} fresh
 */
export function setState(fresh) {
  state = fresh;
}

// One formatter for every sum: toLocaleString() sets up a new one per call
const EURO = new Intl.NumberFormat('de-DE');
export const fmt = v => `${EURO.format(Math.round(v))} €`;
const SAVE_KEY = 'gtw-save';
/**
 * Reads the saved game.
 * @return {?Object}
 */
export function load() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
/** Saves the progress in the browser. */
export function store() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({n: state.jobN, money: state.money, stats: state.stats})
    );
  } catch {
    /* private mode */
  }
}

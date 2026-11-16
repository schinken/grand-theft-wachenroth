/**
 * @fileoverview Textures, all drawn here, 8 px per metre.
 */

import {PX_PER_M, TAU, canvas, rng, shade} from './util.js';
import {ctx} from './view.js';

/**
 * A repeating ground or roof texture, 8 pixels per metre.
 * @param {string} base Hex colour; it also seeds the random numbers.
 * @param {function(!CanvasRenderingContext2D, !Rng, number)=} draw Paints the
 *     details.
 * @param {number=} n Pixels square; the big ground textures use 128 so they
 *     repeat less.
 * @return {!CanvasPattern}
 */
function tex(base, draw, n = 64) {
  const c = canvas(n, n);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  if (draw) {
    draw(g, rng(parseInt(base.slice(1), 16)), n);
  }
  const p = ctx.createPattern(c, 'repeat');
  p.setTransform(new DOMMatrix().scaleSelf(1 / PX_PER_M));
  return p;
}
/**
 * Speckles a texture with short dashes in random colours.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number=} w
 * @param {number=} size
 */
function dots(g, r, n, cols, w = 1, size = 64) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.fillRect((r() * size) | 0, (r() * size) | 0, w + ((r() * 2) | 0), 1);
  }
}
/**
 * Soft patches, so lawns and tarmac are not one flat colour.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number} size
 */
function blots(g, r, n, cols, size) {
  g.globalAlpha = 0.35;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    const x = r() * size;
    const y = r() * size;
    const rad = 4 + r() * 9;
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, rad * 0.7, r() * 3, 0, TAU);
      g.fill();
    } // wraps at the edges
  }
  g.globalAlpha = 1;
}
/**
 * Blades of grass, two pixels tall.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} n
 * @param {!Array<string>} cols
 * @param {number} size
 */
function tufts(g, r, n, cols, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.fillRect((r() * size) | 0, (r() * size) | 0, 1, 2);
  }
}
const lawn = (base, blot, speck, tuft, flowers) =>
  tex(
    base,
    (g, r, n) => {
      blots(g, r, 26, blot, n);
      dots(g, r, 2600, speck, 1, n);
      tufts(g, r, 110, tuft, n);
      if (flowers) {
        dots(g, r, flowers, ['#e8e06a', '#f2f2e6', '#d86a8a', '#f2f2e6'], 1, n);
      }
    },
    128
  );
const rows = (base, line, speck, plants) =>
  tex(
    base,
    (g, r, n) => {
      // a field: furrows, and the lanes the tractor leaves
      blots(g, r, 16, [shade(base, 0.92), shade(base, 1.07)], n);
      for (let y = 0; y < n; y += 4) {
        g.fillStyle = line;
        g.fillRect(0, y, n, 1);
        g.fillStyle = shade(base, 1.1);
        g.fillRect(0, y + 1, n, 1); // every furrow has a dark and a sunny side
        if (plants) {
          for (let x = (y % 8) / 2; x < n; x += 4) {
            g.fillStyle = plants[(r() * plants.length) | 0];
            g.fillRect(x, y + 2, 2, 2);
          }
        }
      }
      dots(g, r, 900, speck, 2, n);
      g.fillStyle = shade(base, 0.72);
      g.fillRect(0, 49, n, 2);
      g.fillRect(0, 65, n, 2);
    },
    128
  );
const tiles = (base, dark, light) =>
  tex(base, (g, r) => {
    // roof tiles, every one a slightly different red; rows run along the ridge
    for (let y = 0; y < 64; y += 4) {
      for (let x = ((y / 4) % 2) * 2 - 2; x < 64; x += 4) {
        g.fillStyle = shade(base, 0.86 + r() * 0.28);
        g.fillRect(x, y, 4, 4);
        g.fillStyle = dark;
        g.fillRect(x, y + 3, 4, 1);
        g.fillRect(x, y, 1, 3);
        if (r() < 0.14) {
          g.fillStyle = light;
          g.fillRect(x + 1, y, 3, 1);
        }
      }
    }
  });
const slabs = (base, line, speck, step) =>
  tex(base, (g, r) => {
    dots(g, r, 260, speck);
    g.fillStyle = line;
    for (let i = 0; i < 64; i += step) {
      g.fillRect(i, 0, 1, 64);
      g.fillRect(0, i, 64, 1);
    }
  });
const sheet = (base, line, step) =>
  tex(base, g => {
    // corrugated metal, ribs run down the slope
    g.fillStyle = line;
    for (let x = 0; x < 64; x += step) {
      g.fillRect(x, 0, 1, 64);
    }
  });

export const textures = {
  grass: lawn(
    '#417a2e',
    ['#376f28', '#4b8935', '#3c782b'],
    ['#39702a', '#4a8634', '#346826', '#52913a'],
    ['#2d6022', '#5c9c42']
  ),
  meadow: lawn(
    '#5b9440',
    ['#52893a', '#68a24a', '#5f9a42'],
    ['#538a3a', '#66a048', '#6fa84e', '#4c8236'],
    ['#467c32', '#7cb458'],
    40
  ),
  forest: tex('#2c4f22', (g, r) =>
    dots(g, r, 600, ['#25441c', '#335a27', '#1f3b18'], 2)
  ),
  scrub: tex('#4b7a34', (g, r) =>
    dots(g, r, 500, ['#3c6829', '#5a8a3c', '#34591f'], 2)
  ),
  orchard: tex('#55903c', (g, r) =>
    dots(g, r, 400, ['#4c8236', '#63a046', '#467a30'])
  ),
  resi: lawn(
    '#4d8436',
    ['#457c31', '#58923e', '#4a8234'],
    ['#447a30', '#57903d', '#3e7029', '#5a9440'],
    ['#356a27', '#66a048'],
    26
  ),
  ind: slabs('#8b8b86', '#7b7b76', ['#84847f', '#93938e', '#7e7e79'], 32),
  com: slabs('#9c9a92', '#8c8a82', ['#94928a', '#a6a49c'], 16),
  school: slabs('#b3a98f', '#a09679', ['#a99f85', '#bdb399'], 8),
  yard: tex('#94896c', (g, r) =>
    dots(g, r, 600, ['#857a5e', '#a39878', '#7a7056', '#8b8b86'], 2)
  ),
  dump: tex('#8d867a', (g, r) =>
    dots(g, r, 700, ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9', '#5a564e'], 2)
  ),
  cem: lawn(
    '#4f8a3a',
    ['#467e33', '#5a9642', '#4b8436'],
    ['#467c32', '#5a9440', '#417630'],
    ['#356a27', '#68a24a']
  ),
  constr: tex('#9a8662', (g, r) =>
    dots(g, r, 500, ['#8a7654', '#a8946e', '#7c6a4a'], 2)
  ),
  park: tex('#58585d', (g, r) =>
    dots(g, r, 400, ['#505055', '#606065', '#4a4a4f'])
  ),
  play: tex('#c9b27a', (g, r) => dots(g, r, 300, ['#bba46c', '#d6c08a'])),
  clay: tex('#b5573a', (g, r) => dots(g, r, 300, ['#a84e33', '#c06343'])),
  water: tex('#2d6190', (g, r) => {
    g.fillStyle = '#4079aa';
    for (let i = 0; i < 40; i++) {
      g.fillRect((r() * 60) | 0, (r() * 64) | 0, 5, 1);
    }
  }),
  farmA: rows('#a39343', '#7f7030', ['#b3a350', '#8f823f']),
  farmB: rows('#6f5637', '#523d25', ['#7b6140', '#584226']),
  farmC: rows(
    '#5b4a30',
    '#4a3a24',
    ['#66543a'],
    ['#4f9a34', '#5fae3e', '#3f8a2c']
  ),
  farmD: rows('#c9ad4a', '#9f8636', ['#d8bf5c', '#b39a44']),
  // What the aerial photo shows on the fields: pale stubble, then crops from
  // olive to dark green
  field1: rows('#cbbd92', '#b3a57c', ['#d6c9a0', '#beb087']),
  field2: rows('#a2a45c', '#888b49', ['#aeb068', '#94974f']),
  field3: rows('#83a84a', '#6c8f3a', ['#8fb455', '#779a40']),
  field4: rows('#5f8d3c', '#4c772e', ['#699944', '#548233']),
  field5: rows('#42702f', '#345c25', ['#4b7b36', '#3a6429']),
  asphalt: tex(
    '#48484d',
    (g, r, n) => {
      // worn tarmac: patches, cracks and a manhole now and then
      blots(g, r, 9, ['#424247', '#4f4f55'], n);
      dots(g, r, 2400, ['#404045', '#505056', '#3a3a3f', '#57575c'], 1, n);
      g.fillStyle = '#45454a';
      g.fillRect(18, 70, 24, 13);
      g.strokeStyle = '#38383c';
      g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        let x = r() * n;
        let y = r() * n;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 14;
          y += (r() - 0.2) * 9;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = '#2e2e32';
      g.beginPath();
      g.arc(90, 38, 3.2, 0, TAU);
      g.fill();
      g.strokeStyle = '#5e5e64';
      g.beginPath();
      g.arc(90, 38, 3.2, 0, TAU);
      g.stroke();
    },
    128
  ),
  cobble: tex('#8a867c', (g, r) => {
    g.fillStyle = '#726e66';
    for (let y = 0; y < 64; y += 4) {
      g.fillRect(0, y, 64, 1);
      for (let x = ((y / 4) % 2) * 4; x < 64; x += 8) {
        g.fillRect(x, y, 1, 4);
      }
    }
    dots(g, r, 120, ['#98948a', '#7e7a70']);
  }),
  sidewalk: slabs('#a09f97', '#8a8981', ['#96958d', '#aaa9a1'], 8),
  dirt: tex('#8b7350', (g, r) =>
    dots(g, r, 500, ['#7d6645', '#99815c', '#735d3e'], 2)
  ),
  gravel: tex('#7d776c', (g, r) =>
    dots(g, r, 600, ['#6c675d', '#8f897d', '#5f5a51'])
  ),
  yard: tex('#a8a190', (g, r) =>
    dots(g, r, 600, ['#9a9383', '#b5ae9d', '#8f8878'])
  ),
  tile1: tiles('#a5432b', '#8a3421', '#b8553a'),
  tile2: tiles('#b5622f', '#964c20', '#c8773f'),
  tile3: tiles('#7c3c2b', '#652e20', '#8f4a36'),
  tile4: tiles('#93382a', '#7a2b1f', '#a84a38'),
  tile5: tiles('#8b776a', '#75635a', '#9d897b'), // weathered to grey-brown
  tile6: tiles('#7c7d7f', '#68696c', '#8e8f92'), // grey concrete tiles
  slate: tiles('#4a4e57', '#3c4048', '#5a5e68'),
  metal: sheet('#9aa0a6', '#858b92', 4),
  metalRed: sheet('#8a4a3c', '#753c30', 4),
  tar: tex('#55565a', (g, r) => dots(g, r, 400, ['#4c4d51', '#5e5f63'], 2)),
  flat: tex('#7e7f84', (g, r) => {
    dots(g, r, 500, ['#74757a', '#88898e', '#6c6d72'], 2);
    g.fillStyle = '#5f6065';
    g.fillRect(40, 12, 5, 5);
  }),
  flatLight: slabs('#a8aab0', '#989aa0', ['#9ea0a6', '#b2b4ba'], 32),
  slab: tex('#bcbcb4', (g, r) => {
    dots(g, r, 200, ['#aeaea6', '#c8c8c0']);
    g.fillStyle = '#8e8e86';
    for (let y = 0; y < 64; y += 5) {
      g.fillRect(0, y, 64, 1);
    }
  }),
  concrete: tex('#b4b4ae', (g, r) =>
    dots(g, r, 300, ['#a8a8a2', '#c0c0ba'], 2)
  ),
  solar: tex('#9a9ca2', g => {
    for (let y = 2; y < 64; y += 16) {
      for (let x = 1; x < 64; x += 16) {
        g.fillStyle = '#1d2c4d';
        g.fillRect(x, y, 14, 11);
        g.fillStyle = '#31497a';
        g.fillRect(x, y, 14, 1);
        g.fillRect(x + 7, y, 1, 11);
      }
    }
  }),
};

// Tree canopies as little pixel blobs.
export const CANOPY = [
  ['#1f4a1c', '#2c6425', '#3b7d2e', '#4f9438'],
  ['#24521f', '#327029', '#44883a', '#5c9f45'],
  ['#2a4a16', '#3e6a1e', '#557f28', '#6f9932'],
].map((cols, n) => {
  const c = canvas(40, 40);
  const g = c.getContext('2d');
  const r = rng(90 + n);
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 12 - k * 2; i++) {
      const a = r() * TAU;
      const d = r() * (13 - k * 3.4);
      g.fillStyle = cols[k];
      g.beginPath();
      g.arc(
        20 + Math.cos(a) * d - k * 1.5,
        20 + Math.sin(a) * d - k * 1.5,
        6 - k,
        0,
        TAU
      );
      g.fill();
    }
  }
  return c;
});

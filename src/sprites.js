/**
 * @fileoverview Vehicle types and their sprites, trailers, and icons.
 */

import {PX_PER_M, canvas, shade} from './util.js';

export const TYPES = {
  car: {
    name: [
      'Familienkutsche',
      'Rostlaube',
      'Dorfschleuder',
      'Kombi vom Nachbarn',
    ],
    length: 4.4,
    width: 2,
    max: 38,
    acc: 15,
    hp: 100,
    mass: 1,
  },
  sport: {
    name: ['Sportflitzer', 'Angeberkarre'],
    length: 4.4,
    width: 2,
    max: 48,
    acc: 20,
    hp: 80,
    mass: 0.9,
  },
  van: {
    name: ['Kastenwagen', 'Handwerkerbus'],
    length: 5.6,
    width: 2.3,
    max: 30,
    acc: 11,
    hp: 140,
    mass: 1.7,
  },
  pizza: {
    name: ['Pizza-Flitzer'],
    length: 3.9,
    width: 1.9,
    max: 41,
    acc: 18,
    hp: 150,
    mass: 0.9,
  },
  police: {
    name: ['Streifenwagen'],
    length: 4.6,
    width: 2,
    max: 45,
    acc: 19,
    hp: 150,
    mass: 1.1,
  },
  tractor: {
    name: ['Bulldog'],
    length: 4.2,
    width: 2.3,
    max: 16,
    acc: 10,
    hp: 220,
    mass: 2.4,
  },
  truck: {
    name: ['Bierlaster'],
    length: 7.4,
    width: 2.5,
    max: 27,
    acc: 9,
    hp: 230,
    mass: 3,
  },
  tipper: {
    name: ['Kipper'],
    length: 7,
    width: 2.5,
    max: 26,
    acc: 9,
    hp: 250,
    mass: 3.2,
  },
  heli: {
    name: ['Flügeldreher'],
    length: 9,
    width: 2.4,
    max: 42,
    acc: 12,
    hp: 260,
    mass: 3,
  },
  digger: {
    name: ['Mini-Bagger'],
    length: 3.6,
    width: 1.7,
    max: 11,
    acc: 6,
    hp: 220,
    mass: 2.6,
  },
  tanker: {
    name: ['Heizöl-Laster'],
    length: 7.6,
    width: 2.5,
    max: 26,
    acc: 9,
    hp: 240,
    mass: 3.4,
  },
  mixer: {
    name: ['Betonmischer'],
    length: 7.8,
    width: 2.6,
    max: 25,
    acc: 8.5,
    hp: 280,
    mass: 4,
  },
  fire: {
    name: ['Löschfahrzeug LF 16/12'],
    length: 7.2,
    width: 2.5,
    max: 33,
    acc: 12,
    hp: 280,
    mass: 3,
  },
};
for (const [kind, type] of Object.entries(TYPES)) {
  // Axles are centred about the body. Aircraft and tracked vehicles keep
  // their own steering; longer wheeled vehicles need more room to turn.
  type.wheelbase ??=
    kind === 'heli' || kind === 'digger' ? 0 : type.length * 0.62;
  // a row of collision circles along the body
  type.r = type.width / 2;
  const e = type.length / 2 - type.r;
  type.offs = type.length > 6 ? [e, 0, -e] : [e, -e];
}
export const COLORS = [
  '#c8322b',
  '#2b62c8',
  '#e8e6df',
  '#22242a',
  '#2f8f4a',
  '#9aa2ad',
  '#d9651e',
  '#7a3fb0',
  '#e0b21c',
  '#6b4a2a',
];
export const PAINT = {
  pizza: '#efece2',
  police: '#d9dcdf',
  tractor: '#2e7d32',
  truck: '#2b62c8',
  tipper: '#284d98',
  mixer: '#284d98',
  tanker: '#c8201c',
  digger: '#e8b21c',
  heli: '#c8201c',
  fire: '#c8201c',
  van: '#eeeee8',
};
const spriteCache = new Map();

/**
 * What a vehicle is painted with: its canvas c with the context g, its size
 * w and h and half its height mid, kind, frame and extras as carSprite() got
 * them, whether it is a wreck, the colours body and glass, and a few strokes:
 * rect() fills a rectangle, paint() gives a colour as it looks burnt on a
 * wreck, box() draws a rounded, outlined slab from x0 to x1, and cab() a
 * driver's cab of some length at the nose.
 * @typedef {!Object}
 */
let Pen;

/**
 * @param {string} kind
 * @param {string} col
 * @param {number} frame
 * @param {string} extras
 * @return {!Pen}
 */
function pen(kind, col, frame, extras) {
  const type = TYPES[kind];
  const w = Math.round(type.length * PX_PER_M);
  const h = Math.round(type.width * PX_PER_M);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const wreck = col === 'wreck';
  const body = wreck ? '#2b2724' : col;
  const glass = wreck ? '#141210' : '#182533';
  const rect = (x, y, ww, hh, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, ww, hh);
  };
  const paint = f =>
    wreck ? shade('#2b2724', 0.8 + (parseInt(f.slice(1, 3), 16) % 5) / 12) : f;
  const box = (x0, x1, f) => {
    rect(x0 + 2, 0, x1 - x0 - 4, h, '#0b0b0d');
    rect(x0, 2, x1 - x0, h - 4, '#0b0b0d');
    rect(x0 + 1, 1, x1 - x0 - 2, h - 2, '#0b0b0d');
    rect(x0 + 2, 1, x1 - x0 - 4, h - 2, f);
    rect(x0 + 1, 2, x1 - x0 - 2, h - 4, f);
    rect(x0 + 3, 1, x1 - x0 - 6, 1, shade(f, 1.25));
    rect(x0 + 3, h - 2, x1 - x0 - 6, 1, shade(f, 0.7));
  };
  const cab = len => {
    box(w - len, w, body);
    rect(w - len + 5, 2, 4, h - 4, glass);
    rect(w - len + 1, 3, 4, h - 6, shade(body, 1.1));
  };
  const mid = h >> 1;
  return {
    ...{c, g, w, h, mid, kind, frame, extras, wreck, body, glass},
    ...{rect, paint, box, cab},
  };
}

/**
 * The police car: blue flanks and bonnet, and the light bar on the roof.
 * @param {!Pen} p
 * @param {number} a Where the glass begins.
 */
function paintPolice(p, a) {
  const {w, h, rect} = p;
  rect(3, 1, w - 6, 2, '#1f5fbf');
  rect(3, h - 3, w - 6, 2, '#1f5fbf');
  rect(w - 9, 3, 6, h - 6, '#1f5fbf');
  rect(a + 7, 3, 3, h - 6, '#cfd8e6');
}

/**
 * The pizza car: red and green flanks, and the sign on the roof.
 * @param {!Pen} p
 * @param {number} a Where the glass begins.
 */
function paintPizza(p, a) {
  const {w, h, mid, rect} = p;
  rect(3, 1, w - 6, 2, '#c8201c');
  rect(3, h - 3, w - 6, 2, '#2f8f4a');
  rect(a + 4, mid - 4, 8, 8, '#0b0b0d');
  rect(a + 5, mid - 3, 2, 6, '#2f8f4a');
  rect(a + 7, mid - 3, 2, 6, '#f4f4ef');
  rect(a + 9, mid - 3, 2, 6, '#c8201c');
}

/**
 * A saloon: the ordinary car, the sports car with its stripe, the police car
 * and the pizza car.
 * @param {!Pen} p
 */
function paintSaloon(p) {
  const {w, h, mid, kind, wreck, body, glass, rect, box} = p;
  const a = Math.round(w * 0.2);
  const b = Math.round(w * 0.6);
  const stripe = kind === 'sport' && !wreck;
  box(0, w, body);
  if (stripe) {
    rect(2, mid - 1, w - 4, 2, '#f4f4ef');
  }
  rect(a, 2, b - a + 5, h - 4, glass);
  rect(a + 3, 3, b - a - 3, h - 6, shade(body, 1.12));
  if (stripe) {
    rect(a + 3, mid - 1, b - a - 3, 2, '#f4f4ef');
  }
  if (kind === 'police' && !wreck) {
    paintPolice(p, a);
  }
  if (kind === 'pizza' && !wreck) {
    paintPizza(p, a);
  }
}

/**
 * A van, with the stripe of its company.
 * @param {!Pen} p
 */
function paintVan(p) {
  const {w, h, mid, frame, wreck, body, glass, rect, box} = p;
  box(0, w, body);
  rect(w - 12, 2, 5, h - 4, glass);
  rect(3, 2, w - 17, h - 4, shade(body, 1.06));
  if (!wreck) {
    rect(3, mid - 1, w - 17, 3, COLORS[frame % COLORS.length]);
  }
}

/**
 * A tractor: big wheels behind, small ones in front, the cab at the back.
 * @param {!Pen} p
 */
function paintTractor(p) {
  const {w, h, body, glass, rect} = p;
  rect(1, 0, 12, 5, '#101012');
  rect(1, h - 5, 12, 5, '#101012');
  rect(w - 10, 1, 7, 3, '#101012');
  rect(w - 10, h - 4, 7, 3, '#101012');
  rect(5, 4, w - 7, h - 8, '#0b0b0d');
  rect(6, 5, w - 9, h - 10, body);
  rect(w - 13, 6, 10, h - 12, shade(body, 1.15));
  rect(w - 4, 6, 1, h - 12, '#333');
  rect(5, 3, 13, h - 6, '#0b0b0d');
  rect(6, 4, 11, h - 8, glass);
  rect(8, 6, 7, h - 12, shade(body, 0.8));
  rect(w - 15, 5, 2, 2, '#444');
}

/**
 * A lorry with a tarpaulin.
 * @param {!Pen} p
 */
function paintTruck(p) {
  const {w, h, mid, wreck, rect, paint, box, cab} = p;
  box(0, w - 14, paint('#efe6cc'));
  if (!wreck) {
    rect(3, mid - 3, w - 20, 6, '#d99a1a');
    rect(3, mid - 1, w - 20, 2, '#f6efd9');
    for (let x = 7; x < w - 20; x += 8) {
      rect(x, 2, 1, h - 4, '#d6ccae');
    }
  }
  cab(15);
}

/**
 * A tipper full of rubble.
 * @param {!Pen} p
 */
function paintTipper(p) {
  const {w, h, wreck, rect, paint, box, cab} = p;
  box(0, w - 14, paint('#6c6f76'));
  rect(3, 3, w - 20, h - 6, paint('#8d867a'));
  if (!wreck) {
    for (let i = 0; i < 40; i++) {
      rect(
        3 + ((i * 37) % (w - 21)),
        3 + ((i * 53) % (h - 7)),
        2,
        1,
        ['#6f6a60', '#a59e90', '#b56a4a', '#c9c5b9'][i % 4]
      );
    }
  }
  cab(15);
}

/**
 * A helicopter: the tail boom with its fin, the cabin with the glass in
 * front, skids.
 * @param {!Pen} p
 */
function paintHeli(p) {
  const {w, h, mid, body, glass, rect, box} = p;
  rect(0, mid - 1, w * 0.5, 3, shade(body, 0.75));
  rect(0, mid - 4, 4, 8, shade(body, 0.75));
  rect(1, mid - 6, 2, 12, '#2b2b2e');
  rect(w * 0.42, 0, w * 0.48, 2, '#2b2b2e');
  rect(w * 0.42, h - 2, w * 0.48, 2, '#2b2b2e');
  box((w * 0.38) | 0, w, body);
  rect(w - 13, 3, 10, h - 6, glass);
  rect(w * 0.55, mid - 1, 4, 2, '#f4f4ef');
}

/**
 * A mini-excavator: tracks, the yellow house with its cab, the arm and the
 * bucket in front, full of earth when extras says e.
 * @param {!Pen} p
 */
function paintDigger(p) {
  const {w, h, mid, extras, wreck, body, glass, rect} = p;
  for (const y of [0, h - 3]) {
    rect(1, y, w - 9, 3, '#1c1c1e');
    for (let x = 2; x < w - 9; x += 3) {
      rect(x, y, 1, 3, '#3a3a3e');
    }
  }
  rect(3, 2, 14, h - 4, '#0b0b0d');
  rect(4, 3, 12, h - 6, body);
  rect(10, 3, 5, h - 6, glass);
  rect(16, mid - 1, w - 22, 3, shade(body, 0.8));
  rect(w - 7, mid - 3, 6, 7, '#3a3a3e');
  if (extras.includes('e') && !wreck) {
    rect(w - 7, mid - 3, 6, 7, '#6b4a2a');
    rect(w - 6, mid - 2, 2, 2, '#8a6a48');
  }
}

/**
 * A tanker: a silver tank with ribs and a red stripe behind the cab.
 * @param {!Pen} p
 */
function paintTanker(p) {
  const {w, h, mid, wreck, rect, paint, cab} = p;
  const tw = w - 17;
  const tank = paint('#d6d8dc');
  rect(2, 2, tw, h - 4, '#0b0b0d');
  rect(3, 1, tw - 2, h - 2, '#0b0b0d');
  rect(3, 2, tw - 2, h - 4, tank);
  rect(4, 3, tw - 4, 2, shade(tank, 1.15));
  rect(4, h - 5, tw - 4, 2, shade(tank, 0.8));
  if (!wreck) {
    for (let x = 9; x < tw - 2; x += 10) {
      rect(x, 2, 1, h - 4, shade(tank, 0.75));
    }
    rect(3, mid - 1, tw - 2, 2, '#c8201c');
  }
  cab(15);
}

/**
 * A concrete mixer; the spiral on its drum turns with the frame.
 * @param {!Pen} p
 */
function paintMixer(p) {
  const {w, h, mid, frame, wreck, body, rect, paint, cab} = p;
  const dw = w - 21;
  const drum = paint('#d8d8d2');
  rect(2, 3, w - 16, h - 6, '#26262a');
  rect(5, 1, dw - 4, h - 2, '#0b0b0d');
  rect(3, 3, dw, h - 6, '#0b0b0d');
  rect(5, 2, dw - 4, h - 4, drum);
  rect(4, 4, dw - 2, h - 8, drum);
  if (!wreck) {
    for (let x = -4 + frame * 2; x < dw; x += 8) {
      for (let y = 2; y < h - 2; y++) {
        const xx = 3 + x + (y >> 1);
        const inX = xx > 4 && xx < dw + 1;
        if (inX && ((y > 3 && y < h - 4) || (xx > 5 && xx < dw - 1))) {
          rect(xx, y, 2, 1, body);
        }
      }
    }
  }
  rect(5, 2, dw - 4, 1, shade(drum, 1.1));
  rect(dw + 2, mid - 2, 3, 4, '#55565a');
  cab(15);
}

/**
 * A fire engine, with its lockers and the ladder on the roof.
 * @param {!Pen} p
 */
function paintFireEngine(p) {
  const {w, h, mid, wreck, body, glass, rect, box} = p;
  box(0, w, body);
  if (!wreck) {
    rect(3, 1, w - 20, 3, '#c4c7cc');
    rect(3, h - 4, w - 20, 3, '#c4c7cc');
    for (let x = 8; x < w - 18; x += 6) {
      rect(x, 1, 1, 3, '#8d9096');
      rect(x, h - 4, 1, 3, '#8d9096');
    }
    rect(5, mid - 3, w - 24, 1, '#e6e6e0');
    rect(5, mid + 2, w - 24, 1, '#e6e6e0');
    for (let x = 6; x < w - 20; x += 3) {
      rect(x, mid - 2, 1, 4, '#e6e6e0');
    }
    rect(w - 17, 1, 2, h - 2, '#f4f4ef');
  }
  rect(w - 10, 2, 5, h - 4, glass);
  rect(w - 14, 3, 3, h - 6, shade(body, 1.15));
}

/**
 * Paints the body of a vehicle, by its kind.
 * @param {!Pen} p
 */
function paintBody(p) {
  switch (p.kind) {
    case 'car':
    case 'sport':
    case 'police':
    case 'pizza':
      paintSaloon(p);
      break;
    case 'van':
      paintVan(p);
      break;
    case 'tractor':
      paintTractor(p);
      break;
    case 'truck':
      paintTruck(p);
      break;
    case 'tipper':
      paintTipper(p);
      break;
    case 'heli':
      paintHeli(p);
      break;
    case 'digger':
      paintDigger(p);
      break;
    case 'tanker':
      paintTanker(p);
      break;
    case 'mixer':
      paintMixer(p);
      break;
    case 'fire':
      paintFireEngine(p);
      break;
    default:
      throw new Error(`no picture for the vehicle ${p.kind}`);
  }
}

/**
 * Head lamps and tail lamps.
 * @param {!Pen} p
 */
function paintLamps(p) {
  const {w, h, rect} = p;
  rect(w - 2, 2, 1, 3, '#ffe9a0');
  rect(w - 2, h - 5, 1, 3, '#ffe9a0');
  rect(1, 2, 1, 3, '#e02a2a');
  rect(1, h - 5, 1, 3, '#e02a2a');
}

/**
 * Racing stripes, from the garage.
 * @param {!Pen} p
 */
function paintStripes(p) {
  const {w, mid, rect} = p;
  rect(3, mid - 3, w - 6, 2, '#f4f4ef');
  rect(3, mid + 1, w - 6, 2, '#f4f4ef');
}

/**
 * Flames on the bonnet, from the garage.
 * @param {!Pen} p
 */
function paintFlames(p) {
  const {g, w, h} = p;
  for (let i = 0; i < 4; i++) {
    const y = 2 + (i * (h - 4)) / 4;
    g.fillStyle = i % 2 ? '#f2a01c' : '#e8501c';
    g.beginPath();
    g.moveTo(w - 3, y);
    g.lineTo(w - 3, y + (h - 4) / 4);
    g.lineTo(w * 0.55, y + (h - 4) / 8);
    g.fill();
  }
}

/**
 * A rear spoiler, from the garage.
 * @param {!Pen} p
 */
function paintSpoiler(p) {
  const {h, rect} = p;
  rect(0, 1, 3, h - 2, '#15151a');
  rect(3, 3, 2, 2, '#15151a');
  rect(3, h - 5, 2, 2, '#15151a');
}

/**
 * The picture of a vehicle, drawn nose-right.
 * @param {string} kind
 * @param {string} col Body colour; 'wreck' gives the burnt-out shell.
 * @param {number=} frame Animation frame or livery.
 * @param {string=} extras From the garage: r racing stripes, f flames, s a
 *     rear spoiler.
 * @return {!HTMLCanvasElement}
 */
export function carSprite(kind, col, frame = 0, extras = '') {
  const key = kind + col + frame + extras;
  if (spriteCache.has(key)) {
    return spriteCache.get(key);
  }
  const p = pen(kind, col, frame, extras);
  paintBody(p);
  if (!p.wreck) {
    paintLamps(p);
  }
  if (!p.wreck && extras.includes('r')) {
    paintStripes(p);
  }
  if (!p.wreck && extras.includes('f')) {
    paintFlames(p);
  }
  if (!p.wreck && extras.includes('s')) {
    paintSpoiler(p);
  }
  spriteCache.set(key, p.c);
  return p.c;
}

export const TRAILERS = {
  grain: {length: 5.2, width: 2.3},
  log: {length: 13, width: 1.8},
  cart: {length: 5.2, width: 2.3},
  wood: {length: 5.2, width: 2.3},
  xmas: {length: 5.2, width: 2.3},
  fert: {length: 5.2, width: 2.3},
};

/**
 * Fills a rectangle: x, y, width, height and colour.
 * @typedef {function(number, number, number, number, string)}
 */
let Rect;

/**
 * Logs, stacked crosswise on a cart.
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function loadLogs(rect, w, h) {
  for (let x = 4; x < w - 8; x += 4) {
    rect(x, 3, 3, h - 6, x % 8 ? '#a0703c' : '#8a5a2a');
    rect(x + 1, h / 2 - 1, 1, 2, '#e0c08a');
  }
}

/**
 * Christmas trees, lying lengthwise on a cart.
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function loadXmasTrees(rect, w, h) {
  for (let y = 3; y < h - 5; y += 4) {
    rect(4, y, w - 14, 4, y % 8 > 3 ? '#2a7a3a' : '#1f5e2d');
    rect(w - 10, y + 1, 3, 2, '#6b4a2a');
    rect(8 + (y % 5) * 4, y + 1, 1, 1, '#d9dde2'); // tinsel left on
  }
}

/**
 * Sacks of fertiliser on a cart.
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function loadSacks(rect, w, h) {
  for (let x = 4; x < w - 10; x += 6) {
    for (let y = 3; y < h - 6; y += 6) {
      rect(x, y, 5, 5, '#ecebe4');
      rect(x + 1, y + 2, 3, 1, '#3c7a30');
    }
  }
}

/**
 * Grain, heaped on a cart.
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function loadGrain(rect, w, h) {
  for (let i = 0; i < 50; i++) {
    rect(
      3 + ((i * 29) % (w - 10)),
      4 + ((i * 17) % (h - 9)),
      1,
      1,
      i % 2 ? '#f0cf5a' : '#b8922a'
    );
  }
}

// The bed of a farm cart under its load; an empty one shows its boards.
const CART_BEDS = {wood: '#3a2a1a', grain: '#d9b23c'};

/**
 * A farm cart with what it carries.
 * @param {string} kind
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function paintCart(kind, rect, w, h) {
  rect(4, 0, 8, h, '#101012');
  rect(w - 14, 0, 8, h, '#101012');
  rect(0, 1, w - 3, h - 2, '#0b0b0d');
  rect(1, 2, w - 5, h - 4, '#6b4a2a');
  rect(3, 4, w - 9, h - 8, CART_BEDS[kind] || '#8a6a48');
  switch (kind) {
    case 'wood':
      loadLogs(rect, w, h);
      break;
    case 'xmas':
      loadXmasTrees(rect, w, h);
      break;
    case 'fert':
      loadSacks(rect, w, h);
      break;
    case 'grain':
      loadGrain(rect, w, h);
      break;
    default: // a plain cart is empty
  }
  rect(w - 3, h / 2 - 1, 3, 2, '#333');
}

/**
 * The trailer with the maypole: white and blue, wreath at the tip.
 * @param {!Rect} rect
 * @param {number} w
 * @param {number} h
 */
function paintMaypole(rect, w, h) {
  rect(6, 0, 8, h, '#101012');
  rect(w - 26, 0, 8, h, '#101012');
  rect(4, 3, w - 12, h - 6, '#2a2a2e');
  rect(0, h / 2 - 2, w - 6, 4, '#f4f4ef');
  for (let x = 2; x < w - 8; x += 8) {
    rect(x, h / 2 - 2, 4, 4, '#2b62c8');
  }
  rect(0, h / 2 - 4, 5, 8, '#2f8f4a');
  rect(w - 6, h / 2 - 1, 6, 2, '#333');
}

for (const [kind, type] of Object.entries(TRAILERS)) {
  const w = (type.length * PX_PER_M) | 0;
  const h = (type.width * PX_PER_M) | 0;
  const c = (type.spr = canvas(w, h));
  const g = c.getContext('2d');
  const rect = (x, y, ww, hh, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, ww, hh);
  };
  if (kind === 'log') {
    paintMaypole(rect, w, h);
  } else {
    paintCart(kind, rect, w, h);
  }
}

/**
 * A can of Jacky Cola.
 * @param {!Rect} rect
 */
function iconCan(rect) {
  rect(3, 1, 6, 10, '#111');
  rect(4, 2, 4, 8, '#1c1c1c');
  rect(4, 4, 4, 3, '#b3261e');
  rect(4, 1, 4, 1, '#c9c9c9');
  rect(5, 5, 2, 1, '#fff');
}

/**
 * A banknote.
 * @param {!Rect} rect
 */
function iconCash(rect) {
  rect(1, 3, 10, 6, '#1e5a2a');
  rect(2, 4, 8, 4, '#4caf50');
  rect(5, 5, 2, 2, '#e8f5e9');
}

/**
 * A carp.
 * @param {!Rect} rect
 */
function iconFish(rect) {
  rect(2, 4, 6, 4, '#8a9a7a');
  rect(3, 3, 4, 6, '#a8b894');
  rect(8, 3, 2, 6, '#6f7f62');
  rect(3, 5, 1, 1, '#111');
}

/**
 * A hen.
 * @param {!Rect} rect
 */
function iconHen(rect) {
  rect(3, 4, 7, 6, '#f4f2ea');
  rect(2, 5, 2, 3, '#e0dccf');
  rect(8, 2, 3, 3, '#f4f2ea');
  rect(9, 1, 2, 1, '#d8302a');
  rect(11, 3, 1, 1, '#f2a01c');
  rect(9, 3, 1, 1, '#111');
  rect(5, 10, 1, 2, '#f2a01c');
  rect(7, 10, 1, 2, '#f2a01c');
}

/**
 * The chainsaw that marks a tree to cut.
 * @param {!Rect} rect
 */
function iconSaw(rect) {
  rect(1, 4, 6, 5, '#e8501c');
  rect(2, 5, 4, 3, '#f2a01c');
  rect(7, 5, 5, 3, '#b9bec4');
  rect(7, 6, 5, 1, '#6f757c');
  rect(1, 3, 3, 1, '#15151a');
}

/**
 * A Christmas tree put out, a strand of tinsel still on it.
 * @param {!Rect} rect
 */
function iconXmasTree(rect) {
  rect(5, 0, 2, 2, '#2f8f4a');
  rect(4, 2, 4, 3, '#2a7a3a');
  rect(3, 5, 6, 3, '#246b33');
  rect(2, 8, 8, 2, '#1f5e2d');
  rect(5, 10, 2, 2, '#6b4a2a');
  rect(4, 4, 1, 1, '#d9dde2');
  rect(7, 7, 1, 1, '#d9dde2');
  rect(3, 9, 1, 1, '#d9dde2');
}

/**
 * A barrel of beer.
 * @param {!Rect} rect
 */
function iconBarrel(rect) {
  rect(2, 1, 8, 10, '#6b4a2a');
  rect(1, 3, 10, 6, '#8a6238');
  rect(1, 3, 10, 1, '#b9b9b4');
  rect(1, 8, 10, 1, '#b9b9b4');
  rect(5, 5, 2, 2, '#3a2a1a');
}

/**
 * A crate, for anything else.
 * @param {!Rect} rect
 */
function iconCrate(rect) {
  rect(1, 2, 10, 8, '#6b4a2a');
  rect(2, 3, 8, 6, '#c69c6d');
  rect(1, 5, 10, 1, '#6b4a2a');
  rect(5, 2, 1, 8, '#6b4a2a');
}

/**
 * Paints the icon of a thing, by its kind.
 * @param {string} kind
 * @param {!Rect} rect
 */
function paintIcon(kind, rect) {
  switch (kind) {
    case 'can':
      iconCan(rect);
      break;
    case 'cash':
      iconCash(rect);
      break;
    case 'fish':
      iconFish(rect);
      break;
    case 'hen':
      iconHen(rect);
      break;
    case 'tree':
      iconSaw(rect);
      break;
    case 'xmas':
      iconXmasTree(rect);
      break;
    case 'barrel':
      iconBarrel(rect);
      break;
    default:
      iconCrate(rect);
  }
}

const iconCache = {};
/**
 * Little pixel pictures for the things you carry around, 12 px square.
 * @param {string} kind
 * @return {!HTMLCanvasElement}
 */
export function icon(kind) {
  if (iconCache[kind]) {
    return iconCache[kind];
  }
  const c = (iconCache[kind] = canvas(12, 12));
  const g = c.getContext('2d');
  paintIcon(kind, (x, y, w, h, f) => {
    g.fillStyle = f;
    g.fillRect(x, y, w, h);
  });
  return c;
}

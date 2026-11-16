/**
 * @fileoverview The yards, gardens and squares that are painted by hand, as the
 * aerial photo shows them.
 */

import {textures} from './textures.js';
import {TAU, pick2, rng} from './util.js';

/**
 * Scatters flowers over a bed.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Rng} r
 * @param {number} x The bed, in metres.
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function flowerBed(g, r, x, y, w, h) {
  g.fillStyle = '#4a3a2a';
  g.fillRect(x, y, w, h);
  for (let i = 0; i < w * h * 5; i++) {
    g.fillStyle = pick2(
      ['#d83a3a', '#f2d23e', '#f4f4ef', '#c85aa8', '#e8762e', '#3c7a30'],
      r
    );
    g.fillRect(x + r() * (w - 0.3), y + r() * (h - 0.3), 0.3, 0.3);
  }
}

/**
 * The garden of the house no14, between the house and the bend of the
 * street: lawn, terrace with a pergola, a sun sail, beds, vegetables and a
 * pond. Drawn with x east along the front of the house and y towards the
 * street in the south.
 * @param {!CanvasRenderingContext2D} g
 */
function paintGarden(g) {
  const r = rng(14);
  // The drive to the garage and the path to the front door
  g.fillStyle = textures.school;
  g.fillRect(-8.4, -11.6, 8.7, 4.7);
  g.fillRect(0.3, -10.1, 5.2, 1.6);
  // Lawn, mown in stripes
  g.save();
  g.beginPath();
  for (const [x, y] of [
    [5.5, -11.4],
    [6.2, -11.4],
    [21.5, -8.2],
    [19.1, -3.2],
    [-8.1, 24.6],
    [-8.1, 2],
    [5.5, 2],
  ]) {
    g.lineTo(x, y);
  }
  g.clip();
  g.fillStyle = textures.resi;
  g.fillRect(-9, -12, 32, 38);
  g.fillStyle = 'rgba(190,255,150,.09)';
  for (let x = -9; x < 23; x += 2.4) {
    g.fillRect(x, -12, 1.2, 38);
  }
  g.restore();
  // Terrace, with a pergola and a table under it
  g.fillStyle = textures.school;
  g.fillRect(0.5, 0, 9.2, 4.5);
  g.fillRect(-7.6, 2.4, 7, 5); // and the seats under the sun sail
  g.fillStyle = '#6b4a2a';
  g.fillRect(4.6, 1.5, 1.9, 1);
  g.fillStyle = '#d9d2c0';
  for (const [x, y] of [
    [4.9, 0.9],
    [5.9, 0.9],
    [4.9, 2.7],
    [5.9, 2.7],
  ]) {
    g.fillRect(x, y, 0.5, 0.5);
  }
  g.fillStyle = 'rgba(60,40,24,.3)';
  g.fillRect(3.9, 0.75, 3.5, 2.9);
  g.fillStyle = '#efe9da';
  for (let x = 3.8; x < 7.3; x += 0.6) {
    g.fillRect(x, 0.6, 0.3, 2.9);
  }
  g.fillStyle = '#c85a3a'; // loungers
  g.fillRect(-6.4, 4.2, 0.8, 2);
  g.fillRect(-5.1, 4.2, 0.8, 2);
  g.fillStyle = 'rgba(0,0,0,.2)';
  g.beginPath();
  g.moveTo(-6.6, 3.2);
  g.lineTo(-0.8, 3.6);
  g.lineTo(-4.1, 7.8);
  g.fill();
  g.fillStyle = '#f6f3ea';
  g.beginPath();
  g.moveTo(-7, 2.8);
  g.lineTo(-1.2, 3.2);
  g.lineTo(-4.5, 7.4);
  g.fill();
  // Beds: along the house, along the terrace, along the fence to the street
  flowerBed(g, r, 10.4, -8.3, 1.1, 8);
  flowerBed(g, r, 0.5, 4.5, 9.2, 0.9);
  g.save();
  g.translate(18.4, -2.4);
  g.rotate(Math.atan2(27, -26.2));
  flowerBed(g, r, 0, 0, 22, 1);
  g.restore();
  // Vegetables in rows
  g.fillStyle = '#4a3a2a';
  g.fillRect(-7.3, 11.5, 4.8, 5.6);
  g.fillStyle = '#3c7a30';
  for (let y = 12; y < 17; y += 1.05) {
    g.fillRect(-7, y, 4.2, 0.45);
  }
  g.fillStyle = '#d83a3a';
  for (let x = -6.8; x < -3; x += 0.7) {
    g.fillRect(x, 13.1, 0.25, 0.25);
  }
  // A pond with water lilies, and stepping stones to it
  g.fillStyle = '#8f897d';
  g.beginPath();
  g.ellipse(15.3, -5.6, 2, 1.4, 0.4, 0, TAU);
  g.fill();
  g.fillStyle = '#4a8fc4';
  g.beginPath();
  g.ellipse(15.3, -5.6, 1.6, 1.05, 0.4, 0, TAU);
  g.fill();
  g.fillStyle = '#3c7a30';
  g.fillRect(14.6, -5.9, 0.5, 0.5);
  g.fillRect(15.8, -5.4, 0.5, 0.5);
  g.fillStyle = '#f4f4ef';
  g.fillRect(14.75, -5.75, 0.2, 0.2);
  g.fillStyle = '#b9b4a6';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(10.3 + i * 0.85, 2.6 - i * 1.25, 0.34, 0, TAU);
    g.fill();
  }
}

/**
 * The village square around the town hall, as the aerial photo shows it: pale
 * paving from the house fronts to the main road, the steps and flower tubs
 * at the door, the raised bed in front of the Schwarzer Adler, and the car
 * park behind the town hall. It is painted before the roads, so those lie on
 * top of it. Drawn in metres east and south of the town hall's south-west
 * corner.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Building} b The town hall.
 */
function paintSquare(g, b) {
  const r = rng(23);
  g.rotate(-Math.atan2(b.sa, b.ca)); // the photo is read north up
  g.fillStyle = textures.school;
  g.beginPath();
  for (const [x, y] of [
    [-6, 12.9],
    [-6, -2.1],
    [21, -2.1],
    [21, -21.6],
    [26.5, -21.6],
    [26.5, -3.8],
    [38.6, -3.8],
    [38.6, -6.5],
    [60, -6.5],
    [60, 12.9],
  ]) {
    g.lineTo(x, y);
  }
  g.fill();
  // The car park behind the town hall, bays along its back wall
  g.fillStyle = textures.park;
  g.fillRect(-5.5, -21.5, 26.5, 12.3);
  g.strokeStyle = 'rgba(236,236,226,.6)';
  g.lineWidth = 0.14;
  g.beginPath();
  for (let x = 3; x < 20; x += 2.7) {
    g.moveTo(x, -15);
    g.lineTo(x, -10.4);
  }
  g.stroke();
  g.fillStyle = textures.resi; // the tree at its entrance stands in a bed
  g.beginPath();
  g.arc(-0.7, -12.1, 1.6, 0, TAU);
  g.fill();
  // Steps to the door, and tubs of flowers left and right of it
  g.fillStyle = '#d9d2c0';
  g.fillRect(8.5, 0, 4, 1.8);
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.fillRect(8.5, 0.85, 4, 0.1);
  g.fillRect(8.5, 1.7, 4, 0.1);
  for (const [x, y] of [
    [4.2, 0.9],
    [6.3, 1.9],
    [14.3, 1.5],
  ]) {
    g.fillStyle = '#6b4a2a';
    g.fillRect(x - 0.5, y - 0.5, 1, 1);
    g.fillStyle = '#3c7a30';
    g.fillRect(x - 0.35, y - 0.35, 0.7, 0.7);
    g.fillStyle = pick2(['#d83a3a', '#f2d23e', '#c85aa8'], r);
    g.fillRect(x - 0.15, y - 0.15, 0.3, 0.3);
  }
  g.fillStyle = '#c8201c'; // the old phone box, full of books now
  g.fillRect(19.9, 0.6, 1, 1);
  g.fillStyle = '#f2d23e';
  g.fillRect(20.1, 0.8, 0.6, 0.6);
  // The raised bed in front of the Schwarzer Adler: a stone rim, shrubs
  g.fillStyle = '#b9b4a6';
  g.fillRect(26.8, -3.5, 10.4, 4);
  g.fillStyle = textures.resi;
  g.fillRect(27.2, -3.1, 9.6, 3.2);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = pick2(['#2a5a22', '#356a27', '#2f6a2a'], r);
    g.beginPath();
    g.arc(28 + i * 1.02 + r() * 0.4, -2.3 + r() * 1.7, 0.6 + r() * 0.3, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#2f6a2a'; // and the round bush next to it
  g.beginPath();
  g.arc(39.2, -2.5, 1.3, 0, TAU);
  g.fill();
  g.fillStyle = '#3c7a30';
  g.beginPath();
  g.arc(38.9, -2.8, 0.7, 0, TAU);
  g.fill();
  // The fountain and two benches: these were in the game before, the photo
  // does not show them.
  g.fillStyle = '#8f897d';
  g.beginPath();
  g.arc(44, -1.6, 2.3, 0, TAU);
  g.fill();
  g.fillStyle = '#4a8fc4';
  g.beginPath();
  g.arc(44, -1.6, 1.7, 0, TAU);
  g.fill();
  g.fillStyle = '#d9e9f4';
  g.fillRect(43.75, -1.85, 0.5, 0.5);
  g.fillStyle = '#6b4a2a';
  g.fillRect(41.3, -5.2, 2.2, 0.6);
  g.fillRect(44.6, -5.2, 2.2, 0.6);
}

/**
 * The plot of Schulstraße 22, as the aerial photos show it: a paved path
 * along the west side, a patio with a parasol in front of the house, the
 * front lawn, the drive to the carport and the garage, vegetable beds and a
 * greenhouse east of the house, and at the back a terrace, a gravel yard,
 * raised beds and a lawn. Drawn with x east along the front of the house and
 * y towards the street in the south.
 * @param {!CanvasRenderingContext2D} g
 */
function paintSchul22(g) {
  const r = rng(22);
  const fill = (style, pts) => fillPoly(g, style, pts);
  // The whole plot is garden, mown in stripes in front of the house
  const plot = [-5.9, -24.2, 6.9, -25, 21.7, -24.6, 21.2, 13.8, -4.7, 14.4];
  fill(textures.resi, plot);
  g.save();
  g.beginPath();
  g.rect(-2, 3.4, 12.6, 10.3);
  g.clip();
  g.fillStyle = 'rgba(190,255,150,.09)';
  for (let x = -2; x < 11; x += 2.2) {
    g.fillRect(x, 3.4, 1.1, 10.3);
  }
  g.restore();
  // Paving: the path along the west side, the patio, the drive and the floor
  // of the carport, the terrace behind the house
  fill(textures.school, [-4.5, -3, -2, -3, -2, 13.9, -4.6, 13.9]);
  fill(textures.school, [-2, 0, 7, 0, 7, 3.4, -2, 3.4]);
  fill(textures.school, [10.5, 0, 21.3, 0, 21.2, 13.8, 10.4, 13.6]);
  fill(textures.school, [0, -14.2, 16, -14.2, 16, -11.5, 0, -11.5]);
  fill(textures.gravel, [0.9, -19.2, 9.4, -19.2, 9.4, -14.2, 0.9, -14.2]);
  // A flower bed along the hedge to the street
  for (let i = 0; i < 70; i++) {
    g.fillStyle = pick2(['#d83a3a', '#f2d23e', '#f4f4ef', '#c85aa8'], r);
    g.fillRect(-1.6 + r() * 11.6, 12.4 + r() * 0.8, 0.3, 0.3);
  }
  // The patio: a round table under a parasol
  g.fillStyle = 'rgba(0,0,0,.22)';
  g.beginPath();
  g.arc(-0.4, 3.1, 1.5, 0, TAU);
  g.fill();
  g.fillStyle = '#f2efe6';
  g.beginPath();
  g.arc(-0.8, 2.7, 1.5, 0, TAU);
  g.fill();
  g.strokeStyle = '#c9c2b0';
  g.lineWidth = 0.08;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    g.moveTo(-0.8, 2.7);
    g.lineTo(
      -0.8 + Math.cos((i * TAU) / 8) * 1.5,
      2.7 + Math.sin((i * TAU) / 8) * 1.5
    );
  }
  g.stroke();
  // Vegetable beds in rows east of the house
  g.fillStyle = '#4a3a2a';
  g.fillRect(17.4, -10, 3.8, 9.4);
  g.fillStyle = '#3c7a30';
  for (let y = -9.6; y < -0.8; y += 1) {
    g.fillRect(17.7, y, 3.2, 0.45);
  }
  // The greenhouse: panes of glass in a white frame
  g.fillStyle = 'rgba(0,0,0,.2)';
  g.fillRect(16.7, -16.5, 5, 5.2);
  g.fillStyle = '#cfe2ea';
  g.fillRect(16.3, -16.9, 5, 5.2);
  g.strokeStyle = '#f4f4ef';
  g.lineWidth = 0.12;
  g.beginPath();
  for (let x = 16.3; x <= 21.4; x += 1) {
    g.moveTo(x, -16.9);
    g.lineTo(x, -11.7);
  }
  g.moveTo(16.3, -14.3);
  g.lineTo(21.3, -14.3);
  g.rect(16.3, -16.9, 5, 5.2);
  g.stroke();
  // Raised beds of wood at the back
  for (let i = 0; i < 3; i++) {
    g.fillStyle = '#8a5a2a';
    g.fillRect(-5.6 + i * 1.9, -22.1, 1.5, 4.2);
    g.fillStyle = '#3c7a30';
    g.fillRect(-5.45 + i * 1.9, -21.95, 1.2, 3.9);
  }
}

/**
 * Fills a polygon given as x, y, x, y and so on.
 * @param {!CanvasRenderingContext2D} g
 * @param {string|!CanvasPattern} style
 * @param {!Array<number>} pts
 */
function fillPoly(g, style, pts) {
  g.fillStyle = style;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    g.lineTo(pts[i], pts[i + 1]);
  }
  g.fill();
}

/**
 * The plot of Edeka Claudia, as the aerial photos show it: the forecourt to
 * the street with three parking bays, the shelter for the trolleys and crates
 * of vegetables at the door, bike stands and a strip of grass on the east
 * side, the sign by the road, and an overgrown garden at the back. Drawn with
 * x east along the front of the shop and y towards the street.
 * @param {!CanvasRenderingContext2D} g
 */
function paintShop(g) {
  fillPoly(g, textures.resi, [-3.2, -21.4, 22.6, -21.3, 25.1, 5, -2.3, 4.7]);
  fillPoly(
    g,
    textures.concrete,
    [-2.3, 4.7, 25.1, 5, 24.6, -1.8, 15, -9, 15, 0]
  );
  fillPoly(g, textures.concrete, [-2.5, -12.5, 0, -13.6, 0, 0, -2.3, 4.7]);
  // Three bays east of the door, nose to the shop, tarmac with white lines
  fillPoly(g, textures.park, [15.2, 5, 24.6, 5, 24.6, -0.3, 15.2, -0.3]);
  g.strokeStyle = 'rgba(236,236,226,.8)';
  g.lineWidth = 0.14;
  g.beginPath();
  for (let x = 15.6; x <= 24.2; x += 2.85) {
    g.moveTo(x, 4.8);
    g.lineTo(x, -0.2);
  }
  g.stroke();
  // The trolley shelter and the crates of vegetables by the door
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(0.9, 0.7, 3.8, 1.5);
  g.fillStyle = '#2b62c8';
  g.fillRect(0.6, 0.4, 3.8, 1.5);
  g.fillStyle = '#c9cdd3';
  for (let i = 0; i < 6; i++) {
    g.fillRect(0.85 + i * 0.6, 0.65, 0.4, 1);
  }
  ['#d83a3a', '#f2a01c', '#4c9a34', '#f2d23e', '#d83a3a'].forEach((crop, i) => {
    g.fillStyle = '#6b4a2a';
    g.fillRect(5.4 + i * 1.2, 0.3, 1, 1);
    g.fillStyle = crop;
    g.fillRect(5.55 + i * 1.2, 0.45, 0.7, 0.7);
  });
  // Bike stands on the east side
  g.strokeStyle = '#3b3e44';
  g.lineWidth = 0.12;
  g.beginPath();
  for (let x = 16.2; x < 23; x += 1.1) {
    g.moveTo(x, -3);
    g.lineTo(x, -4.6);
  }
  g.stroke();
  // The sign by the road, yellow with the blue letters
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.fillRect(-1.5, 3.9, 2.4, 0.6);
  g.fillStyle = '#f2d23e';
  g.fillRect(-1.8, 3.5, 2.4, 0.6);
  g.fillStyle = '#1f4fa8';
  g.fillRect(-1.6, 3.65, 2, 0.3);
}

/**
 * Undoes the frame of a modelled building in its ground painter, so that it
 * can paint on the map in x and y.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Building} b
 */
function onMap(g, b) {
  g.translate(-b.at[0], -b.at[1]);
  g.transform(b.ca, -b.sa, b.sa, b.ca, 0, 0);
  g.translate(-b.mx, -b.my);
}

/**
 * A box on the ground, turned by a: tents, trailers, beer tables.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x The middle.
 * @param {number} y
 * @param {number} w Across.
 * @param {number} h Along.
 * @param {number} a
 * @param {string} col
 */
export function box(g, x, y, w, h, a, col) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = col;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.restore();
}

/**
 * The beer garden of the Schwallclub, as the aerial photos show it: the
 * white marquee by Hauptstraße with a dark container behind it, eight beer
 * tables in two rows, and two white trailers by the house. Drawn on the map.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Building} b
 */
function paintClub(g, b) {
  onMap(g, b);
  const turn = 0.35; // the tables and trailers stand square to the house
  fillPoly(
    g,
    '#2a2c30',
    [1265, 891.1, 1272.5, 892.5, 1271.8, 895.1, 1264.6, 893.9]
  );
  const tent = [1263.6, 894.3, 1270.4, 895.4, 1268.6, 902.9, 1260.7, 900.4];
  fillPoly(
    g,
    'rgba(0,0,0,.22)',
    tent.map(v => v + 0.6)
  );
  fillPoly(g, '#f4f4ef', tent);
  g.strokeStyle = '#c9c6bc';
  g.lineWidth = 0.1;
  g.beginPath();
  for (let k = 0.25; k < 1; k += 0.25) {
    // the seams of the canvas, across the tent
    g.moveTo(1263.6 + (1260.7 - 1263.6) * k, 894.3 + (900.4 - 894.3) * k);
    g.lineTo(1270.4 + (1268.6 - 1270.4) * k, 895.4 + (902.9 - 895.4) * k);
  }
  g.stroke();
  for (const [x, y] of [
    [1256.4, 900.7],
    [1258.7, 901.2],
    [1261.1, 901.8],
    [1263.2, 902.3],
    [1257.1, 903.2],
    [1259.3, 903.8],
    [1261.6, 904.3],
    [1263.9, 904.9],
  ]) {
    box(g, x, y, 0.75, 2.2, turn, '#8a5a2a'); // the table
    box(
      g,
      x - 0.55 * Math.cos(turn),
      y - 0.55 * Math.sin(turn),
      0.25,
      2.2,
      turn,
      '#6b4a2a'
    );
    box(
      g,
      x + 0.55 * Math.cos(turn),
      y + 0.55 * Math.sin(turn),
      0.25,
      2.2,
      turn,
      '#6b4a2a'
    );
  }
  for (const [x, y, w, h] of [
    [1264.3, 908.4, 2.4, 6.4],
    [1267.1, 909.6, 2.2, 5],
  ]) {
    box(g, x + 0.5, y + 0.5, w, h, turn, 'rgba(0,0,0,.25)');
    box(g, x, y, w, h, turn, '#b9bcbf');
    box(g, x, y, w - 0.3, h - 0.3, turn, '#eeeee8');
  }
}

/**
 * The forecourt of Metzgerei Braun on a Fässlafreitag, as the aerial photos
 * show it: a row of white parasols over the beer tables along the hedge.
 * Drawn on the map.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Building} b
 */
function paintButcher(g, b) {
  onMap(g, b);
  for (let i = 0; i < 6; i++) {
    const x = 1334 - i * 0.85;
    const y = 759.5 + i * 2.4;
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath();
    g.arc(x + 0.5, y + 0.5, 1.2, 0, TAU);
    g.fill();
    g.fillStyle = '#f4f4ef';
    g.beginPath();
    g.arc(x, y, 1.2, 0, TAU);
    g.fill();
    g.strokeStyle = '#c9c6bc';
    g.lineWidth = 0.08;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      g.moveTo(x, y);
      g.lineTo(
        x + Math.cos((k * TAU) / 6) * 1.2,
        y + Math.sin((k * TAU) / 6) * 1.2
      );
    }
    g.stroke();
  }
}

/**
 * A patch of sand, an ellipse turned by a.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} rx
 * @param {number} ry
 * @param {number} a
 */
function sand(g, x, y, rx, ry, a) {
  g.fillStyle = '#c9b27a';
  g.beginPath();
  g.ellipse(x, y, rx + 0.3, ry + 0.3, a, 0, TAU);
  g.fill();
  g.fillStyle = '#e0cc94';
  g.beginPath();
  g.ellipse(x, y, rx, ry, a, 0, TAU);
  g.fill();
}

/**
 * A wooden climbing tower with its slide running off along a.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} a
 * @param {string} slide
 */
function tower(g, x, y, a, slide) {
  box(
    g,
    x + 1.6 * Math.cos(a) + 0.3,
    y + 1.6 * Math.sin(a) + 0.3,
    3.4,
    0.8,
    a,
    'rgba(0,0,0,.2)'
  );
  box(g, x + 1.9 * Math.cos(a), y + 1.9 * Math.sin(a), 3.4, 0.8, a, slide);
  box(g, x + 0.4, y + 0.4, 2.4, 2.4, a, 'rgba(0,0,0,.25)');
  box(g, x, y, 2.4, 2.4, a, '#7a5634');
  box(g, x, y, 1.8, 1.8, a, '#a8784a');
  box(g, x, y, 0.5, 1.8, a + Math.PI / 2, '#d83a3a'); // the roof's ridge
}

/**
 * A swing frame: the beam along a on its legs, and two seats.
 * @param {!CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} a
 */
function swings(g, x, y, a) {
  box(g, x, y, 5, 0.3, a, '#6b4a2a');
  for (const end of [-2.4, 2.4]) {
    box(
      g,
      x + end * Math.cos(a),
      y + end * Math.sin(a),
      0.25,
      1.8,
      a,
      '#6b4a2a'
    );
  }
  for (const seat of [-1, 1]) {
    box(
      g,
      x + seat * Math.cos(a),
      y + seat * Math.sin(a),
      0.7,
      0.3,
      a,
      '#2b2f36'
    );
  }
}

/**
 * The playground, as the aerial photos show it: the sand pit with the play
 * ship, the gravel square with the climbing tower, the swings, a carousel,
 * the round seating place with its table, and benches along the fence.
 * Drawn on the map.
 * @param {!CanvasRenderingContext2D} g
 */
export function paintPlayground(g) {
  sand(g, 1134.4, 750.9, 4.4, 4.6, 0.35);
  // the ship in the sand, bow to the west
  fillPoly(
    g,
    '#7a5634',
    [1130.6, 752.2, 1132.6, 749.4, 1137.6, 748.6, 1137.9, 751.8, 1133.1, 753.3]
  );
  fillPoly(
    g,
    '#a8784a',
    [1131.6, 751.9, 1133, 749.9, 1137, 749.3, 1137.2, 751.3, 1133.3, 752.6]
  );
  g.fillStyle = '#5a3a1e';
  g.beginPath();
  g.arc(1134.8, 751, 0.3, 0, TAU);
  g.fill();
  box(g, 1137.3, 739, 5.4, 9.6, 0.2, '#b9b19c');
  tower(g, 1137.1, 736.6, Math.PI / 2 + 0.2, '#2b62c8');
  box(g, 1153, 743.9, 6, 3, 1.03, '#c9b27a');
  swings(g, 1153, 743.9, 1.03);
  sand(g, 1160, 750.5, 2.2, 2.2, 0);
  for (let k = 0; k < 4; k++) {
    // the carousel, red and yellow
    g.fillStyle = k % 2 ? '#e8c21c' : '#d83a3a';
    g.beginPath();
    g.moveTo(1160, 750.5);
    g.arc(1160, 750.5, 1.5, (k * TAU) / 4, ((k + 1) * TAU) / 4);
    g.fill();
  }
  g.fillStyle = '#9a9da3';
  g.beginPath();
  g.ellipse(1152.5, 767, 4.4, 6, 0.4, 0, TAU);
  g.fill();
  box(g, 1152.5, 767, 0.8, 2.2, 0.4, '#8a5a2a');
  for (const side of [-0.65, 0.65]) {
    box(
      g,
      1152.5 + side * Math.cos(0.4),
      767 + side * Math.sin(0.4),
      0.3,
      2.2,
      0.4,
      '#6b4a2a'
    );
  }
  for (const [x, y] of [
    [1131.7, 723.8],
    [1143.3, 728.8],
    [1155, 733.8],
  ]) {
    box(g, x, y, 1.8, 0.5, 0.43, '#8a5a2a');
  }
}

/**
 * The yard of Kita Villa Kunterbunt, as the aerial photos show it: sand
 * under the trees, a sandbox, and a wooden play tower with a slide. Drawn on
 * the map.
 * @param {!CanvasRenderingContext2D} g
 */
export function paintKita(g) {
  sand(g, 1436, 775.5, 11, 6, 0.05);
  sand(g, 1448.5, 772, 6, 5, 0);
  box(g, 1427, 778, 3.8, 3.3, 0.05, '#8a5a2a');
  box(g, 1427, 778, 3.2, 2.7, 0.05, '#e0cc94');
  tower(g, 1418.6, 787, 0, '#d83a3a');
}

/**
 * The Christmas tree plantation on the Weißer Berg, as the aerial photo shows
 * it: rows of young spruces in three blocks, with grass lanes between them.
 * Drawn on the map.
 * @param {!CanvasRenderingContext2D} g
 */
export function paintXmasFarm(g) {
  const edge = [1240.8, 127.8, 1247.8, 97.9, 1257.2, 62.6, 1266.7, 27.7]
    .concat([1285.8, 27.2, 1307.7, 35, 1327, 55.2, 1335.8, 67.2, 1341.9, 80.8])
    .concat([1342.5, 96.4, 1337.6, 133.7, 1336.9, 155.8, 1333.1, 155.3]);
  fillPoly(g, '#9a8a5a', edge);
  g.save();
  g.clip();
  const r = rng(1224);
  // the lanes: from x 1255 to 1336, at these heights and slopes
  const lane = (x, y) =>
    Math.abs(y - (60 + (x - 1270) * 0.1)) < 2.2 ||
    Math.abs(y - (94 + (x - 1257) * 0.095)) < 2.4;
  for (let y = 28; y < 156; y += 1.8) {
    for (let x = 1241; x < 1343; x += 1.8) {
      const tx = x + (r() - 0.5) * 0.4;
      const ty = y + (x - 1240) * 0.08 + (r() - 0.5) * 0.4;
      if (lane(tx, ty) || r() < 0.08) {
        continue; // a gap where one was sold
      }
      g.fillStyle = pick2(['#1f4a26', '#24572c', '#2c6232'], r);
      g.beginPath();
      g.arc(tx, ty, 0.5 + r() * 0.35, 0, TAU);
      g.fill();
    }
  }
  g.restore();
}

/**
 * The plot of Pizzeria La Vite, as the aerial photos show it: the terrace
 * with tables and parasols to the street, the paved forecourt where the
 * guests park, the white awning on the garden side, a gravel path along the
 * north-west side, and the garden. Drawn with x along the front of the main
 * block and y towards the street.
 * @param {!CanvasRenderingContext2D} g
 */
function paintLavite(g) {
  const r = rng(5);
  fillPoly(g, textures.resi, [-10.6, 12.3, -9.3, -13, 17.6, -12.8, 18.4, 11.7]);
  fillPoly(g, textures.gravel, [-10.3, 6.8, -9.4, -7.7, -5.4, -7.4, -6, 7]);
  for (let i = 0; i < 14; i++) {
    // shrubs along the path
    g.fillStyle = pick2(['#2a5a22', '#356a27', '#3c7a30'], r);
    g.beginPath();
    g.arc(-9.6 + r() * 0.8, 6 - i * 0.95, 0.5 + r() * 0.3, 0, TAU);
    g.fill();
  }
  fillPoly(
    g,
    textures.school,
    [1.4, 11.1, 5.2, 6, 8.7, 3.6, 13.2, 0, 19.5, 0.1, 18.4, 11.7, 3.4, 11.6]
  );
  // The terrace: boards, three tables, each under a parasol
  fillPoly(g, '#9a7a52', [-2.9, 11, -2.9, 5.2, 3.1, 5.4, 2.9, 11.1]);
  g.strokeStyle = 'rgba(60,40,20,.35)';
  g.lineWidth = 0.06;
  g.beginPath();
  for (let x = -2.6; x < 3; x += 0.5) {
    g.moveTo(x, 5.3);
    g.lineTo(x, 11);
  }
  g.stroke();
  for (const [x, y, col] of [
    [-1.2, 7, '#c8201c'],
    [1.6, 7.4, '#f4f4ef'],
    [0.2, 9.8, '#2f7a2c'],
  ]) {
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath();
    g.arc(x + 0.4, y + 0.4, 1.2, 0, TAU);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, 1.2, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)';
    g.lineWidth = 0.06;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      g.moveTo(x, y);
      g.lineTo(
        x + Math.cos((i * TAU) / 6) * 1.2,
        y + Math.sin((i * TAU) / 6) * 1.2
      );
    }
    g.stroke();
  }
  // The white awning on the garden side
  fillPoly(
    g,
    'rgba(0,0,0,.22)',
    [13.5, -4.4, 17.5, -5.3, 18, -2.8, 14.2, -1.8]
  );
  fillPoly(g, '#f4f2ea', [13, -4.9, 17, -5.8, 17.5, -3.3, 13.7, -2.3]);
  g.strokeStyle = '#c9c2b0';
  g.lineWidth = 0.08;
  g.beginPath();
  g.moveTo(13.35, -3.6);
  g.lineTo(17.25, -4.55);
  g.stroke();
}

/**
 * The yard of Bernhard's garage, as the aerial photos show it: the tarmac
 * drive that comes down from the fork of the street between the stone
 * garden and the hedge, where the customers' cars wait, and the forecourt
 * between the hall and the road. Drawn with x along the south-east wall of
 * the hall and y towards the road.
 * @param {!CanvasRenderingContext2D} g
 */
function paintGarage(g) {
  fillPoly(
    g,
    textures.park,
    [38.7, -15.5, 45.8, -10.5, 41, -6.9, 39, -7.1, 33.6, -6.3, 28.1, -4.8]
      .concat([22, -4.2, 16.1, -1.6, 11.2, 2.1, 13.5, 4.7, 13.2, 7.8])
      .concat([-1.2, 5.9, 0, 0, 12, -11, 15.4, -11.6, 18.7, -9.4, 21.9, -9.6])
      .concat([27, -10, 32.7, -11, 37.6, -12.5])
  );
}

/**
 * The plot of Flo's house: the paved drive runs from the wing down to the
 * street, and a terrace lies along the front of the main block.
 * @param {!CanvasRenderingContext2D} g
 */
function paintHome(g) {
  g.fillStyle = textures.school;
  g.fillRect(10.6, -1.94, 8.4, 18);
  g.fillRect(0.6, 0, 10, 2.6);
}

/**
 * Paints the plot of a modelled building as the aerial photos show it: the
 * buildings whose entry in ROOFS says yard.
 * @param {!CanvasRenderingContext2D} g
 * @param {!Building} b
 * @return {boolean} Whether there is a painter for this building.
 */
export function paintYard(g, b) {
  switch (b.poi) {
    case 'hq':
      paintHome(g);
      break;
    case 'townhall':
      paintSquare(g, b);
      break;
    case 'schul22':
      paintSchul22(g);
      break;
    case 'shop':
      paintShop(g);
      break;
    case 'club':
      paintClub(g, b);
      break;
    case 'butcher':
      paintButcher(g, b);
      break;
    case 'lavite':
      paintLavite(g);
      break;
    case 'garage':
      paintGarage(g);
      break;
    case 'no14':
      paintGarden(g);
      break;
    default:
      return false;
  }
  return true;
}

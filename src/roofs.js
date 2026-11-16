/**
 * @fileoverview Roofs: the buildings that are modelled face by face, the roofs
 * the survey measured, and a ridge with two slopes for all the others.
 */

import {textures} from './textures.js';
import {clamp, shade} from './util.js';
import {
  paintButcher,
  paintClub,
  paintGarage,
  paintGarden,
  paintLavite,
  paintSchul22,
  paintShop,
  paintSquare,
} from './yards.js';

export const LIGHT = [0.6, 0.8]; // faces turned south-east lie in shadow

// Three buildings are modelled after the real ones, face by face, from the
// survey's roof faces and the aerial photos. In metres: u runs east along the
// front from the south-west corner of the building, v north from it, z up
// from the ground.
//
// Flo's house, Johann-Philipp-Ring 9: a main block and a lower wing to the
// east. Both have a cross gable to the street and one to the garden; the
// garden one of the main block stands on a bay.
//
// The roof slopes as corners u, v, z, and the solar panels that lie on them
// as [u0, v0, u1, v1].
export const HOME_SLOPES = [
  // main block, to the street and to the garden, cut out for the cross gables
  [
    [
      0, 0, 5.1, 2.15, 0, 5.1, 5.45, 4.35, 10, 8.75, 0, 5.1, 10.92, 0, 5.1,
    ].concat([10.92, 4.97, 10.7, 0, 4.97, 10.7]),
    [0.3, 2.2, 3.3, 4.4],
    [0.3, 0.5, 2.3, 2.2],
    [7, 3.3, 10.6, 4.5],
    [9, 0.4, 10.6, 3.3],
  ],
  [
    [0, 4.97, 10.7, 10.92, 4.97, 10.7, 10.92, 9.93, 5.1, 8, 9.93, 5.1]
      .concat([8, 7.89, 7.4, 5.45, 5.32, 10.3, 2.9, 7.89, 7.4])
      .concat([2.9, 9.93, 5.1, 0, 9.93, 5.1]),
  ],
  // wing
  [
    [
      10.92, 1.94, 5.1, 13.25, 1.94, 5.1, 15.4, 4.75, 8.25, 17.55, 1.94, 5.1,
    ].concat([19.35, 1.94, 5.1, 19.35, 5.95, 9.6, 10.92, 5.95, 9.6]),
    [16.7, 3.9, 19, 5.4],
    [17.9, 2.3, 19, 3.9],
  ],
  [
    [10.92, 5.95, 9.6, 19.35, 5.95, 9.6, 19.35, 9.95, 5.1, 17.2, 9.95, 5.1]
      .concat([17.2, 8.26, 7, 15.3, 6.31, 9.2, 13.4, 8.26, 7])
      .concat([13.4, 9.95, 5.1, 10.92, 9.95, 5.1]),
  ],
  // cross gable of the main block to the street
  [[5.45, 4.35, 10, 5.45, 0, 10, 2.15, 0, 5.1]],
  [[5.45, 4.35, 10, 8.75, 0, 5.1, 5.45, 0, 10]],
  // and to the garden, on the bay
  [[5.45, 5.32, 10.3, 2.9, 7.89, 7.4, 2.9, 11.35, 7.4, 5.45, 11.35, 10.3]],
  [[5.45, 5.32, 10.3, 5.45, 11.35, 10.3, 8, 11.35, 7.4, 8, 7.89, 7.4]],
  // cross gables of the wing
  [[15.4, 4.75, 8.25, 15.4, 1.94, 8.25, 13.25, 1.94, 5.1]],
  [[15.4, 4.75, 8.25, 17.55, 1.94, 5.1, 15.4, 1.94, 8.25]],
  [[15.3, 6.31, 9.2, 13.4, 8.26, 7, 13.4, 9.95, 7, 15.3, 9.95, 9.2]],
  [[15.3, 6.31, 9.2, 15.3, 9.95, 9.2, 17.2, 9.95, 7, 17.2, 8.26, 7]],
];
// The walls above the eaves: where they look, [du, dv], and their corners.
export const HOME_GABLES = [
  [-1, 0, [0, 9.93, 5.1, 0, 0, 5.1, 0, 4.97, 10.7]],
  [1, 0, [10.92, 0, 5.1, 10.92, 9.93, 5.1, 10.92, 4.97, 10.7]],
  [1, 0, [19.35, 1.94, 5.1, 19.35, 9.95, 5.1, 19.35, 5.95, 9.6]],
  [0, -1, [2.15, 0, 5.1, 8.75, 0, 5.1, 5.45, 0, 10]],
  [0, -1, [13.25, 1.94, 5.1, 17.55, 1.94, 5.1, 15.4, 1.94, 8.25]],
  [
    0,
    1,
    [8, 11.35, 5.1, 2.9, 11.35, 5.1, 2.9, 11.35, 7.4, 5.45, 11.35, 10.3].concat(
      [8, 11.35, 7.4]
    ),
  ],
  [-1, 0, [2.9, 7.89, 7.4, 2.9, 9.93, 5.1, 2.9, 11.35, 5.1, 2.9, 11.35, 7.4]],
  [1, 0, [8, 7.89, 7.4, 8, 11.35, 7.4, 8, 11.35, 5.1, 8, 9.93, 5.1]],
  [
    0,
    1,
    [17.2, 9.95, 5.1, 13.4, 9.95, 5.1, 13.4, 9.95, 7, 15.3, 9.95, 9.2].concat([
      17.2, 9.95, 7,
    ]),
  ],
  [-1, 0, [13.4, 8.26, 7, 13.4, 9.95, 5.1, 13.4, 9.95, 7]],
  [1, 0, [17.2, 8.26, 7, 17.2, 9.95, 7, 17.2, 9.95, 5.1]],
];

// The town hall, Hauptstraße 23, has a mansard roof: steep from the eaves up,
// then a hipped roof on top.
const HALL_SLOPES = [
  [[0, 0, 7, 21.5, 0, 7, 20.3, 1.2, 10.3, 1.2, 1.2, 10.3]],
  [[21.5, 0, 7, 21.5, 9.3, 7, 20.3, 8.1, 10.3, 20.3, 1.2, 10.3]],
  [[21.5, 9.3, 7, 0, 9.3, 7, 1.2, 8.1, 10.3, 20.3, 8.1, 10.3]],
  [[0, 9.3, 7, 0, 0, 7, 1.2, 1.2, 10.3, 1.2, 8.1, 10.3]],
  [[1.2, 1.2, 10.3, 20.3, 1.2, 10.3, 16.9, 4.65, 13.1, 4.6, 4.65, 13.1]],
  [[20.3, 8.1, 10.3, 1.2, 8.1, 10.3, 4.6, 4.65, 13.1, 16.9, 4.65, 13.1]],
  [[1.2, 8.1, 10.3, 1.2, 1.2, 10.3, 4.6, 4.65, 13.1]],
  [[20.3, 1.2, 10.3, 20.3, 8.1, 10.3, 16.9, 4.65, 13.1]],
];

// What the three have: eaves and ridge height, roof slopes, walls above the
// eaves, where the name goes on the roof [u, v, height of the letters], where
// the car stands [u, v], and for the garden trees [u, v, size, height], fences
// and hedges as lines u, v, u, v and so on, what is painted on the ground, and
// the plot as corners u, v: the fences diced along the parcel borders inside
// it go.
export const ROOFS = {
  hq: {
    eaves: 5.1,
    ridge: 10.7,
    slopes: HOME_SLOPES,
    gables: HOME_GABLES,
    sign: [10.7, 7.5, 2.4], // on the garden side, where the roof is plain
    park: [15.3, -2.6], // in front of the wing, as on the aerial photo
    ground(g) {
      // The paved drive runs from the wing down to the street, and a
      // terrace lies along the front of the main block.
      g.fillStyle = textures.school;
      g.fillRect(10.6, -1.94, 8.4, 18);
      g.fillRect(0.6, 0, 10, 2.6);
    },
  },
  townhall: {
    eaves: 7,
    ridge: 13.1,
    slopes: HALL_SLOPES,
    gables: [],
    sign: [10.75, 2.9, 2],
    trees: [[-0.2, 12.1, 1.6, 5]], // at the entrance of the car park
    plot: [-7.4, -8.6, 60.6, -11.4, 61.9, 19.5, -6.1, 22.4],
    ground: paintSquare,
  },
  // Schulstraße 22: a gable roof along the street with solar panels to the
  // south and roof windows to the north, the carport and the garage in front
  // of it, the garden all around.
  schul22: {
    eaves: 5.3,
    ridge: 8.7,
    slopes: [
      [
        [0, 0, 5.3, 15, 0, 5.3, 15, 5.75, 8.7, 0, 5.75, 8.7],
        [0.5, 3, 4, 5.2],
        [5.6, 0.6, 13.6, 4.9],
      ],
      [
        [0, 5.75, 8.7, 15, 5.75, 8.7, 15, 11.5, 5.3, 0, 11.5, 5.3],
        [7.4, 7.2, 8.4, 8.4, true],
        [10.6, 7.2, 11.6, 8.4, true],
      ],
    ],
    gables: [
      [-1, 0, [0, 0, 5.3, 0, 11.5, 5.3, 0, 5.75, 8.7]],
      [1, 0, [15, 11.5, 5.3, 15, 0, 5.3, 15, 5.75, 8.7]],
    ],
    chimney: [9.6, 6.6],
    trees: [
      [1.1, -6.6, 2.2, 6.5],
      [7.1, -6.8, 2.5, 7.5],
      [6.7, 22.4, 1.8, 7],
    ],
    hedges: [
      [-1.8, -13.75, 10.3, -13.85],
      [-5.6, 23.9, 6.8, 24.7],
      [-5.6, 23.9, -5.1, 14],
    ],
    fences: [[-4.65, -13.9, -4.45, 3]],
    cars: [[18.3, -11.4, 0, '#2b2f36']],
    plot: [-5.9, 24.2, 6.9, 25, 21.7, 24.6, 21.2, -13.8, -4.7, -14.4],
    ground: paintSchul22,
  },
  // Edeka Claudia keeps the gable roof of the survey; the plot is painted.
  shop: {
    trees: [
      [3.5, 17, 2.2, 7],
      [8.5, 18.6, 2.6, 8.5],
      [13.6, 18.4, 2, 6.5],
      [18.6, 17.4, 2.3, 7.5],
    ],
    hedges: [[-3, 21.1, 22.4, 21]],
    cars: [[17, -1, 0, '#eeeee8', 'van']],
    plot: [-3.2, 21.4, 22.6, 21.3, 25.1, -5, -2.3, -4.7, -2.1, 2.4, -2.5, 12.5],
    ground: paintShop,
  },
  // The Schwallclub keeps the roof of the survey; its beer garden is painted.
  club: {ground: paintClub},
  // St. Gertrud: the row of four trees on the square in front of it.
  church: {
    trees: [
      [4.3, -5.8, 2.2, 7],
      [12, -5.3, 2.3, 7.5],
      [20.3, -4.7, 2.2, 7],
      [28.3, -4.1, 2, 6.5],
    ],
  },
  // Metzgerei Braun has its roof from the survey (see LOOKS in osm2map.py);
  // its forecourt is painted.
  butcher: {
    trees: [
      [17.5, 20.2, 2.3, 8],
      [24.1, 16, 2.5, 9],
      [28.2, 10, 2.2, 8],
      [26.6, 2.1, 2.4, 8.5],
      [23, -3.3, 2, 7],
    ],
    // in the drive next door, as on the photos
    cars: [
      [-11, 7.8, 0, '#2b2f36'],
      [-6.7, 8.8, 0, '#e8e6df'],
    ],
    ground: paintButcher,
  },
  // Pizzeria La Vite keeps the five parts of the survey; the plot is painted.
  lavite: {
    trees: [
      [16.3, 3.2, 1.6, 5],
      [15.2, 9.4, 1.9, 6],
    ],
    hedges: [[-9.2, 12.6, 17.4, 12.4]],
    cars: [
      [8.9, -8.6, 0, '#eeeee8', 'van'],
      [12.9, -8.4, 0, '#2b2f36'],
      [16.8, -8.1, 0, '#e8e6df'],
    ],
    plot: [-10.6, -12.3, -9.3, 13, 17.6, 12.8, 18.4, -11.7],
    ground: paintLavite,
  },
  // Bernhard's garage keeps the roof of the survey. Its drive is painted,
  // with the strip of hedge and trees beside it and the cars waiting there.
  garage: {
    trees: [
      [39.5, 5, 2.6, 8],
      [30.3, 1.9, 2, 6],
      [24.6, 0.7, 2.1, 6.5],
      [19.3, -0.6, 2.2, 7],
      [14.5, -1.7, 1.8, 5.5],
    ],
    hedges: [[40, 4.9, 34.3, 3.2, 28.3, 1.6, 22.8, 0.3, 17.4, -1.2]],
    cars: [
      [36.5, 6.9, 1.36, '#2b2f36'],
      [31.1, 6.1, 1.36, '#eeeee8', 'van'],
      [25.5, 4.2, 1.36, '#d9dcdf'],
      [18.7, 3.6, 1.36, '#eeeee8'],
    ],
    plot: [39.5, 16.9, 47.5, 9.3, 42.4, 1.5, 13.5, -8.2, -1.9, -5.8].concat([
      -0.8, 0.5, 15.6, 14.4, 19.2, 10.3, 33.9, 12.6,
    ]),
    ground: paintGarage,
  },
  // Johann-Philipp-Ring 14: a plain gable roof, the garage on its west side,
  // and the garden around it up to the pavement of the bend.
  no14: {
    eaves: 5.7,
    ridge: 8.7,
    slopes: [
      [[0, 0, 5.7, 10.2, 0, 5.7, 10.2, 4.27, 8.7, 0, 4.27, 8.7]],
      [[0, 8.55, 5.7, 0, 4.27, 8.7, 10.2, 4.27, 8.7, 10.2, 8.55, 5.7]],
    ],
    gables: [
      [1, 0, [10.2, 0, 5.7, 10.2, 8.55, 5.7, 10.2, 4.27, 8.7]],
      [-1, 0, [0, 8.55, 5.7, 0, 0, 5.7, 0, 4.27, 8.7]],
    ],
    trees: [
      [16.4, 3.6, 1.3, 4.5],
      [11.8, -8.5, 1.1, 4],
      [-4.6, -19.5, 1.2, 4.2],
    ],
    // The fence leaves a gate open at the path to the front door.
    fences: [
      [5.5, 11.4, 6.2, 11.4, 21.5, 8.2, 19.1, 3.2, -8, -24.5],
      [0.4, 11.4, 4.1, 11.4],
    ],
    hedges: [[-8.1, -24.2, -8.1, -2.7]],
    plot: [-9.5, -26.5, -9.5, 13, 7, 13, 23, 9.5, 20.5, 2.5, -6.5, -26.5],
    ground: paintGarden,
  },
};

/**
 * Turns the description of a roof into faces in the frame of its building:
 * slopes and gable walls, each as corners u, v and the share k of the way
 * from the eaves up to the ridge.
 * @param {!Building} b
 * @param {!Object} spec One of ROOFS.
 * @param {string} wall The colour of the walls.
 */
export function buildRoof(b, spec, wall) {
  b.at = southWest(b.lp);
  if (!spec.slopes) {
    return; // the roof the survey gives it is right
  }
  const [au, av] = b.at;
  // How much a face looking along (du, dv) of the building is turned away
  // from the sun
  const shadow = (du, dv) =>
    (du * b.ca - dv * b.sa) * LIGHT[0] + (du * b.sa + dv * b.ca) * LIGHT[1];
  const face = (q, extra) => {
    const p = [];
    let cu = 0;
    let cv = 0;
    for (let i = 0; i < q.length; i += 3) {
      p.push(au + q[i], av - q[i + 1]);
      p.push((q[i + 2] - spec.eaves) / (spec.ridge - spec.eaves));
      cu += (au + q[i]) / (q.length / 3);
      cv += (av - q[i + 1]) / (q.length / 3);
    }
    return {p, cu, cv, d: 0, wall: '', tint: '', pin: [0, 3, 6], ...extra};
  };
  b.planes = spec.gables.map(([du, dv, q]) =>
    face(q, {
      nu: du,
      nv: -dv,
      wall: shade(wall, 0.78 - 0.22 * shadow(du, -dv)),
    })
  );
  for (const [n, [q, ...panels]] of spec.slopes.entries()) {
    const f = face(q, {roof: spec.roofs && textures[spec.roofs[n]]});
    const p = f.p;
    // The three corners that span the face best fix its texture, and tell
    // which way it falls.
    let best = 0;
    for (let i = 3; i < p.length; i += 3) {
      for (let j = i + 3; j < p.length; j += 3) {
        const size = Math.abs(
          (p[i] - p[0]) * (p[j + 1] - p[1]) - (p[i + 1] - p[1]) * (p[j] - p[0])
        );
        if (size > best) {
          best = size;
          f.pin = [0, i, j];
        }
      }
    }
    const [, i, j] = f.pin;
    const e = [p[i] - p[0], p[i + 1] - p[1], p[i + 2] - p[2]];
    const g = [p[j] - p[0], p[j + 1] - p[1], p[j + 2] - p[2]];
    const up = Math.sign(e[0] * g[1] - e[1] * g[0]);
    const du = (e[1] * g[2] - e[2] * g[1]) * up;
    const dv = (e[2] * g[0] - e[0] * g[2]) * up;
    f.tint = roofTint(shadow(du, dv) / Math.hypot(du, dv));
    f.turned = Math.abs(du) > Math.abs(dv);
    f.pv = panels.map(([u0, v0, u1, v1, glass]) => [
      au + u0,
      av - v1,
      au + u1,
      av - v0,
      glass,
    ]);
    // Corners run clockwise, so a slope seen from below turns the other way.
    let turn = 0;
    for (let k = 0; k < p.length; k += 3) {
      const n = (k + 3) % p.length;
      turn += p[k] * p[n + 1] - p[n] * p[k + 1];
    }
    if (turn < 0) {
      f.p = [];
      for (let k = p.length - 3; k >= 0; k -= 3) {
        f.p.push(p[k], p[k + 1], p[k + 2]);
      }
      f.pin = f.pin.map(k => p.length - 3 - k);
    }
    b.planes.push(f);
  }
  b.halves = null;
  b.h = spec.eaves;
  b.rh = spec.ridge - spec.eaves;
  b.chimney = spec.chimney && [au + spec.chimney[0], av - spec.chimney[1]];
}

/**
 * Where u and v of a modelled roof start: the south-west corner of the
 * outline, in the building's frame.
 * @param {!Array<number>} lp
 * @return {!Array<number>}
 */
function southWest(lp) {
  let sw = 0;
  for (let i = 0; i < lp.length; i += 2) {
    sw = lp[i] - lp[i + 1] < lp[sw] - lp[sw + 1] ? i : sw;
  }
  return [lp[sw], lp[sw + 1]];
}

/**
 * A roof as the survey measured it, face by face, in the form ROOFS uses.
 * Where a face meets the outline above the eaves, a gable wall fills the gap
 * down to them.
 * @param {!Building} b One with faces f: corners x, y, z on the map, maybe
 *     a roof r of its own and panels w [x, y, along, across, window or
 *     colour], and maybe a chimney ch.
 * @return {!Object}
 */
export function surveyedRoof(b) {
  const [au, av] = southWest(b.lp);
  const frame = (x, y) => [
    (x - b.mx) * b.ca + (y - b.my) * b.sa - au,
    av - ((y - b.my) * b.ca - (x - b.mx) * b.sa),
  ];
  const zs = b.f.flatMap(f => f.p.filter((v, i) => i % 3 === 2));
  const eaves = Math.min(...zs);
  const outline = [];
  for (let i = 0; i < b.lp.length; i += 2) {
    outline.push(b.lp[i] - au, av - b.lp[i + 1]);
  }
  // How far a point lies from the outline edge that starts at corner i
  const off = (i, u, v) => {
    const j = (i + 2) % outline.length;
    const eu = outline[j] - outline[i];
    const ev = outline[j + 1] - outline[i + 1];
    const t = clamp(
      ((u - outline[i]) * eu + (v - outline[i + 1]) * ev) / (eu * eu + ev * ev),
      0,
      1
    );
    return Math.hypot(outline[i] + eu * t - u, outline[i + 1] + ev * t - v);
  };
  const gables = [];
  const slopes = b.f.map(f => {
    const q = [];
    for (let i = 0; i < f.p.length; i += 3) {
      q.push(...frame(f.p[i], f.p[i + 1]), f.p[i + 2]);
    }
    const n = q.length / 3;
    const cu = q.reduce((s, v, i) => (i % 3 ? s : s + v), 0) / n;
    const cv = q.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / n;
    for (let k = 0; k < q.length; k += 3) {
      const [u0, v0, z0] = q.slice(k, k + 3);
      const [u1, v1, z1] = q.slice(
        (k + 3) % q.length,
        ((k + 3) % q.length) + 3
      );
      const on = outline.some(
        (x, i) => i % 2 === 0 && off(i, u0, v0) < 0.4 && off(i, u1, v1) < 0.4
      );
      if (!on || Math.max(z0, z1) < eaves + 0.15) {
        continue;
      }
      // The wall looks away from the middle of the face.
      let du = v1 - v0;
      let dv = u0 - u1;
      if (du * ((u0 + u1) / 2 - cu) + dv * ((v0 + v1) / 2 - cv) < 0) {
        du = -du;
        dv = -dv;
      }
      const l = Math.hypot(du, dv);
      const wall = [u0, v0, z0, u1, v1, z1];
      if (z1 > eaves + 0.05) {
        wall.push(u1, v1, eaves);
      }
      if (z0 > eaves + 0.05) {
        wall.push(u0, v0, eaves);
      }
      gables.push([du / l, dv / l, wall]);
    }
    const panels = (f.w || []).map(([x, y, along, across, kind]) => {
      const [u, v] = frame(x, y);
      return [
        u - along / 2,
        v - across / 2,
        u + along / 2,
        v + across / 2,
        kind,
      ];
    });
    return [q, ...panels];
  });
  return {
    eaves,
    ridge: Math.max(...zs),
    slopes,
    gables,
    roofs: b.f.map(f => f.r),
    chimney: b.ch && frame(b.ch[0], b.ch[1]),
  };
}

/**
 * A point of a modelled building, given in its u and v, on the map.
 * @param {!Building} b
 * @param {number} u
 * @param {number} v
 * @return {!Array<number>} x and y.
 */
export function fromFrame(b, u, v) {
  const lu = b.at[0] + u;
  const lv = b.at[1] - v;
  return [b.mx + lu * b.ca - lv * b.sa, b.my + lu * b.sa + lv * b.ca];
}

/**
 * The veil over a roof face: dark where it is turned away from the sun.
 * @param {number} shadow How much the face is turned south-east, -1 to 1.
 * @return {string}
 */
function roofTint(shadow) {
  return shadow > 0
    ? `rgba(0,0,0,${(0.3 * shadow).toFixed(2)})`
    : `rgba(255,240,210,${(-0.18 * shadow).toFixed(2)})`;
}

/**
 * Splits a roof outline along its long axis into the two slopes of a gable.
 * A hip roof slopes at the ends too, so its ridge stops short of the walls.
 * @param {!Building} b
 * @param {number} rise How far the ridge stands above the eaves, in metres.
 * @param {boolean=} hip
 */
export function ridge(b, rise, hip = false) {
  const mid = (b.v0 + b.v1) / 2;
  const centre = (b.u0 + b.u1) / 2;
  const inset = hip ? Math.min((b.u1 - b.u0) * 0.3, (b.v1 - b.v0) / 2) : 0;
  // How much the end and the side of the building face the dark side
  const along = b.ca * LIGHT[0] + b.sa * LIGHT[1];
  const across = -b.sa * LIGHT[0] + b.ca * LIGHT[1];
  const lp = b.lp;
  const n = lp.length;
  b.halves = [[], []];
  b.gables = [];
  for (let i = 0, k = 0; i < n; i += 2, k++) {
    const j = (i + 2) % n;
    const da = lp[i + 1] - mid;
    const db = lp[j + 1] - mid;
    b.halves[da >= 0 ? 0 : 1].push(lp[i], lp[i + 1], 0);
    if (da >= 0 === db >= 0) {
      continue;
    }
    const t = da / (da - db);
    const x = lp[i] + (lp[j] - lp[i]) * t;
    const low = x < centre;
    const rx = x + (low ? inset : -inset);
    b.halves[0].push(rx, mid, 1);
    b.halves[1].push(rx, mid, 1);
    const tint = roofTint(low ? -along : along);
    b.gables.push([k, lp[i], lp[i + 1], rx, mid, lp[j], lp[j + 1], tint]);
  }
  b.rh = rise;
  b.hip = hip;
  b.tint = [roofTint(across), roofTint(-across)];
  const xs = b.gables.map(g => g[3]);
  b.rx0 = Math.min(...xs);
  b.rx1 = Math.max(...xs);
  b.ry = mid;
}

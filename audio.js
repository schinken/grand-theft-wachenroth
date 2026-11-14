// Everything you hear is synthesised here: effects, Flo's pager voice, engines and the car radio.

let AC;
let master;
let sfx;
let music;
let voiceBus;
let drive;
let noiseBuf;
let tap;
let eng;
let sirenGain;
let muted = false;
let station = -1;
let nextT = 0;
let stepI = 0;
let f0 = 118;
const midi = n => 440 * 2 ** ((n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 *
 */
export function init() {
  if (AC) {
    if (AC.state !== 'running') {
      AC.resume();
    }
    return;
  }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(AC.createDynamicsCompressor()).connect(AC.destination);
  tap = AC.createAnalyser(); // lets the self-test see that sound is coming out
  master.connect(tap);
  sfx = AC.createGain();
  sfx.connect(master);
  music = AC.createGain();
  music.gain.value = 0.3;
  music.connect(master);
  voiceBus = AC.createBiquadFilter(); // small pager speaker
  voiceBus.type = 'bandpass';
  voiceBus.frequency.value = 1100;
  voiceBus.Q.value = 0.8;
  const loud = AC.createGain();
  loud.gain.value = 2.5;
  voiceBus.connect(loud).connect(sfx);
  drive = AC.createWaveShaper(); // fuzz for the rock station
  drive.curve = Float32Array.from({length: 256}, (_, i) =>
    Math.tanh((i / 128 - 1) * 5)
  );
  const tone = AC.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  drive.connect(tone).connect(music);
  noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) {
    ch[i] = Math.random() * 2 - 1;
  }

  const o = AC.createOscillator();
  const o2 = AC.createOscillator();
  const lp = AC.createBiquadFilter();
  const g = AC.createGain();
  o.type = 'sawtooth';
  o2.type = 'square';
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  g.gain.value = 0;
  o.connect(lp);
  o2.connect(lp);
  lp.connect(g).connect(sfx);
  o.start();
  o2.start();
  eng = {o, o2, lp, g};

  const so = AC.createOscillator();
  const lfo = AC.createOscillator();
  const depth = AC.createGain();
  const slp = AC.createBiquadFilter();
  so.type = 'square';
  so.frequency.value = 510; // Martinshorn: two notes, a fourth apart
  lfo.type = 'square';
  lfo.frequency.value = 0.75;
  depth.gain.value = 75;
  lfo.connect(depth).connect(so.frequency);
  slp.type = 'lowpass';
  slp.frequency.value = 1800;
  sirenGain = AC.createGain();
  sirenGain.gain.value = 0;
  so.connect(slp).connect(sirenGain).connect(sfx);
  so.start();
  lfo.start();
  setInterval(tick, 70);
}

/**
 *
 * @param g
 * @param t
 * @param a
 * @param d
 * @param vol
 * @param hold
 */
function env(g, t, a, d, vol, hold = 0) {
  // attack, then hold for a share of the length, then die away
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + a + d * hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
/**
 *
 * @param type
 * @param f
 * @param t
 * @param dur
 * @param vol
 * @param out
 * @param to
 * @param a
 */
function osc(type, f, t, dur, vol, out, to = 0, a = 0.004) {
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) {
    o.frequency.exponentialRampToValueAtTime(to, t + a + dur);
  }
  env(g, t, a, dur, vol, 0.6);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + dur + 0.03);
}
/**
 *
 * @param t
 * @param dur
 * @param vol
 * @param type
 * @param freq
 * @param out
 * @param q
 */
function hiss(t, dur, vol, type, freq, out, q = 0.7) {
  const s = AC.createBufferSource();
  const f = AC.createBiquadFilter();
  const g = AC.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  env(g, t, 0.002, dur, vol);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

// ---------- effects

const beep = (f, d, wait = 0, vol = 0.06, type = 'square', to = 0) =>
  osc(type, f, AC.currentTime + wait, d, vol, sfx, to);
const crack = (d, vol, freq = 900, wait = 0) =>
  hiss(AC.currentTime + wait, d, vol, 'lowpass', freq, sfx);
const SFX = {
  coin: () => {
    beep(988, 0.07);
    beep(1319, 0.2, 0.08);
  },
  crash: imp =>
    crack(0.15 + imp / 60, Math.min(0.5, Math.max(0.08, imp / 35)), 1400),
  splat: () => {
    crack(0.12, 0.3, 700);
    beep(170, 0.16, 0, 0.12, 'sawtooth', 60);
  },
  scream: () => beep(rnd(700, 950), 0.28, 0, 0.05, 'sawtooth', rnd(380, 480)),
  pager: () => {
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 3; i++) {
        beep(2350, 0.07, k * 0.55 + i * 0.13, 0.07);
      }
    }
  },
  boom: () => {
    crack(1, 0.8, 500);
    beep(90, 0.6, 0, 0.3, 'sawtooth', 28);
  },
  win: () =>
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      beep(f, 0.22, i * 0.12, 0.07)
    ),
  fail: () => {
    beep(300, 0.5, 0, 0.1, 'sawtooth', 70);
    beep(220, 0.7, 0.25, 0.08, 'sawtooth', 50);
  },
  door: () => {
    beep(140, 0.07, 0, 0.1, 'square', 90);
    crack(0.05, 0.15, 600, 0.05);
  },
  horn: () => {
    beep(415, 0.32, 0, 0.08, 'sawtooth');
    beep(330, 0.32, 0, 0.08, 'sawtooth');
  },
  step: () => beep(1175, 0.09, 0, 0.05, 'triangle'),
  splash: () => {
    crack(0.7, 0.5, 1100);
    beep(500, 0.5, 0, 0.06, 'sine', 120);
  },
  spray: () => hiss(AC.currentTime, 0.25, 0.1, 'highpass', 3000, sfx),
  alarm: () => {
    for (let i = 0; i < 6; i++) {
      beep(i % 2 ? 880 : 1175, 0.16, i * 0.17, 0.05);
    }
  },
  glass: () => {
    hiss(AC.currentTime, 0.25, 0.25, 'highpass', 5000, sfx);
    beep(2600, 0.08, 0, 0.04, 'triangle', 1800);
  },
};
/**
 *
 * @param name
 * @param arg
 */
export function play(name, arg) {
  if (AC && !muted) {
    SFX[name](arg);
  }
}

/**
 *
 */
export function babble() {
  // one muffled syllable of Flo on the pager
  if (!AC || muted) {
    return;
  }
  const t = AC.currentTime;
  const d = rnd(0.07, 0.15);
  f0 = Math.min(150, Math.max(92, f0 + rnd(-14, 14)));
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * rnd(0.88, 1.14), t + d);
  env(g, t, 0.012, d, 0.5, 0.5);
  for (const [lo, hi] of [
    [280, 850],
    [950, 2300],
  ]) {
    // two wandering formants make it sound like speech
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(rnd(lo, hi), t);
    f.frequency.linearRampToValueAtTime(rnd(lo, hi), t + d);
    o.connect(f).connect(g);
  }
  g.connect(voiceBus);
  o.start(t);
  o.stop(t + d + 0.05);
}

const ENGINES = {
  tractor: [26, 3.2, 300],
  mixer: [30, 3.4, 300],
  truck: [32, 3.6, 320],
  fire: [34, 3.8, 340],
  sport: [55, 6.5, 520],
};
/**
 *
 * @param speed
 * @param on
 * @param kind
 */
export function engine(speed, on, kind) {
  if (!eng) {
    return;
  }
  const [base, k, cut] = ENGINES[kind] || [45, 5.5, 380];
  const f = base + Math.abs(speed) * k;
  const t = AC.currentTime;
  eng.o.frequency.setTargetAtTime(f, t, 0.03);
  eng.o2.frequency.setTargetAtTime(f / 2, t, 0.03);
  eng.lp.frequency.value = cut;
  eng.g.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.05);
}
/**
 *
 * @param on
 */
export function siren(on) {
  if (sirenGain) {
    sirenGain.gain.setTargetAtTime(on ? 0.03 : 0, AC.currentTime, 0.05);
  }
}

// ---------- car radio: four little step sequencers, sixteenth notes

/**
 *
 * @param t
 * @param v
 */
function kick(t, v = 0.9) {
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  o.connect(g).connect(music);
  o.start(t);
  o.stop(t + 0.3);
}
const snare = (t, v = 0.45) => {
  hiss(t, 0.15, v, 'bandpass', 1900, music);
  osc('triangle', 190, t, 0.08, v * 0.3, music, 120);
};
const hat = (t, v = 0.16, open) =>
  hiss(t, open ? 0.2 : 0.035, v, 'highpass', 7500, music);
/**
 *
 * @param t
 * @param n
 * @param dur
 * @param root0
 * @param root0.type
 * @param root0.vol
 * @param root0.cut
 * @param root0.q
 * @param root0.sweep
 * @param root0.det
 * @param root0.att
 * @param root0.out
 */
function note(
  t,
  n,
  dur,
  {
    type = 'sawtooth',
    vol = 0.16,
    cut = 1400,
    q = 1,
    sweep = 0,
    det = 0,
    att = 0.006,
    out = music,
  } = {}
) {
  const g = AC.createGain();
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(cut + sweep, t);
  if (sweep) {
    f.frequency.exponentialRampToValueAtTime(cut, t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, t + Math.max(att, dur * 0.7));
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  for (const d of det ? [-det, det] : [0]) {
    const o = AC.createOscillator();
    o.type = type;
    o.frequency.value = midi(n);
    o.detune.value = d;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  f.connect(g).connect(out);
}
const chord = (t, ns, dur, o) => ns.forEach(n => note(t, n, dur, o));
const on = (pat, i) => pat[i % pat.length] === 'x';

// Kerwa polka: [chord, four eighth notes of melody] per bar, 0 = hold, -1 = rest
const F = {tuba: [41, 36], pah: [57, 60, 65]};
const C7 = {tuba: [36, 43], pah: [55, 58, 64]};
const Bb = {tuba: [34, 41], pah: [58, 62, 65]};
const POLKA = [
  [F, 69, 72, 77, 72],
  [F, 69, 72, 77, 0],
  [C7, 67, 70, 76, 70],
  [C7, 67, 70, 76, 0],
  [C7, 76, 74, 72, 70],
  [C7, 67, 69, 70, 67],
  [F, 69, 72, 77, 81],
  [F, 77, 0, 0, -1],
  [F, 72, 72, 69, 72],
  [F, 77, 0, 76, 74],
  [Bb, 74, 74, 70, 74],
  [Bb, 79, 0, 77, 74],
  [C7, 72, 76, 79, 76],
  [C7, 70, 72, 74, 76],
  [F, 77, 81, 77, 72],
  [F, 77, 0, 0, -1],
];
const FUNK_BASS = {
  0: [40, 2],
  3: [40, 1],
  6: [43, 2],
  8: [45, 2],
  11: [43, 1],
  12: [40, 2],
  16: [40, 2],
  19: [40, 1],
  22: [38, 2],
  24: [35, 2],
  27: [38, 1],
  28: [39, 1],
  30: [40, 2],
};
const FUNK_LICKS = [
  [76, 79, 81, 79, 76, 0, 74, 76],
  [83, 0, 81, 79, 81, 0, 76, 0],
  [76, 0, 79, 0, 81, 83, 86, 0],
];
const ACID = [33, 33, 45, 33, 36, 33, 45, 31, 33, 33, 45, 33, 40, 38, 36, 31];
const RIFF = [40, 40, 43, 40, 45, 40, 43, 45, 40, 40, 43, 40, 47, 45, 43, 38];
let lick = null;

const STATIONS = [
  {
    name: 'SCHWALL FM 96,1',
    bpm: 98,
    swing: 0.28,
    step(i, t, s) {
      const k = i % 32;
      if (on('x.....x.x.......x.....x...x.....', k)) {
        kick(t);
      }
      if (k % 8 === 4) {
        snare(t);
      }
      if (k % 2 === 0) {
        hat(t, k % 4 ? 0.1 : 0.16, k === 14 || k === 30);
      } else if (Math.random() < 0.3) {
        hat(t, 0.06);
      }
      if (FUNK_BASS[k]) {
        note(t, FUNK_BASS[k][0], FUNK_BASS[k][1] * s * 0.9, {
          type: 'square',
          vol: 0.2,
          cut: 500,
          sweep: 900,
          q: 4,
        });
      }
      if (k === 4 || k === 10 || k === 20 || k === 26) {
        chord(t, [64, 67, 71, 74], s * 1.2, {
          vol: 0.045,
          cut: 1100,
          sweep: 2500,
          q: 5,
        });
      }
      if (k === 0) {
        lick = ((i / 32) | 0) % 2 ? FUNK_LICKS[(Math.random() * 3) | 0] : null;
      }
      if (lick && k >= 16 && k % 2 === 0 && lick[(k - 16) / 2]) {
        note(t, lick[(k - 16) / 2], s * 1.8, {
          type: 'square',
          vol: 0.07,
          cut: 2200,
          q: 2,
        });
      }
    },
  },
  {
    name: 'KERWA-WELLE 88,8',
    bpm: 118,
    step(i, t, s) {
      const bar = POLKA[(i >> 3) % 16];
      const k = i % 8;
      const beat = k >> 2;
      const m = bar[1 + (k >> 1)];
      const held = k < 6 && bar[2 + (k >> 1)] === 0;
      if (k % 4 === 0) {
        note(t, bar[0].tuba[beat], s * 2.4, {
          type: 'square',
          vol: 0.22,
          cut: 420,
        });
        kick(t, 0.5);
      }
      if (k % 4 === 2) {
        chord(t, bar[0].pah, s * 1.1, {vol: 0.05, cut: 1500, att: 0.01});
        snare(t, 0.16);
      }
      if (k % 2 === 0 && m > 0) {
        note(t, m, s * (held ? 3.8 : 1.8), {
          vol: 0.11,
          cut: 2100,
          det: 7,
          att: 0.02,
        });
      }
      if (i % 128 === 0) {
        hat(t, 0.2, true);
      }
    },
  },
  {
    name: 'EBRACH TECHNO 101,5',
    bpm: 138,
    step(i, t, s) {
      const k = i % 16;
      const bar = (i >> 4) % 4;
      const wob = 0.5 + 0.5 * Math.sin((i / 64) * Math.PI);
      if (k % 4 === 0) {
        kick(t, 1);
      }
      if (k % 4 === 2) {
        hat(t, 0.18, true);
      }
      if (k % 8 === 4) {
        snare(t, 0.3);
      }
      note(t, ACID[k] + (bar === 3 ? -2 : 0), s * 0.85, {
        vol: k % 4 === 2 ? 0.2 : 0.14,
        cut: 250 + 1300 * wob,
        sweep: 700,
        q: 11,
      });
      if (k === 3 || k === 6 || k === 11) {
        chord(
          t,
          bar === 3 ? [55, 59, 62] : bar === 2 ? [53, 57, 60] : [57, 60, 64],
          s * 1.5,
          {
            vol: 0.05,
            cut: 2600,
            det: 9,
          }
        );
      }
    },
  },
  {
    name: 'STEIGERWALD ROCK 104,0',
    bpm: 152,
    step(i, t, s) {
      const k = i % 32;
      const solo = (i >> 5) % 4 === 3;
      if (on('x.....x.x.......x.....x.x..x....', k)) {
        kick(t);
      }
      if (k % 8 === 4) {
        snare(t, 0.5);
      }
      if (k % 2 === 0) {
        hat(t, 0.12, k % 16 === 14);
      }
      if (k % 2 === 0) {
        chord(t, [RIFF[k >> 1], RIFF[k >> 1] + 7, RIFF[k >> 1] + 12], s * 1.5, {
          vol: 0.045,
          cut: 3000,
          out: drive,
        });
      }
      if (k % 4 === 0) {
        note(t, RIFF[k >> 1] - 12, s * 3, {
          type: 'square',
          vol: 0.16,
          cut: 380,
        });
      }
      if (solo && k % 2 === 0 && Math.random() < 0.8) {
        note(
          t,
          [64, 67, 69, 71, 74, 76, 79][(Math.random() * 7) | 0],
          s * 1.9,
          {
            type: 'square',
            vol: 0.05,
            cut: 2600,
            out: drive,
          }
        );
      }
    },
  },
];

/**
 *
 */
function tick() {
  if (station < 0 || AC.state !== 'running') {
    return;
  }
  const st = STATIONS[station];
  const s = 60 / st.bpm / 4;
  if (nextT < AC.currentTime) {
    nextT = AC.currentTime + 0.06;
  }
  while (nextT < AC.currentTime + 0.25) {
    st.step(stepI, nextT + (st.swing && stepI % 2 ? s * st.swing : 0), s);
    nextT += s;
    stepI++;
  }
}
/**
 *
 * @param i
 */
export function radio(i) {
  // -1 switches it off
  if (i === station) {
    return;
  }
  station = i;
  stepI = 0;
  nextT = 0;
}

/** The names of the radio stations, in dial order. */
export const stations = STATIONS.map(s => s.name);

/**
 *
 */
export function isMuted() {
  return muted;
}

/**
 *
 * @param m
 */
export function mute(m) {
  muted = m;
  if (master) {
    master.gain.value = m ? 0 : 1;
  }
}

/**
 *
 * @param p
 */
export function pause(p) {
  if (AC) {
    p ? AC.suspend() : AC.resume();
  }
}

/**
 *
 */
export function level() {
  // loudness right now, 0 when silent
  if (!tap) {
    return 0;
  }
  tap.fftSize = 8192;
  const d = new Float32Array(tap.fftSize);
  tap.getFloatTimeDomainData(d);
  return Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length);
}

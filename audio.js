// Everything you hear is synthesised here: effects, Flo's pager voice, engines
// and the car radio.

let audioCtx;
let master;
let sfx;
let music;
let voiceBus;
let drive;
let noiseBuf;
let tap;
let engineNodes;
let sirenGain;
let muted = false;
let station = -1;
let nextTime = 0;
let stepIndex = 0;
let voicePitch = 118;
const midi = n => 440 * 2 ** ((n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);

/** Creates the audio graph. Browsers allow this only after a click or tap. */
export function init() {
  if (audioCtx) {
    if (audioCtx.state !== 'running') {
      audioCtx.resume();
    }
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  master = audioCtx.createGain();
  master.gain.value = muted ? 0 : 1;
  master
    .connect(audioCtx.createDynamicsCompressor())
    .connect(audioCtx.destination);
  // Lets the self-test see that sound is coming out
  tap = audioCtx.createAnalyser();
  master.connect(tap);
  sfx = audioCtx.createGain();
  sfx.connect(master);
  music = audioCtx.createGain();
  music.gain.value = 0.3;
  music.connect(master);
  voiceBus = audioCtx.createBiquadFilter(); // small pager speaker
  voiceBus.type = 'bandpass';
  voiceBus.frequency.value = 1100;
  voiceBus.Q.value = 0.8;
  const loud = audioCtx.createGain();
  loud.gain.value = 2.5;
  voiceBus.connect(loud).connect(sfx);
  drive = audioCtx.createWaveShaper(); // fuzz for the rock station
  drive.curve = Float32Array.from({length: 256}, (_, i) =>
    Math.tanh((i / 128 - 1) * 5)
  );
  const tone = audioCtx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  drive.connect(tone).connect(music);
  noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) {
    ch[i] = Math.random() * 2 - 1;
  }

  const o = audioCtx.createOscillator();
  const o2 = audioCtx.createOscillator();
  const lp = audioCtx.createBiquadFilter();
  const g = audioCtx.createGain();
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
  engineNodes = {o, o2, lp, g};

  const so = audioCtx.createOscillator();
  const lfo = audioCtx.createOscillator();
  const depth = audioCtx.createGain();
  const slp = audioCtx.createBiquadFilter();
  so.type = 'square';
  so.frequency.value = 510; // Martinshorn: two notes, a fourth apart
  lfo.type = 'square';
  lfo.frequency.value = 0.75;
  depth.gain.value = 75;
  lfo.connect(depth).connect(so.frequency);
  slp.type = 'lowpass';
  slp.frequency.value = 1800;
  sirenGain = audioCtx.createGain();
  sirenGain.gain.value = 0;
  so.connect(slp).connect(sirenGain).connect(sfx);
  so.start();
  lfo.start();
  setInterval(tick, 70);
}

/**
 * Shapes a note: attack, hold for a share of the length, then die away.
 * @param {!GainNode} g
 * @param {number} t
 * @param {number} a Attack, in seconds.
 * @param {number} d Length, in seconds.
 * @param {number} vol
 * @param {number=} hold Share of the length held at full volume.
 */
function env(g, t, a, d, vol, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + a + d * hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
/**
 * Plays one oscillator note.
 * @param {string} type
 * @param {number} f Frequency, in hertz.
 * @param {number} t When it sounds, in audio context seconds.
 * @param {number} dur
 * @param {number} vol
 * @param {!AudioNode} out
 * @param {number=} to Frequency to slide to.
 * @param {number=} a Attack, in seconds.
 */
function osc(type, f, t, dur, vol, out, to = 0, a = 0.004) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
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
 * Plays a burst of filtered noise.
 * @param {number} t When it sounds, in audio context seconds.
 * @param {number} dur
 * @param {number} vol
 * @param {string} type Filter type.
 * @param {number} freq
 * @param {!AudioNode} out
 * @param {number=} q
 */
function hiss(t, dur, vol, type, freq, out, q = 0.7) {
  const s = audioCtx.createBufferSource();
  const f = audioCtx.createBiquadFilter();
  const g = audioCtx.createGain();
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
  osc(type, f, audioCtx.currentTime + wait, d, vol, sfx, to);
const crack = (d, vol, freq = 900, wait = 0) =>
  hiss(audioCtx.currentTime + wait, d, vol, 'lowpass', freq, sfx);
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
  train: () => {
    // the two-tone horn of a goods engine, a long call and a short one
    for (const [wait, d] of [
      [0, 0.9],
      [1.15, 0.45],
    ]) {
      beep(185, d, wait, 0.07, 'sawtooth');
      beep(233, d, wait, 0.07, 'sawtooth');
    }
  },
  splash: () => {
    crack(0.7, 0.5, 1100);
    beep(500, 0.5, 0, 0.06, 'sine', 120);
  },
  spray: () => hiss(audioCtx.currentTime, 0.25, 0.1, 'highpass', 3000, sfx),
  alarm: () => {
    for (let i = 0; i < 6; i++) {
      beep(i % 2 ? 880 : 1175, 0.16, i * 0.17, 0.05);
    }
  },
  glass: () => {
    hiss(audioCtx.currentTime, 0.25, 0.25, 'highpass', 5000, sfx);
    beep(2600, 0.08, 0, 0.04, 'triangle', 1800);
  },
};
/**
 * Plays a sound effect.
 * @param {string} name
 * @param {*=} arg Passed on to the effect, e.g. the impact speed.
 */
export function play(name, arg) {
  if (audioCtx && !muted) {
    SFX[name](arg);
  }
}

/** One muffled syllable of Flo on the pager. */
export function babble() {
  if (!audioCtx || muted) {
    return;
  }
  const t = audioCtx.currentTime;
  const d = rnd(0.07, 0.15);
  voicePitch = Math.min(150, Math.max(92, voicePitch + rnd(-14, 14)));
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(voicePitch, t);
  o.frequency.linearRampToValueAtTime(voicePitch * rnd(0.88, 1.14), t + d);
  env(g, t, 0.012, d, 0.5, 0.5);
  for (const [lo, hi] of [
    [280, 850],
    [950, 2300],
  ]) {
    // two wandering formants make it sound like speech
    const f = audioCtx.createBiquadFilter();
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
 * Tunes the engine drone to the speed.
 * @param {number} speed
 * @param {boolean} on
 * @param {string} kind Vehicle kind.
 */
export function engine(speed, on, kind) {
  if (!engineNodes) {
    return;
  }
  const [base, k, cut] = ENGINES[kind] || [45, 5.5, 380];
  const f = base + Math.abs(speed) * k;
  const t = audioCtx.currentTime;
  engineNodes.o.frequency.setTargetAtTime(f, t, 0.03);
  engineNodes.o2.frequency.setTargetAtTime(f / 2, t, 0.03);
  engineNodes.lp.frequency.value = cut;
  engineNodes.g.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.05);
}
/**
 * Switches the police siren on or off.
 * @param {boolean} on
 */
export function siren(on) {
  if (sirenGain) {
    sirenGain.gain.setTargetAtTime(on ? 0.03 : 0, audioCtx.currentTime, 0.05);
  }
}

// ---------- car radio: four little step sequencers, sixteenth notes

/**
 * Bass drum.
 * @param {number} t When it sounds, in audio context seconds.
 * @param {number=} v
 */
function kick(t, v = 0.9) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
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
 * Plays one note of a filtered synth voice.
 * @param {number} t When it sounds, in audio context seconds.
 * @param {number} n MIDI note number.
 * @param {number} dur
 * @param {!Object=} opt Timbre: type, vol, cut, q, sweep, det, att, out.
 */
function note(t, n, dur, opt = {}) {
  const {
    type = 'sawtooth',
    vol = 0.16,
    cut = 1400,
    q = 1,
    sweep = 0,
    det = 0,
    att = 0.006,
    out = music,
  } = opt;
  const g = audioCtx.createGain();
  const f = audioCtx.createBiquadFilter();
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
    const o = audioCtx.createOscillator();
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

// Kerwa polka: [chord, four eighth notes of melody] per bar, 0 = hold, -1 =
// rest
const CHORD_F = {tuba: [41, 36], pah: [57, 60, 65]};
const CHORD_C7 = {tuba: [36, 43], pah: [55, 58, 64]};
const CHORD_BB = {tuba: [34, 41], pah: [58, 62, 65]};
const POLKA = [
  [CHORD_F, 69, 72, 77, 72],
  [CHORD_F, 69, 72, 77, 0],
  [CHORD_C7, 67, 70, 76, 70],
  [CHORD_C7, 67, 70, 76, 0],
  [CHORD_C7, 76, 74, 72, 70],
  [CHORD_C7, 67, 69, 70, 67],
  [CHORD_F, 69, 72, 77, 81],
  [CHORD_F, 77, 0, 0, -1],
  [CHORD_F, 72, 72, 69, 72],
  [CHORD_F, 77, 0, 76, 74],
  [CHORD_BB, 74, 74, 70, 74],
  [CHORD_BB, 79, 0, 77, 74],
  [CHORD_C7, 72, 76, 79, 76],
  [CHORD_C7, 70, 72, 74, 76],
  [CHORD_F, 77, 81, 77, 72],
  [CHORD_F, 77, 0, 0, -1],
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

/** Schedules the radio a quarter of a second ahead. */
function tick() {
  if (station < 0 || audioCtx.state !== 'running') {
    return;
  }
  const st = STATIONS[station];
  const s = 60 / st.bpm / 4;
  if (nextTime < audioCtx.currentTime) {
    nextTime = audioCtx.currentTime + 0.06;
  }
  while (nextTime < audioCtx.currentTime + 0.25) {
    st.step(
      stepIndex,
      nextTime + (st.swing && stepIndex % 2 ? s * st.swing : 0),
      s
    );
    nextTime += s;
    stepIndex++;
  }
}
/**
 * Tunes the car radio.
 * @param {number} i Station index, -1 switches it off.
 */
export function radio(i) {
  if (i === station) {
    return;
  }
  station = i;
  stepIndex = 0;
  nextTime = 0;
}

/** The names of the radio stations, in dial order. */
export const stations = STATIONS.map(s => s.name);

/** @return {boolean}  */
export function isMuted() {
  return muted;
}

/** @param {boolean} m  */
export function mute(m) {
  muted = m;
  if (master) {
    master.gain.value = m ? 0 : 1;
  }
}

/**
 * Suspends or resumes all sound.
 * @param {boolean} p
 */
export function pause(p) {
  if (audioCtx) {
    p ? audioCtx.suspend() : audioCtx.resume();
  }
}

/**
 * Loudness right now.
 * @return {number} 0 when silent.
 */
export function level() {
  if (!tap) {
    return 0;
  }
  tap.fftSize = 8192;
  const d = new Float32Array(tap.fftSize);
  tap.getFloatTimeDomainData(d);
  return Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length);
}

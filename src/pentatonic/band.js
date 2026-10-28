// Sampled backing band for the Pentatonic tab: drums, bass, rhythm guitar, keys.
// Runs its own look-ahead scheduler on the Tone context instead of the shared
// Tone.Transport, which the Guitar Tab player cancels/stops freely.
import * as Tone from 'tone';

const BASE = `${import.meta.env.BASE_URL}backing/`;

// Salamander Drumkit (Alexander Holm, CC BY-SA 3.0) — several takes per piece,
// picked at random so repeated hits don't sound machine-gunned.
const DRUM_FILES = {
  kick: ['kick-1.wav', 'kick-2.wav', 'kick-3.wav'],
  snare: ['snare-1.wav', 'snare-2.wav', 'snare-3.wav'],
  ghost: ['ghost-1.wav', 'ghost-2.wav'],
  hat: ['hat-1.wav', 'hat-2.wav', 'hat-3.wav'],
  hatOpen: ['hat-open-1.wav'],
  ride: ['ride-1.wav', 'ride-2.wav'],
  crash: ['crash-1.wav'],
};

// tonejs-instruments (Nicholas Brosowsky, CC BY 3.0); the sampler repitches between notes
const SAMPLER_NOTES = {
  bass: ['E1', 'G1', 'A#1', 'C#2', 'E2', 'G2', 'A#2', 'C#3'],
  guitar: ['E2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4'],
  piano: ['C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5'],
  organ: ['C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5'],
};
const samplerUrls = notes => Object.fromEntries(notes.map(n => [n, n.replace('#', 's') + '.mp3']));

export const PARTS = ['drums', 'bass', 'guitar', 'keys'];

const QUALITY = {
  maj: { third: 4, fifth: 7, seventh: 10 },
  min: { third: 3, fifth: 7, seventh: 10 },
  dim: { third: 3, fifth: 6, seventh: 9 },
  dom7: { third: 4, fifth: 7, seventh: 10 },
  min7: { third: 3, fifth: 7, seventh: 10 },
};
const hasSeventh = q => q === 'dom7' || q === 'min7';

// lowest playable root on each instrument
const bassRoot = pc => 28 + ((pc - 4 + 12) % 12);   // E1..D#2
const guitarRoot = pc => 40 + ((pc - 4 + 12) % 12); // E2..D#3
const keysRoot = pc => 48 + pc;                      // C3..B3

// Barre-chord shapes: E-shape for roots on the low E string, A-shape higher up.
function guitarVoicing(chord) {
  const r = guitarRoot(chord.rootPc);
  const q = QUALITY[chord.quality];
  const seventh = hasSeventh(chord.quality);
  const shape = r <= 44
    ? [0, q.fifth, seventh ? q.seventh : 12, 12 + q.third, 12 + q.fifth, 24]
    : [0, q.fifth, 12, 12 + q.third, 12 + q.fifth];
  return shape.map(o => r + o);
}

function keysVoicing(chord, withSeventh) {
  const r = keysRoot(chord.rootPc);
  const q = QUALITY[chord.quality];
  const notes = [r, r + q.third, r + q.fifth];
  if (withSeventh || hasSeventh(chord.quality)) notes.push(r + q.seventh);
  return notes;
}

/* ---------- styles ----------
   Each style's bar() returns the events for one bar of a chord:
   drums { part:'drums', piece, step, vel }
   notes { part, step, notes:[midi], len (steps), vel, strum: 1 down / -1 up / 0 } */
const STYLES = {
  blues: {
    label: 'Blues Shuffle',
    steps: 12, // triplet grid: each beat = 3 steps, swung 8ths on steps 0 and 2
    keys: 'organ',
    drive: 0.12,
    bar({ chord, bar, isFirst }) {
      const ev = [];
      const q = QUALITY[chord.quality];
      const b = bassRoot(chord.rootPc);
      const g = guitarRoot(chord.rootPc);
      const swung = [0, 2, 3, 5, 6, 8, 9, 11];

      ev.push({ part: 'drums', piece: isFirst ? 'crash' : 'kick', step: 0, vel: 0.85 });
      if (isFirst) ev.push({ part: 'drums', piece: 'kick', step: 0, vel: 0.85 });
      ev.push({ part: 'drums', piece: 'kick', step: 6, vel: 0.75 });
      ev.push({ part: 'drums', piece: 'snare', step: 3, vel: 0.8 });
      ev.push({ part: 'drums', piece: 'snare', step: 9, vel: 0.85 });
      swung.forEach(s => ev.push({ part: 'drums', piece: 'ride', step: s, vel: s % 3 === 0 ? 0.6 : 0.4 }));

      // walking boogie bass: up the chord one bar, back down the next
      const walk = bar % 2 === 0 ? [0, q.third, q.fifth, 9] : [q.seventh, 9, q.fifth, q.third];
      walk.forEach((o, i) => ev.push({ part: 'bass', step: i * 3, notes: [b + o], len: 2.6, vel: i === 0 ? 0.85 : 0.7 }));

      // root-fifth / root-sixth boogie on the low strings
      swung.forEach((s, i) => {
        const top = bar % 2 === 1 && (i === 4 || i === 5) ? q.seventh : (i % 4 < 2 ? 7 : 9);
        ev.push({ part: 'guitar', step: s, notes: [g, g + top], len: 1.6, vel: s % 3 === 0 ? 0.7 : 0.55, strum: 1 });
      });

      ev.push({ part: 'keys', step: 0, notes: keysVoicing(chord, true), len: 11.5, vel: 0.3 });
      return ev;
    },
  },

  rock: {
    label: 'Rock',
    steps: 16,
    keys: 'organ',
    drive: 0.45,
    bar({ chord, isFirst }) {
      const ev = [];
      const b = bassRoot(chord.rootPc);
      const g = guitarRoot(chord.rootPc);
      const power = [g, g + 7, g + 12];

      [0, 8, 10].forEach(s => ev.push({ part: 'drums', piece: 'kick', step: s, vel: s === 10 ? 0.7 : 0.9 }));
      [4, 12].forEach(s => ev.push({ part: 'drums', piece: 'snare', step: s, vel: 0.9 }));
      for (let s = 0; s < 16; s += 2) {
        if (s === 0 && isFirst) ev.push({ part: 'drums', piece: 'crash', step: 0, vel: 0.8 });
        else ev.push({ part: 'drums', piece: 'hat', step: s, vel: s % 4 === 0 ? 0.6 : 0.45 });
      }

      for (let s = 0; s < 16; s += 2) ev.push({ part: 'bass', step: s, notes: [b], len: 1.7, vel: s % 8 === 0 ? 0.85 : 0.7 });

      // palm-muted eighths with open accents on 1 and 3
      for (let s = 0; s < 16; s += 2) {
        const accent = s === 0 || s === 8;
        ev.push({ part: 'guitar', step: s, notes: power, len: accent ? 3 : 1.1, vel: accent ? 0.75 : 0.5, strum: 1 });
      }

      ev.push({ part: 'keys', step: 0, notes: keysVoicing(chord, false), len: 15.5, vel: 0.22 });
      return ev;
    },
  },

  funk: {
    label: 'Funk',
    steps: 16,
    keys: 'piano',
    drive: 0,
    bar({ chord, isFirst }) {
      const ev = [];
      const q = QUALITY[chord.quality];
      const b = bassRoot(chord.rootPc);
      const voicing = guitarVoicing({ ...chord, quality: chord.quality === 'maj' ? 'dom7' : chord.quality === 'min' ? 'min7' : chord.quality });
      const chank = voicing.slice(-4);

      ev.push({ part: 'drums', piece: isFirst ? 'crash' : 'kick', step: 0, vel: 0.9 });
      if (isFirst) ev.push({ part: 'drums', piece: 'kick', step: 0, vel: 0.9 });
      [7, 10].forEach(s => ev.push({ part: 'drums', piece: 'kick', step: s, vel: 0.65 }));
      [4, 12].forEach(s => ev.push({ part: 'drums', piece: 'snare', step: s, vel: 0.9 }));
      [9, 14].forEach(s => ev.push({ part: 'drums', piece: 'ghost', step: s, vel: 0.35 }));
      for (let s = 0; s < 16; s++) {
        if (s === 0 && isFirst) continue;
        ev.push({ part: 'drums', piece: s === 14 ? 'hatOpen' : 'hat', step: s, vel: s % 4 === 0 ? 0.55 : s % 2 === 0 ? 0.4 : 0.25 });
      }

      [[0, 0, 2], [3, 12, 0.8], [6, 0, 0.8], [10, 0, 0.8], [11, q.seventh, 0.8], [13, q.fifth, 0.8], [14, 12, 1]]
        .forEach(([s, o, len]) => ev.push({ part: 'bass', step: s, notes: [b + o], len, vel: s === 0 ? 0.9 : 0.7 }));

      [2, 4, 6, 10, 12, 14].forEach((s, i) =>
        ev.push({ part: 'guitar', step: s, notes: chank, len: 0.55, vel: s % 4 === 0 ? 0.65 : 0.5, strum: i % 2 ? -1 : 1 }));

      ev.push({ part: 'keys', step: 0, notes: keysVoicing(chord, true), len: 1.5, vel: 0.45 });
      ev.push({ part: 'keys', step: 7, notes: keysVoicing(chord, true), len: 1, vel: 0.35 });
      return ev;
    },
  },

  ballad: {
    label: 'Ballad',
    steps: 16,
    keys: 'piano',
    drive: 0,
    bar({ chord, isFirst }) {
      const ev = [];
      const q = QUALITY[chord.quality];
      const b = bassRoot(chord.rootPc);
      const voicing = guitarVoicing(chord);

      if (isFirst) ev.push({ part: 'drums', piece: 'crash', step: 0, vel: 0.5 });
      [0, 10].forEach(s => ev.push({ part: 'drums', piece: 'kick', step: s, vel: 0.7 }));
      ev.push({ part: 'drums', piece: 'snare', step: 8, vel: 0.6 });
      for (let s = 0; s < 16; s += 2) ev.push({ part: 'drums', piece: 'hat', step: s, vel: s % 4 === 0 ? 0.35 : 0.25 });

      ev.push({ part: 'bass', step: 0, notes: [b], len: 7.5, vel: 0.8 });
      ev.push({ part: 'bass', step: 8, notes: [b + q.fifth], len: 7.5, vel: 0.7 });

      // let-ring arpeggio up and back down the chord shape
      [0, 2, 3, 4, voicing.length - 1, 4, 3, 2].forEach((vi, i) =>
        ev.push({ part: 'guitar', step: i * 2, notes: [voicing[Math.min(vi, voicing.length - 1)]], len: 5, vel: 0.5 }));

      ev.push({ part: 'keys', step: 0, notes: keysVoicing(chord, false), len: 15.5, vel: 0.32 });
      return ev;
    },
  },
};

export const STYLE_OPTIONS = Object.entries(STYLES).map(([value, s]) => ({ value, label: s.label }));

const toNote = midi => Tone.Frequency(midi, 'midi').toNote();
const jitter = amount => (Math.random() * 2 - 1) * amount;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export function createBand() {
  let loadPromise = null;
  let drums = null;      // { piece: ToneAudioBuffer[] }
  let samplers = null;   // { bass, guitar, piano, organ }
  let channels = null;   // { drums, bass, guitar, keys }
  let drive = null;
  let reverb = null;

  const mix = {
    drums: { volume: 0.8, muted: false },
    bass: { volume: 0.8, muted: false },
    guitar: { volume: 0.7, muted: false },
    keys: { volume: 0.5, muted: false },
  };
  let style = 'blues';
  let bpm = 100;

  let timer = null;
  let queue = [];        // pending events with absolute times
  let liveSources = [];  // drum hits already handed to Web Audio
  let uiTimers = [];

  const volumeDb = v => (v <= 0 ? -Infinity : 20 * Math.log10(v));

  function applyMix() {
    if (!channels) return;
    PARTS.forEach(p => {
      channels[p].volume.value = volumeDb(mix[p].volume);
      channels[p].mute = mix[p].muted;
    });
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      reverb = new Tone.Reverb({ decay: 1.8, wet: 0.14 }).toDestination();
      const bus = new Tone.Compressor({ threshold: -16, ratio: 3 }).connect(reverb);
      channels = Object.fromEntries(PARTS.map(p => [p, new Tone.Channel().connect(bus)]));
      drive = new Tone.Distortion({ distortion: 0.3, wet: STYLES[style].drive }).connect(channels.guitar);
      applyMix();

      let pending = 1 + Object.keys(SAMPLER_NOTES).length;
      const done = () => { if (--pending === 0) resolve(); };
      const fail = () => reject(new Error('Could not load backing-track sounds.'));

      const drumUrls = {};
      Object.entries(DRUM_FILES).forEach(([piece, files]) =>
        files.forEach((f, i) => { drumUrls[`${piece}-${i}`] = `${BASE}drums/${f}`; }));
      const drumBuffers = new Tone.ToneAudioBuffers({
        urls: drumUrls,
        onload: () => {
          drums = Object.fromEntries(Object.entries(DRUM_FILES).map(([piece, files]) =>
            [piece, files.map((_, i) => drumBuffers.get(`${piece}-${i}`))]));
          done();
        },
        onerror: fail,
      });

      const outputFor = { bass: channels.bass, guitar: drive, piano: channels.keys, organ: channels.keys };
      samplers = Object.fromEntries(Object.entries(SAMPLER_NOTES).map(([name, notes]) => [name,
        new Tone.Sampler({
          urls: samplerUrls(notes),
          baseUrl: `${BASE}${name}/`,
          release: name === 'organ' ? 0.25 : 0.6,
          onload: done,
          onerror: fail,
        }).connect(outputFor[name]),
      ]));
    });
    loadPromise.catch(() => { loadPromise = null; });
    return loadPromise;
  }

  function playDrum(piece, time, vel) {
    const takes = drums[piece];
    const src = new Tone.ToneBufferSource(takes[Math.floor(Math.random() * takes.length)]).connect(channels.drums);
    src.start(time, 0, undefined, vel);
    src.onended = () => { liveSources = liveSources.filter(s => s !== src); src.dispose(); };
    liveSources.push(src);
  }

  function playNotes(ev, time, stepDur) {
    const sampler = ev.part === 'keys' ? samplers[STYLES[style].keys] : samplers[ev.part];
    const order = ev.strum === -1 ? [...ev.notes].reverse() : ev.notes;
    const spread = ev.strum ? 0.012 : 0;
    order.forEach((m, i) => {
      sampler.triggerAttackRelease(toNote(m), ev.len * stepDur, time + i * spread, Math.max(0.05, ev.vel + jitter(0.06)));
    });
  }

  /* ---------- scheduler ---------- */
  // getChord(bar) -> chord for that bar; onBar(bar) fires in sync with the audio.
  let getChord = null;
  let onBar = null;
  let barIndex = 0;
  let nextBarTime = 0;
  let countIn = 0;

  function queueBar(time) {
    const s = STYLES[style];
    const beat = 60 / bpm;
    const stepDur = (beat * 4) / s.steps;
    if (countIn > 0) {
      const beatInCount = 4 - countIn;
      queue.push({ time, run: t => playDrum('hat', t, beatInCount === 0 ? 0.8 : 0.55) });
      countIn--;
      nextBarTime = time + beat;
      return;
    }
    const bar = barIndex;
    const chord = getChord(bar);
    s.bar({ chord, bar, isFirst: bar === 0 || chord.loopStart }).forEach(ev => {
      const t = Math.max(time, time + ev.step * stepDur + (ev.part === 'drums' && ev.piece === 'kick' ? 0 : jitter(0.004)));
      queue.push({
        time: t,
        run: at => (ev.part === 'drums'
          ? playDrum(ev.piece, at, Math.max(0.05, ev.vel + jitter(0.05)))
          : playNotes(ev, at, stepDur)),
      });
    });
    const delay = Math.max(0, (time - Tone.now()) * 1000);
    uiTimers.push(setTimeout(() => onBar && onBar(bar), delay));
    barIndex++;
    nextBarTime = time + beat * 4;
  }

  function tick() {
    const horizon = Tone.now() + LOOKAHEAD;
    while (nextBarTime < horizon + 0.05) queueBar(nextBarTime);
    const due = queue.filter(e => e.time < horizon);
    queue = queue.filter(e => e.time >= horizon);
    due.forEach(e => e.run(e.time));
  }

  async function start(opts) {
    await Tone.start();
    await load();
    stop();
    getChord = opts.getChord;
    onBar = opts.onBar;
    barIndex = opts.fromBar || 0;
    countIn = opts.countIn ? 4 : 0;
    nextBarTime = Tone.now() + 0.1;
    tick();
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    queue = [];
    uiTimers.forEach(clearTimeout);
    uiTimers = [];
    const now = Tone.now();
    liveSources.forEach(s => { try { s.stop(now + 0.05); } catch { /* already stopped */ } });
    liveSources = [];
    if (samplers) Object.values(samplers).forEach(s => s.releaseAll(now));
  }

  return {
    load,
    start,
    stop,
    get playing() { return timer !== null; },
    setStyle(v) {
      style = v;
      if (drive) drive.wet.value = STYLES[v].drive;
    },
    setBpm(v) { bpm = v; },
    setVolume(part, v) { mix[part].volume = v; applyMix(); },
    setMuted(part, m) { mix[part].muted = m; applyMix(); },
    getMix: () => mix,
    dispose() {
      stop();
      if (samplers) Object.values(samplers).forEach(s => s.dispose());
      if (channels) Object.values(channels).forEach(c => c.dispose());
      drive?.dispose();
      reverb?.dispose();
    },
  };
}

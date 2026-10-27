const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Weighted templates — root=1.0, fifth=0.9 (natural overtone), third=0.8
function buildTemplates() {
  const t = {};
  for (let r = 0; r < 12; r++) {
    const n = NOTES[r];
    t[n]        = wt([[r,1.0],[r+4,0.8],[r+7,0.9]]);
    t[n+'m']    = wt([[r,1.0],[r+3,0.8],[r+7,0.9]]);
    t[n+'7']    = wt([[r,1.0],[r+4,0.8],[r+7,0.9],[r+10,0.7]]);
    t[n+'m7']   = wt([[r,1.0],[r+3,0.8],[r+7,0.9],[r+10,0.7]]);
    t[n+'maj7'] = wt([[r,1.0],[r+4,0.8],[r+7,0.9],[r+11,0.7]]);
  }
  return t;
}

function wt(pairs) {
  const v = new Float32Array(12);
  for (const [s, w] of pairs) v[((s % 12) + 12) % 12] = Math.max(v[((s%12)+12)%12], w);
  return v;
}

const TEMPLATES = buildTemplates();

// Cooley-Tukey FFT (in-place, power-of-2)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wdr = Math.cos(ang), wdi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const tr = re[b]*wr - im[b]*wi, ti = re[b]*wi + im[b]*wr;
        re[b] = re[a]-tr; im[b] = im[a]-ti;
        re[a] += tr; im[a] += ti;
        const nr = wr*wdr - wi*wdi; wi = wr*wdi + wi*wdr; wr = nr;
      }
    }
  }
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5*(1 - Math.cos(2*Math.PI*i/(n-1)));
  return w;
}

// Gaussian pitch-class distribution: spreads each bin's energy
// across the two nearest pitch classes weighted by a Gaussian (σ = 0.6 semitones)
function addToChroma(chroma, bassChroma, freq, mag) {
  const SIGMA = 0.6;
  const midi  = 12 * Math.log2(freq / 440) + 69;
  const exactPc = ((midi % 12) + 12) % 12;

  for (let pc = 0; pc < 12; pc++) {
    let dist = exactPc - pc;
    if (dist >  6) dist -= 12;
    if (dist < -6) dist += 12;
    const w = Math.exp(-0.5 * (dist / SIGMA) ** 2);
    if (w < 0.02) continue;
    chroma[pc] += mag * w;
    if (freq <= 350) bassChroma[pc] += mag * w;  // bass zone for root weighting
  }
}

function normalizeL2(v) {
  let norm = 0;
  for (let k = 0; k < 12; k++) norm += v[k]*v[k];
  norm = Math.sqrt(norm);
  const out = new Float32Array(12);
  if (norm > 1e-8) for (let k = 0; k < 12; k++) out[k] = v[k]/norm;
  return out;
}

// Combine full-range + bass chromagram (bass helps identify the root)
function combineChroma(chroma, bassChroma) {
  const nc = normalizeL2(chroma);
  const nb = normalizeL2(bassChroma);
  const out = new Float32Array(12);
  for (let k = 0; k < 12; k++) out[k] = 0.65*nc[k] + 0.35*nb[k];
  return out;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 12; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return (na > 0 && nb > 0) ? dot / Math.sqrt(na * nb) : 0;
}

function matchChord(chroma) {
  let best = 'N', bestScore = 0.38;
  for (const [name, tmpl] of Object.entries(TEMPLATES)) {
    const s = cosine(chroma, tmpl);
    if (s > bestScore) { best = name; bestScore = s; }
  }
  return { chord: best, confidence: bestScore };
}

// Median filter over chroma matrix to remove transient noise
function medianSmoothChroma(frames, halfW = 5) {
  return frames.map((f, i) => {
    const lo = Math.max(0, i - halfW), hi = Math.min(frames.length - 1, i + halfW);
    const smoothed = new Float32Array(12);
    for (let k = 0; k < 12; k++) {
      const vals = [];
      for (let j = lo; j <= hi; j++) vals.push(frames[j].chroma[k]);
      vals.sort((a, b) => a - b);
      smoothed[k] = vals[Math.floor(vals.length / 2)];
    }
    return { time: f.time, chroma: smoothed };
  });
}

// Merge consecutive identical-chord frames, filter short blips
function segmentChords(detected, minDuration = 0.5) {
  if (!detected.length) return [];
  const segs = [];
  let cur = { chord: detected[0].chord, startTime: detected[0].time, confidence: detected[0].confidence };
  for (let i = 1; i < detected.length; i++) {
    const { chord, time, confidence } = detected[i];
    if (chord !== cur.chord) {
      segs.push({ ...cur, endTime: time });
      cur = { chord, startTime: time, confidence };
    } else {
      cur.confidence = Math.max(cur.confidence, confidence);
    }
  }
  segs.push({ ...cur, endTime: detected[detected.length - 1].time + 0.2 });

  // Remove silence and short blips; merge neighbours that become the same after blip removal
  const filtered = segs.filter(s => s.chord !== 'N' && (s.endTime - s.startTime) >= minDuration);
  const merged = [];
  for (const seg of filtered) {
    const prev = merged[merged.length - 1];
    if (prev && prev.chord === seg.chord) {
      prev.endTime = seg.endTime;
      prev.confidence = Math.max(prev.confidence, seg.confidence);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// mono: Float32Array already downsampled to ~11025 Hz by the caller
export async function detectChords(mono, sampleRate, onProgress) {
  // Larger window → better frequency resolution (1.35 Hz/bin at 11025 Hz)
  const FRAME = 8192;
  const HOP   = 2048;
  const win   = hann(FRAME);
  const re    = new Float64Array(FRAME);
  const im    = new Float64Array(FRAME);
  const frames = [];
  const total  = Math.max(1, Math.floor((mono.length - FRAME) / HOP) + 1);
  let fi = 0;

  for (let start = 0; start + FRAME <= mono.length; start += HOP) {
    re.fill(0); im.fill(0);

    // Pre-emphasis: y[n] = x[n] - 0.97*x[n-1]  (boosts harmonic overtones)
    let prev = 0;
    for (let i = 0; i < FRAME; i++) {
      const x = mono[start + i] || 0;
      re[i] = (x - 0.97 * prev) * win[i];
      prev = x;
    }

    fft(re, im);

    const chroma     = new Float32Array(12);
    const bassChroma = new Float32Array(12);

    for (let b = 1; b < FRAME / 2; b++) {
      const freq = b * sampleRate / FRAME;
      if (freq < 65 || freq > 2600) continue;
      const mag = Math.sqrt(re[b]*re[b] + im[b]*im[b]);
      if (mag < 1e-10) continue;
      addToChroma(chroma, bassChroma, freq, mag);
    }

    frames.push({ time: (start + FRAME / 2) / sampleRate, chroma: combineChroma(chroma, bassChroma) });
    fi++;
    if (fi % 10 === 0) {
      onProgress?.(0.8 * fi / total);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.(0.85);
  const smoothed = medianSmoothChroma(frames, 7);
  const detected = smoothed.map(f => ({ time: f.time, ...matchChord(f.chroma) }));
  onProgress?.(0.95);
  const segments = segmentChords(detected, 0.5);
  onProgress?.(1.0);
  return segments;
}

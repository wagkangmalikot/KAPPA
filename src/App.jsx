import { useEffect, useRef, useState } from 'react';
import separationWorkerUrl from './separationWorker.js?worker&url';

const GUITAR_STRINGS = [
  { name: 'e', openMidi: 64 },
  { name: 'B', openMidi: 59 },
  { name: 'G', openMidi: 55 },
  { name: 'D', openMidi: 50 },
  { name: 'A', openMidi: 45 },
  { name: 'E', openMidi: 40 },
];

function findBestPosition(midiNotes) {
  let bestPos = 0;
  let bestCount = -1;
  for (let pos = 0; pos <= 20; pos++) {
    let count = 0;
    for (const midi of midiNotes) {
      for (const str of GUITAR_STRINGS) {
        const fret = midi - str.openMidi;
        if (fret >= pos && fret <= pos + 4) { count++; break; }
      }
    }
    if (count > bestCount) { bestCount = count; bestPos = pos; }
  }
  return bestPos;
}

function midiToFret(midi, position) {
  let inPos = null;
  let fallback = null;
  for (const str of GUITAR_STRINGS) {
    const fret = midi - str.openMidi;
    if (fret < 0 || fret > 24) continue;
    if (fret >= position && fret <= position + 4) {
      if (!inPos || fret < inPos.fret) inPos = { stringName: str.name, fret };
    }
    if (!fallback || fret < fallback.fret) fallback = { stringName: str.name, fret };
  }
  return inPos || fallback;
}

function renderAsciiTab(notes) {
  const BIN_SIZE = 0.1;
  const COLS_PER_LINE = 40;

  const position = findBestPosition(notes.map((n) => n.pitchMidi));

  const maxTime = Math.max(...notes.map((n) => n.startTimeSeconds));
  const totalCols = Math.ceil(maxTime / BIN_SIZE) + 1;

  const grid = GUITAR_STRINGS.map(() => new Array(totalCols).fill(null));

  const binMap = new Map();
  for (const note of notes) {
    const col = Math.floor(note.startTimeSeconds / BIN_SIZE);
    if (!binMap.has(col)) binMap.set(col, []);
    binMap.get(col).push(note);
  }

  for (const [col, binNotes] of binMap) {
    const sorted = [...binNotes].sort((a, b) => b.amplitude - a.amplitude);
    const usedStrings = new Set();
    for (const note of sorted) {
      const candidates = [];
      for (let i = 0; i < GUITAR_STRINGS.length; i++) {
        const fret = note.pitchMidi - GUITAR_STRINGS[i].openMidi;
        if (fret < 0 || fret > 24) continue;
        candidates.push({ strIdx: i, fret, inPos: fret >= position && fret <= position + 4 });
      }
      const best =
        candidates.find((c) => c.inPos && !usedStrings.has(c.strIdx)) ||
        candidates.find((c) => !usedStrings.has(c.strIdx)) ||
        candidates.find((c) => c.inPos) ||
        candidates[0];
      if (best) {
        grid[best.strIdx][col] = best.fret;
        usedStrings.add(best.strIdx);
      }
    }
  }

  const lines = [];
  for (let lineStart = 0; lineStart < totalCols; lineStart += COLS_PER_LINE) {
    const lineEnd = Math.min(lineStart + COLS_PER_LINE, totalCols);
    for (let s = 0; s < GUITAR_STRINGS.length; s++) {
      let row = `${GUITAR_STRINGS[s].name}|`;
      for (let c = lineStart; c < lineEnd; c++) {
        const fret = grid[s][c];
        if (fret === null) {
          row += '---';
        } else {
          const fretStr = String(fret);
          row += fretStr.length === 1 ? `--${fretStr}` : `-${fretStr}`;
        }
      }
      row += '|';
      lines.push(row);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Drum detection ──────────────────────────────────────────────

const DRUM_PARTS = [
  { key: 'BD', lowFreq: 30,   highFreq: 250,  threshFactor: 4.0, minGap: 0.08 },
  { key: 'SD', lowFreq: 250,  highFreq: 5000, threshFactor: 3.5, minGap: 0.07 },
  { key: 'HH', lowFreq: 7000, highFreq: null, threshFactor: 3.0, minGap: 0.04 },
];

async function filterBand(mono, sampleRate, lowFreq, highFreq) {
  const ctx = new OfflineAudioContext(1, mono.length, sampleRate);
  const buf = ctx.createBuffer(1, mono.length, sampleRate);
  buf.copyToChannel(mono, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node = src;
  if (lowFreq) {
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = lowFreq;
    hpf.Q.value = 0.7;
    node.connect(hpf);
    node = hpf;
  }
  if (highFreq) {
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = highFreq;
    lpf.Q.value = 0.7;
    node.connect(lpf);
    node = lpf;
  }
  node.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

function onsetsFromEnergy(data, sampleRate, threshFactor, minGapSec) {
  const FRAME = 512;
  const HOP = 256;
  const minGapFrames = Math.ceil((minGapSec * sampleRate) / HOP);

  const energies = [];
  for (let i = 0; i + FRAME <= data.length; i += HOP) {
    let e = 0;
    for (let j = 0; j < FRAME; j++) e += data[i + j] ** 2;
    energies.push(Math.sqrt(e / FRAME));
  }

  // Positive spectral flux — better onset sensitivity than raw energy
  const flux = energies.map((e, i) => (i > 0 ? Math.max(0, e - energies[i - 1]) : 0));

  const LOOKBACK = 20;
  const onsets = [];
  let lastFrame = -minGapFrames;

  for (let i = 2; i < flux.length - 1; i++) {
    const local = flux.slice(Math.max(0, i - LOOKBACK), i);
    const mean = local.reduce((s, v) => s + v, 0) / local.length;
    const std = Math.sqrt(local.reduce((s, v) => s + (v - mean) ** 2, 0) / local.length);
    const threshold = mean + threshFactor * std;
    if (
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] &&
      flux[i] >= flux[i + 1] &&
      i - lastFrame >= minGapFrames
    ) {
      onsets.push((i * HOP) / sampleRate);
      lastFrame = i;
    }
  }
  return onsets;
}

function renderDrumTab(parts, duration) {
  const BIN_SIZE = 0.05;
  const COLS_PER_LINE = 64;
  const partOrder = ['HH', 'SD', 'BD'];
  const totalCols = Math.ceil(duration / BIN_SIZE);

  const grids = {};
  for (const part of partOrder) {
    grids[part] = new Array(totalCols).fill(false);
    for (const t of (parts[part] || [])) {
      const col = Math.floor(t / BIN_SIZE);
      if (col >= 0 && col < totalCols) grids[part][col] = true;
    }
  }

  const lines = [];
  for (let lineStart = 0; lineStart < totalCols; lineStart += COLS_PER_LINE) {
    const lineEnd = Math.min(lineStart + COLS_PER_LINE, totalCols);
    for (const part of partOrder) {
      let row = `${part}|`;
      for (let c = lineStart; c < lineEnd; c++) row += grids[part][c] ? 'x' : '-';
      row += '|';
      lines.push(row);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const instrumentTypes = [
  { key: 'guitar', label: 'Guitar/Other', emoji: '🎸' },
  { key: 'bass',   label: 'Bass',         emoji: '🎵' },
  { key: 'drums',  label: 'Drums',        emoji: '🥁' },
  { key: 'vocals', label: 'Vocals',       emoji: '🎤' },
];

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState({ guitar: '', bass: '', drums: '', vocals: '' });
  const [isSeparated, setIsSeparated] = useState(false);
  const [tabText, setTabText] = useState('');
  const [tabProcessing, setTabProcessing] = useState(false);
  const [tabProgress, setTabProgress] = useState(0);
  const [tabError, setTabError] = useState('');
  const [guitarFileLabel, setGuitarFileLabel] = useState('');
  const [guitarDuration, setGuitarDuration] = useState(0);
  const [tabStartSec, setTabStartSec] = useState(0);
  const [tabEndSec, setTabEndSec] = useState(0);
  const [tabIsPlaying, setTabIsPlaying] = useState(false);
  const [tabDisplayTime, setTabDisplayTime] = useState(0);
  const [tabDuration, setTabDuration] = useState(0);

  const [activeTabSection, setActiveTabSection] = useState('guitar');

  // Drum tab
  const [drumTabText, setDrumTabText] = useState('');
  const [drumTabProcessing, setDrumTabProcessing] = useState(false);
  const [drumTabProgress, setDrumTabProgress] = useState(0);
  const [drumTabError, setDrumTabError] = useState('');
  const [drumFileLabel, setDrumFileLabel] = useState('');
  const [drumDuration, setDrumDuration] = useState(0);
  const [drumTabStartSec, setDrumTabStartSec] = useState(0);
  const [drumTabEndSec, setDrumTabEndSec] = useState(0);
  const [drumTabIsPlaying, setDrumTabIsPlaying] = useState(false);
  const [drumTabDisplayTime, setDrumTabDisplayTime] = useState(0);
  const [drumTabDuration, setDrumTabDuration] = useState(0);

  // Stem player
  const [activeStemKeys, setActiveStemKeys] = useState(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

  const tabSliceRef = useRef(null);
  const tabAudioBufRef = useRef(null);
  const tabCtxRef = useRef(null);
  const tabSrcRef = useRef(null);
  const tabRafRef = useRef(null);
  const tabScrubberRef = useRef(null);
  const tabPlayStartCtxRef = useRef(0);
  const tabPlayOffsetRef = useRef(0);
  const rangeRef = useRef(null);
  const draggingHandleRef = useRef(null);

  const drumStemRef = useRef(null);
  const drumTabSliceRef = useRef(null);
  const drumTabAudioBufRef = useRef(null);
  const drumTabCtxRef = useRef(null);
  const drumTabSrcRef = useRef(null);
  const drumTabRafRef = useRef(null);
  const drumTabScrubberRef = useRef(null);
  const drumTabPlayStartCtxRef = useRef(0);
  const drumTabPlayOffsetRef = useRef(0);
  const drumRangeRef = useRef(null);
  const drumDraggingHandleRef = useRef(null);

  const processorRef = useRef(null);
  const previousUrlsRef = useRef([]);
  const guitarStemRef = useRef(null);
  const sampleRateRef = useRef(44100);

  // Stem player refs
  const stemsDataRef = useRef({});
  const stemBuffersRef = useRef({});
  const stemDurationRef = useRef(0);
  const audioCtxRef = useRef(null);
  const sourceNodesRef = useRef([]);
  const playbackStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rafRef = useRef(null);
  const scrubberRef = useRef(null);
  const activeStemKeysRef = useRef(new Set());

  useEffect(() => {
    return () => {
      if (processorRef.current) processorRef.current.terminate?.();
      clearPreviousUrls();
      stopNodes();
      audioCtxRef.current?.close();
      stopTabNodes();
      tabCtxRef.current?.close();
      stopDrumTabNodes();
      drumTabCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (guitarDuration > 0) {
      setTabStartSec(0);
      setTabEndSec(guitarDuration);
    }
  }, [guitarDuration]);

  useEffect(() => {
    if (drumDuration > 0) {
      setDrumTabStartSec(0);
      setDrumTabEndSec(drumDuration);
    }
  }, [drumDuration]);

  const clearPreviousUrls = () => {
    previousUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previousUrlsRef.current = [];
  };

  const stopNodes = () => {
    sourceNodesRef.current.forEach((n) => { try { n.stop(); } catch {} });
    sourceNodesRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const resetPlayerState = () => {
    stopNodes();
    setIsPlaying(false);
    setDisplayTime(0);
    playOffsetRef.current = 0;
    if (scrubberRef.current) scrubberRef.current.value = '0';
  };

  const handleMainFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearPreviousUrls();
    resetPlayerState();
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioName(file.name);
    setAudioUrl(url);
    previousUrlsRef.current.push(url);
    setIsSeparated(false);
    setStems({ guitar: '', bass: '', drums: '', vocals: '' });
    guitarStemRef.current = null;
    stemsDataRef.current = {};
    stemBuffersRef.current = {};
    stemDurationRef.current = 0;
    setActiveStemKeys(new Set());
    activeStemKeysRef.current = new Set();
    setProgress(0);
  };

  const initializeWorker = () => {
    const worker = new Worker(separationWorkerUrl, { type: 'module' });
    return worker;
  };

  const createWavBlob = (left, right, sampleRate) => {
    console.log(`Creating WAV blob for audio length: ${left.length}`);
    const startTime = Date.now();

    const numChannels = 2;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + left.length * blockAlign);
    const view = new DataView(buffer);

    const writeString = (view2, offset, string) => {
      for (let i = 0; i < string.length; i += 1) {
        view2.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + left.length * blockAlign, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, left.length * blockAlign, true);

    let offset = 44;
    for (let i = 0; i < left.length; i += 1) {
      let sampleL = Math.max(-1, Math.min(1, left[i]));
      sampleL = sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff;
      view.setInt16(offset, sampleL, true);
      offset += 2;

      let sampleR = Math.max(-1, Math.min(1, right[i]));
      sampleR = sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff;
      view.setInt16(offset, sampleR, true);
      offset += 2;
    }

    const blob = new Blob([view], { type: 'audio/wav' });
    const elapsed = Date.now() - startTime;
    console.log(`WAV blob created in ${elapsed}ms (size: ${(blob.size / 1024 / 1024).toFixed(2)}MB)`);

    return blob;
  };

  const createStemUrl = (stem, sampleRate) => {
    if (!stem || !stem.left || !stem.right) {
      console.warn('Invalid stem data:', stem);
      return '';
    }
    try {
      const leftArray = stem.left instanceof Float32Array ? stem.left : new Float32Array(stem.left);
      const rightArray = stem.right instanceof Float32Array ? stem.right : new Float32Array(stem.right);

      const blob = createWavBlob(leftArray, rightArray, sampleRate);
      const url = URL.createObjectURL(blob);
      previousUrlsRef.current.push(url);
      return url;
    } catch (error) {
      console.error('Error creating stem URL:', error);
      throw error;
    }
  };

  const handleSeparate = async () => {
    if (!audioFile) return;
    setProcessing(true);
    setProgress(0);
    setIsSeparated(false);
    resetPlayerState();

    try {
      console.log('Starting separation...');
      setProgress(0.1);

      const arrayBuffer = await audioFile.arrayBuffer();
      console.log('Audio file loaded');
      setProgress(0.2);

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('Audio decoded');
      setProgress(0.3);

      const left = audioBuffer.numberOfChannels > 0
        ? audioBuffer.getChannelData(0)
        : new Float32Array(audioBuffer.length);
      const right = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : left;

      console.log('Starting processor.separate()...');
      setProgress(0.5);

      const result = await new Promise((resolve, reject) => {
        const worker = initializeWorker();

        const SEGMENT_TIMEOUT = 600000;
        let timeoutId = setTimeout(() => {
          reject(new Error('Separation timeout: no progress for 10 minutes'));
        }, SEGMENT_TIMEOUT);

        const resetTimeout = () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            reject(new Error('Separation timeout: no progress for 10 minutes'));
          }, SEGMENT_TIMEOUT);
        };

        const handleMessage = (event) => {
          const { type, result, error } = event.data;

          if (type === 'result') {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            resolve(result);
          } else if (type === 'error') {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            reject(new Error(error));
          } else if (type === 'segmentProgress') {
            resetTimeout();
            const { progress: segProg } = event.data;
            setProgress(0.5 + segProg * 0.4);
          } else if (type === 'status') {
            resetTimeout();
          } else if (type === 'downloadProgress') {
            resetTimeout();
          }
        };

        const handleError = (error) => {
          clearTimeout(timeoutId);
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          console.error(`Worker error event:`, error);
          reject(new Error(`Worker error: ${error.message || error}`));
        };

        console.log('Setting up worker listeners...');
        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        const leftArray = new Float32Array(left);
        const rightArray = new Float32Array(right);

        console.log(`Sending separate message to worker (left: ${leftArray.length}, right: ${rightArray.length})...`);
        worker.postMessage(
          { type: 'separate', data: { left: leftArray, right: rightArray } },
          [leftArray.buffer, rightArray.buffer]
        );
        console.log('Separate message sent with transferable buffers');
      });

      console.log('Separation complete, creating stem URLs...');
      setProgress(0.75);

      try {
        const sampleRate = audioBuffer.sampleRate;
        sampleRateRef.current = sampleRate;

        const stemUrls = {};
        for (const name of ['guitar', 'bass', 'drums', 'vocals']) {
          stemUrls[name] = createStemUrl(result[name], sampleRate);
        }

        // Store raw audio data for all stems for Web Audio playback
        stemsDataRef.current = {};
        stemBuffersRef.current = {};
        for (const name of ['guitar', 'bass', 'drums', 'vocals']) {
          stemsDataRef.current[name] = {
            left: result[name].left instanceof Float32Array ? result[name].left : new Float32Array(result[name].left),
            right: result[name].right instanceof Float32Array ? result[name].right : new Float32Array(result[name].right),
            sampleRate,
          };
        }
        stemDurationRef.current = stemsDataRef.current.guitar.left.length / sampleRate;

        guitarStemRef.current = {
          left: stemsDataRef.current.guitar.left,
          right: stemsDataRef.current.guitar.right,
          sampleRate,
        };
        setGuitarFileLabel('');
        setGuitarDuration(stemsDataRef.current.guitar.left.length / sampleRate);

        drumStemRef.current = {
          left: stemsDataRef.current.drums.left,
          right: stemsDataRef.current.drums.right,
          sampleRate,
        };
        setDrumFileLabel('');
        setDrumDuration(stemsDataRef.current.drums.left.length / sampleRate);

        const allKeys = new Set(['guitar', 'bass', 'drums', 'vocals']);
        setActiveStemKeys(allKeys);
        activeStemKeysRef.current = new Set(allKeys);

        setStems(stemUrls);
        setIsSeparated(true);
        setDisplayTime(0);
        playOffsetRef.current = 0;
        setProgress(1);
        console.log('UI updated, separation complete');
      } catch (wavError) {
        console.error('WAV creation error:', wavError);
        alert(`Failed to create WAV files: ${wavError.message}`);
      }
    } catch (error) {
      console.error('Separation error:', error);
      alert(`Separation failed: ${error.message || error}`);
    } finally {
      setProcessing(false);
      console.log('Separation process finished');
    }
  };

  const toggleStem = (key) => {
    if (isPlaying) {
      stopNodes();
      setIsPlaying(false);
    }
    setActiveStemKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      activeStemKeysRef.current = next;
      return next;
    });
  };

  const getOrCreateBuffer = (key, ctx) => {
    if (stemBuffersRef.current[key]) return stemBuffersRef.current[key];
    const d = stemsDataRef.current[key];
    if (!d) return null;
    const buf = ctx.createBuffer(2, d.left.length, d.sampleRate);
    buf.copyToChannel(d.left, 0);
    buf.copyToChannel(d.right, 1);
    stemBuffersRef.current[key] = buf;
    return buf;
  };

  const startPlayback = (offset = playOffsetRef.current) => {
    stopNodes();

    const activeKeys = [...activeStemKeysRef.current];
    if (activeKeys.length === 0) return;

    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
      stemBuffersRef.current = {};
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const nodes = [];
    for (const key of activeKeys) {
      const buf = getOrCreateBuffer(key, ctx);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      nodes.push(src);
    }

    if (nodes.length === 0) return;

    const startAt = ctx.currentTime + 0.05;
    nodes.forEach((n) => n.start(startAt, offset));
    sourceNodesRef.current = nodes;
    // playbackStartCtxTimeRef tracks the ctx time that corresponds to track position 0
    playbackStartCtxTimeRef.current = startAt - offset;

    const duration = stemDurationRef.current;
    const tick = () => {
      const t = Math.min(ctx.currentTime - playbackStartCtxTimeRef.current, duration);
      setDisplayTime(t);
      if (scrubberRef.current) scrubberRef.current.value = String(t);
      if (t < duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stopNodes();
        setIsPlaying(false);
        setDisplayTime(0);
        playOffsetRef.current = 0;
        if (scrubberRef.current) scrubberRef.current.value = '0';
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    setIsPlaying(true);
  };

  const pausePlayback = () => {
    const ctx = audioCtxRef.current;
    let offset = playOffsetRef.current;
    if (ctx) {
      offset = Math.min(ctx.currentTime - playbackStartCtxTimeRef.current, stemDurationRef.current);
      playOffsetRef.current = offset;
    }
    stopNodes();
    setIsPlaying(false);
    setDisplayTime(offset);
    if (scrubberRef.current) scrubberRef.current.value = String(offset);
  };

  const handleStop = () => {
    stopNodes();
    setIsPlaying(false);
    setDisplayTime(0);
    playOffsetRef.current = 0;
    if (scrubberRef.current) scrubberRef.current.value = '0';
  };

  const handleScrub = (e) => {
    const newTime = parseFloat(e.target.value);
    playOffsetRef.current = newTime;
    setDisplayTime(newTime);
    if (isPlaying) startPlayback(newTime);
  };

  const stopTabNodes = () => {
    try { tabSrcRef.current?.stop(); } catch {}
    tabSrcRef.current = null;
    if (tabRafRef.current) cancelAnimationFrame(tabRafRef.current);
    tabRafRef.current = null;
  };

  const startTabPlayback = (offset = tabPlayOffsetRef.current) => {
    stopTabNodes();
    const slice = tabSliceRef.current;
    if (!slice) return;

    if (!tabCtxRef.current || tabCtxRef.current.state === 'closed') {
      tabCtxRef.current = new AudioContext();
      tabAudioBufRef.current = null;
    }
    const ctx = tabCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    if (!tabAudioBufRef.current) {
      const buf = ctx.createBuffer(1, slice.mono.length, slice.sampleRate);
      buf.copyToChannel(slice.mono, 0);
      tabAudioBufRef.current = buf;
    }

    const src = ctx.createBufferSource();
    src.buffer = tabAudioBufRef.current;
    src.connect(ctx.destination);
    const startAt = ctx.currentTime + 0.05;
    src.start(startAt, offset);
    tabSrcRef.current = src;
    tabPlayStartCtxRef.current = startAt - offset;

    const duration = slice.duration;
    const tick = () => {
      const t = Math.min(ctx.currentTime - tabPlayStartCtxRef.current, duration);
      setTabDisplayTime(t);
      if (tabScrubberRef.current) tabScrubberRef.current.value = String(t);
      if (t < duration) {
        tabRafRef.current = requestAnimationFrame(tick);
      } else {
        stopTabNodes();
        setTabIsPlaying(false);
        setTabDisplayTime(0);
        tabPlayOffsetRef.current = 0;
        if (tabScrubberRef.current) tabScrubberRef.current.value = '0';
      }
    };
    tabRafRef.current = requestAnimationFrame(tick);
    setTabIsPlaying(true);
  };

  const pauseTabPlayback = () => {
    const ctx = tabCtxRef.current;
    let offset = tabPlayOffsetRef.current;
    if (ctx) {
      offset = Math.min(ctx.currentTime - tabPlayStartCtxRef.current, tabSliceRef.current?.duration || 0);
      tabPlayOffsetRef.current = offset;
    }
    stopTabNodes();
    setTabIsPlaying(false);
    setTabDisplayTime(offset);
    if (tabScrubberRef.current) tabScrubberRef.current.value = String(offset);
  };

  const handleTabStop = () => {
    stopTabNodes();
    setTabIsPlaying(false);
    setTabDisplayTime(0);
    tabPlayOffsetRef.current = 0;
    if (tabScrubberRef.current) tabScrubberRef.current.value = '0';
  };

  const handleTabScrub = (e) => {
    const newTime = parseFloat(e.target.value);
    tabPlayOffsetRef.current = newTime;
    setTabDisplayTime(newTime);
    if (tabIsPlaying) startTabPlayback(newTime);
  };

  // ── Drum tab player ─────────────────────────────────────────────

  const stopDrumTabNodes = () => {
    try { drumTabSrcRef.current?.stop(); } catch {}
    drumTabSrcRef.current = null;
    if (drumTabRafRef.current) cancelAnimationFrame(drumTabRafRef.current);
    drumTabRafRef.current = null;
  };

  const startDrumTabPlayback = (offset = drumTabPlayOffsetRef.current) => {
    stopDrumTabNodes();
    const slice = drumTabSliceRef.current;
    if (!slice) return;
    if (!drumTabCtxRef.current || drumTabCtxRef.current.state === 'closed') {
      drumTabCtxRef.current = new AudioContext();
      drumTabAudioBufRef.current = null;
    }
    const ctx = drumTabCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    if (!drumTabAudioBufRef.current) {
      const buf = ctx.createBuffer(1, slice.mono.length, slice.sampleRate);
      buf.copyToChannel(slice.mono, 0);
      drumTabAudioBufRef.current = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = drumTabAudioBufRef.current;
    src.connect(ctx.destination);
    const startAt = ctx.currentTime + 0.05;
    src.start(startAt, offset);
    drumTabSrcRef.current = src;
    drumTabPlayStartCtxRef.current = startAt - offset;
    const duration = slice.duration;
    const tick = () => {
      const t = Math.min(ctx.currentTime - drumTabPlayStartCtxRef.current, duration);
      setDrumTabDisplayTime(t);
      if (drumTabScrubberRef.current) drumTabScrubberRef.current.value = String(t);
      if (t < duration) {
        drumTabRafRef.current = requestAnimationFrame(tick);
      } else {
        stopDrumTabNodes();
        setDrumTabIsPlaying(false);
        setDrumTabDisplayTime(0);
        drumTabPlayOffsetRef.current = 0;
        if (drumTabScrubberRef.current) drumTabScrubberRef.current.value = '0';
      }
    };
    drumTabRafRef.current = requestAnimationFrame(tick);
    setDrumTabIsPlaying(true);
  };

  const pauseDrumTabPlayback = () => {
    const ctx = drumTabCtxRef.current;
    let offset = drumTabPlayOffsetRef.current;
    if (ctx) {
      offset = Math.min(ctx.currentTime - drumTabPlayStartCtxRef.current, drumTabSliceRef.current?.duration || 0);
      drumTabPlayOffsetRef.current = offset;
    }
    stopDrumTabNodes();
    setDrumTabIsPlaying(false);
    setDrumTabDisplayTime(offset);
    if (drumTabScrubberRef.current) drumTabScrubberRef.current.value = String(offset);
  };

  const handleDrumTabStop = () => {
    stopDrumTabNodes();
    setDrumTabIsPlaying(false);
    setDrumTabDisplayTime(0);
    drumTabPlayOffsetRef.current = 0;
    if (drumTabScrubberRef.current) drumTabScrubberRef.current.value = '0';
  };

  const handleDrumTabScrub = (e) => {
    const t = parseFloat(e.target.value);
    drumTabPlayOffsetRef.current = t;
    setDrumTabDisplayTime(t);
    if (drumTabIsPlaying) startDrumTabPlayback(t);
  };

  // ── Drum range selector ──────────────────────────────────────────

  const handleDrumRangePointerDown = (e) => {
    const handle = e.target.closest('[data-handle]');
    if (!handle) return;
    drumDraggingHandleRef.current = handle.dataset.handle;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDrumRangePointerMove = (e) => {
    if (!drumDraggingHandleRef.current || !drumRangeRef.current) return;
    const rect = drumRangeRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * drumDuration;
    if (drumDraggingHandleRef.current === 'start') {
      setDrumTabStartSec(Math.min(time, drumTabEndSec - 0.5));
    } else {
      setDrumTabEndSec(Math.max(time, drumTabStartSec + 0.5));
    }
  };

  const handleDrumRangePointerUp = () => { drumDraggingHandleRef.current = null; };

  // ── Drum file upload ─────────────────────────────────────────────

  const handleDrumFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDrumTabText('');
    setDrumTabError('');
    setDrumTabDuration(0);
    drumTabSliceRef.current = null;
    drumTabAudioBufRef.current = null;
    stopDrumTabNodes();
    setDrumTabIsPlaying(false);
    setDrumTabDisplayTime(0);
    drumTabPlayOffsetRef.current = 0;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const left = audioBuffer.numberOfChannels > 0 ? audioBuffer.getChannelData(0) : new Float32Array(audioBuffer.length);
      const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
      drumStemRef.current = {
        left: new Float32Array(left),
        right: new Float32Array(right),
        sampleRate: audioBuffer.sampleRate,
      };
      setDrumFileLabel(file.name);
      setDrumDuration(audioBuffer.duration);
    } catch (err) {
      setDrumTabError(`Could not decode audio file: ${err.message}`);
    }
  };

  // ── Drum tab detection ───────────────────────────────────────────

  const detectDrumTab = async () => {
    const stemData = drumStemRef.current;
    if (!stemData) return;
    setDrumTabProcessing(true);
    setDrumTabProgress(0);
    setDrumTabError('');
    setDrumTabText('');
    try {
      const { left, right, sampleRate } = stemData;
      const fullDuration = left.length / sampleRate;
      const startSec = Math.max(0, drumTabStartSec);
      const endSec = Math.min(fullDuration, drumTabEndSec > 0 ? drumTabEndSec : fullDuration);
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.floor(endSec * sampleRate);

      const mono = new Float32Array(endSample - startSample);
      for (let i = startSample; i < endSample; i++) {
        mono[i - startSample] = (left[i] + right[i]) / 2;
      }

      stopDrumTabNodes();
      drumTabSliceRef.current = { mono: new Float32Array(mono), sampleRate, duration: mono.length / sampleRate };
      drumTabAudioBufRef.current = null;
      setDrumTabDuration(mono.length / sampleRate);
      setDrumTabIsPlaying(false);
      setDrumTabDisplayTime(0);
      drumTabPlayOffsetRef.current = 0;
      if (drumTabScrubberRef.current) drumTabScrubberRef.current.value = '0';

      const parts = {};
      for (let pi = 0; pi < DRUM_PARTS.length; pi++) {
        const { key, lowFreq, highFreq, threshFactor, minGap } = DRUM_PARTS[pi];
        setDrumTabProgress((pi + 0.5) / DRUM_PARTS.length);
        const filtered = await filterBand(mono, sampleRate, lowFreq, highFreq);
        parts[key] = onsetsFromEnergy(filtered, sampleRate, threshFactor, minGap);
      }
      setDrumTabProgress(1);

      const allEmpty = Object.values(parts).every((v) => v.length === 0);
      if (allEmpty) {
        setDrumTabError('No drum hits detected. Try a shorter or louder segment.');
      } else {
        setDrumTabText(renderDrumTab(parts, mono.length / sampleRate));
      }
    } catch (err) {
      console.error('Drum tab error:', err);
      setDrumTabError(`Detection failed: ${err.message}`);
    } finally {
      setDrumTabProcessing(false);
    }
  };

  const handleRangePointerDown = (e) => {
    const handle = e.target.closest('[data-handle]');
    if (!handle) return;
    draggingHandleRef.current = handle.dataset.handle;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleRangePointerMove = (e) => {
    if (!draggingHandleRef.current || !rangeRef.current) return;
    const rect = rangeRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * guitarDuration;
    if (draggingHandleRef.current === 'start') {
      setTabStartSec(Math.min(time, tabEndSec - 0.5));
    } else {
      setTabEndSec(Math.max(time, tabStartSec + 0.5));
    }
  };

  const handleRangePointerUp = () => {
    draggingHandleRef.current = null;
  };

  const handleGuitarFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTabText('');
    setTabError('');
    setTabDuration(0);
    tabSliceRef.current = null;
    tabAudioBufRef.current = null;
    stopTabNodes();
    setTabIsPlaying(false);
    setTabDisplayTime(0);
    tabPlayOffsetRef.current = 0;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const left = audioBuffer.numberOfChannels > 0
        ? audioBuffer.getChannelData(0)
        : new Float32Array(audioBuffer.length);
      const right = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : left;
      guitarStemRef.current = {
        left: new Float32Array(left),
        right: new Float32Array(right),
        sampleRate: audioBuffer.sampleRate,
      };
      setGuitarFileLabel(file.name);
      setGuitarDuration(audioBuffer.duration);
    } catch (err) {
      setTabError(`Could not decode audio file: ${err.message}`);
    }
  };

  const detectTab = async () => {
    const stemData = guitarStemRef.current;
    if (!stemData) return;

    setTabProcessing(true);
    setTabProgress(0);
    setTabError('');
    setTabText('');

    try {
      const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');

      const { left, right, sampleRate } = stemData;
      const fullDuration = left.length / sampleRate;
      const startSec = Math.max(0, tabStartSec);
      const endSec = Math.min(fullDuration, tabEndSec > 0 ? tabEndSec : fullDuration);
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.floor(endSec * sampleRate);

      const mono = new Float32Array(endSample - startSample);
      for (let i = startSample; i < endSample; i++) {
        mono[i - startSample] = (left[i] + right[i]) / 2;
      }

      // Store slice for the tab player
      stopTabNodes();
      tabSliceRef.current = { mono: new Float32Array(mono), sampleRate, duration: mono.length / sampleRate };
      tabAudioBufRef.current = null;
      setTabDuration(mono.length / sampleRate);
      setTabIsPlaying(false);
      setTabDisplayTime(0);
      tabPlayOffsetRef.current = 0;
      if (tabScrubberRef.current) tabScrubberRef.current.value = '0';

      const audioCtx = new AudioContext();
      const inputBuffer = audioCtx.createBuffer(1, mono.length, sampleRate);
      inputBuffer.copyToChannel(mono, 0);

      const targetSampleRate = 22050;
      const targetLength = Math.floor(mono.length * targetSampleRate / sampleRate);
      const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = inputBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const resampledBuffer = await offlineCtx.startRendering();

      const MODEL_URL = `${location.origin}/basic-pitch-model/model.json`;
      const basicPitch = new BasicPitch(MODEL_URL);

      const frames = [];
      const onsets = [];
      const contours = [];

      await basicPitch.evaluateModel(
        resampledBuffer,
        (f, o, c) => {
          frames.push(...f);
          onsets.push(...o);
          contours.push(...c);
        },
        (progress) => setTabProgress(progress),
      );

      const MIN_NOTE_DURATION = 0.1;
      const notes = outputToNotesPoly(
        frames, onsets,
        0.5,   // onset threshold (was 0.65)
        0.3,   // frame threshold (was 0.5)
        MIN_NOTE_DURATION,
        true,
        1320,
        80,
      );
      const notesTimed = noteFramesToTime(notes);
      const filtered = notesTimed.filter((n) => n.amplitude >= 0.35);

      if (filtered.length === 0) {
        setTabError('No guitar notes detected above confidence threshold.');
      } else {
        setTabText(renderAsciiTab(filtered));
      }
    } catch (err) {
      console.error('Tab detection error:', err);
      setTabError(`Tab detection failed: ${err.message}`);
    } finally {
      setTabProcessing(false);
    }
  };

  const activeStemLabels = [...activeStemKeys]
    .map((k) => instrumentTypes.find((i) => i.key === k)?.label)
    .filter(Boolean)
    .join(' + ');

  return (
    <div className="app-shell">
      <header>
        <h1>KAPPA</h1>
        <p>Split any song into stems, play them back, and generate guitar & drum tabs — all offline in your browser.</p>
      </header>

      <section className="card">
        <h2>Audio source</h2>
        {!audioName ? (
          <label className="upload-zone">
            <div className="upload-icon">🎵</div>
            <div className="upload-text">Tap to load audio</div>
            <div className="upload-hint">MP3, WAV, FLAC…</div>
            <input type="file" accept="audio/*" onChange={handleMainFile} />
          </label>
        ) : (
          <div className="file-loaded">
            <div className="file-name">📄 {audioName}</div>
            <audio controls src={audioUrl} />
          </div>
        )}

        {audioName && (
          <button type="button" onClick={handleSeparate} disabled={!audioFile || processing}>
            {processing ? 'Separating…' : 'Separate Stems'}
          </button>
        )}

        {(processing || isSeparated) && (
          <div className="progress-row">
            <div className="progress-bar-bg">
              <div className={`progress-bar-fill${processing ? ' active' : ''}`} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        )}
      </section>

      {processing && (
        <section className="card">
          <div className="waveform-animation">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${((i * 0.09) % 0.45).toFixed(2)}s` }} />
            ))}
          </div>
          <p className="processing-status">Separating stems…</p>
          {instrumentTypes.map(({ key, label, emoji }) => (
            <div key={key} className="skeleton-card">
              <div className="skeleton-icon" />
              <div className="skeleton-lines">
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            </div>
          ))}
          <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>First run downloads ~172 MB model.</p>
        </section>
      )}

      {isSeparated && (
        <section className="card">
          <h2>Stem Player</h2>
          <p>Toggle stems to include in playback, then press Play. Download individual stems below each chip.</p>

          <div className="stem-chips">
            {instrumentTypes.map(({ key, label, emoji }) => (
              <div key={key} className="stem-chip-item">
                <button
                  type="button"
                  className={`stem-chip${activeStemKeys.has(key) ? ' active' : ''}`}
                  onClick={() => toggleStem(key)}
                >
                  <span className="stem-chip-label">
                    <span className="stem-chip-emoji">{emoji}</span>
                    {label}
                  </span>
                  <span className="stem-toggle-track">
                    <span className="stem-toggle-dot" />
                  </span>
                </button>
                <a
                  href={stems[key]}
                  download={`${audioName.replace(/\.[^.]+$/, '')}-${key}.wav`}
                  className="stem-download"
                  title={`Download ${label}`}
                >
                  ⬇
                </a>
              </div>
            ))}
          </div>

          <div className="stem-scrubber-row">
            <span className="stem-time">{formatTime(displayTime)}</span>
            <input
              ref={scrubberRef}
              type="range"
              className="stem-scrubber"
              min="0"
              max={stemDurationRef.current || 1}
              step="0.1"
              defaultValue="0"
              onChange={handleScrub}
            />
            <span className="stem-time stem-time-right">{formatTime(stemDurationRef.current)}</span>
          </div>

          <div className="stem-playback-controls">
            {isPlaying ? (
              <button type="button" onClick={pausePlayback}>⏸ Pause</button>
            ) : (
              <button
                type="button"
                onClick={() => startPlayback()}
                disabled={activeStemKeys.size === 0}
              >
                ▶ Play
              </button>
            )}
            <button type="button" className="btn-stop" onClick={handleStop}>⏹ Stop</button>
            {activeStemKeys.size > 0 ? (
              <span className="hint">{activeStemLabels}</span>
            ) : (
              <span className="hint">Select at least one stem to play.</span>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <div className="tab-nav">
          <button
            type="button"
            className={`tab-nav-btn${activeTabSection === 'guitar' ? ' active' : ''}`}
            onClick={() => setActiveTabSection('guitar')}
          >
            🎸 Guitar Tab
          </button>
          <button
            type="button"
            className={`tab-nav-btn${activeTabSection === 'drums' ? ' active' : ''}`}
            onClick={() => setActiveTabSection('drums')}
          >
            🥁 Drum Tab
          </button>
        </div>

        {activeTabSection === 'guitar' && <>
        <p style={{ marginBottom: 14 }}>Detect notes and generate an ASCII tab from a guitar stem.</p>

        <p style={{ marginBottom: 10 }}>Upload a pre-separated guitar file</p>
        <label className="guitar-zone">
          <div className="guitar-zone-icon">🎸</div>
          {guitarFileLabel ? (
            <div className="guitar-zone-filename">{guitarFileLabel}</div>
          ) : (
            <>
              <div className="guitar-zone-text">Tap to choose</div>
              <div className="guitar-zone-hint">MP3 · WAV · FLAC</div>
            </>
          )}
          <input type="file" accept="audio/*" onChange={handleGuitarFile} />
        </label>

        {!guitarFileLabel && guitarStemRef.current && (
          <p className="hint">Using guitar stem from separation</p>
        )}

        {guitarDuration > 0 && (
          <div
            className="range-selector"
            ref={rangeRef}
            onPointerDown={handleRangePointerDown}
            onPointerMove={handleRangePointerMove}
            onPointerUp={handleRangePointerUp}
          >
            <div className="range-track">
              <div
                className="range-fill"
                style={{
                  left: `${(tabStartSec / guitarDuration) * 100}%`,
                  width: `${((tabEndSec - tabStartSec) / guitarDuration) * 100}%`,
                }}
              />
            </div>
            <div
              className="range-handle"
              data-handle="start"
              style={{ left: `${(tabStartSec / guitarDuration) * 100}%` }}
            />
            <div
              className="range-handle"
              data-handle="end"
              style={{ left: `${(tabEndSec / guitarDuration) * 100}%` }}
            />
            <div className="range-times">
              <span>{formatTime(tabStartSec)}</span>
              <span>{formatTime(tabEndSec)}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={detectTab}
          disabled={tabProcessing || !guitarStemRef.current}
        >
          {tabProcessing ? 'Detecting...' : 'Detect Guitar Tab'}
        </button>

        {tabProcessing && (
          <div className="progress-row">
            <div className="progress-bar-bg">
              <div
                className={`progress-bar-fill${tabProcessing ? ' active' : ''}`}
                style={{ width: `${Math.round(tabProgress * 100)}%` }}
              />
            </div>
            <span>{Math.round(tabProgress * 100)}%</span>
          </div>
        )}

        {tabError && <p className="hint" style={{ color: '#e53e3e' }}>{tabError}</p>}

        {tabDuration > 0 && (
          <div className="tab-player">
            <div className="tab-player-title">Guitar segment</div>
            <div className="stem-scrubber-row">
              <span className="stem-time">{formatTime(tabDisplayTime)}</span>
              <input
                ref={tabScrubberRef}
                type="range"
                className="stem-scrubber"
                min="0"
                max={tabDuration || 1}
                step="0.1"
                defaultValue="0"
                onChange={handleTabScrub}
              />
              <span className="stem-time stem-time-right">{formatTime(tabDuration)}</span>
            </div>
            <div className="stem-playback-controls">
              {tabIsPlaying ? (
                <button type="button" onClick={pauseTabPlayback}>⏸</button>
              ) : (
                <button type="button" onClick={() => startTabPlayback()}>▶</button>
              )}
              <button type="button" className="btn-stop" onClick={handleTabStop}>⏹</button>
            </div>
          </div>
        )}

        {tabText && (
          <div className="tab-display">
            <button
              type="button"
              className="tab-copy-btn"
              onClick={() => navigator.clipboard.writeText(tabText)}
            >
              Copy Tab
            </button>
            <pre className="tab-pre">{tabText}</pre>
          </div>
        )}
        </>}

        {activeTabSection === 'drums' && <>
        <p style={{ marginBottom: 14 }}>Detect bass drum, snare, and hi-hat hits from a drum stem.</p>

        <p style={{ marginBottom: 10 }}>Upload a pre-separated drum file</p>
        <label className="guitar-zone">
          <div className="guitar-zone-icon">🥁</div>
          {drumFileLabel ? (
            <div className="guitar-zone-filename">{drumFileLabel}</div>
          ) : (
            <>
              <div className="guitar-zone-text">Tap to choose</div>
              <div className="guitar-zone-hint">MP3 · WAV · FLAC</div>
            </>
          )}
          <input type="file" accept="audio/*" onChange={handleDrumFile} />
        </label>

        {!drumFileLabel && drumStemRef.current && (
          <p className="hint">Using drum stem from separation</p>
        )}

        {drumDuration > 0 && (
          <div
            className="range-selector"
            ref={drumRangeRef}
            onPointerDown={handleDrumRangePointerDown}
            onPointerMove={handleDrumRangePointerMove}
            onPointerUp={handleDrumRangePointerUp}
          >
            <div className="range-track">
              <div
                className="range-fill"
                style={{
                  left: `${(drumTabStartSec / drumDuration) * 100}%`,
                  width: `${((drumTabEndSec - drumTabStartSec) / drumDuration) * 100}%`,
                }}
              />
            </div>
            <div className="range-handle" data-handle="start" style={{ left: `${(drumTabStartSec / drumDuration) * 100}%` }} />
            <div className="range-handle" data-handle="end" style={{ left: `${(drumTabEndSec / drumDuration) * 100}%` }} />
            <div className="range-times">
              <span>{formatTime(drumTabStartSec)}</span>
              <span>{formatTime(drumTabEndSec)}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={detectDrumTab}
          disabled={drumTabProcessing || !drumStemRef.current}
        >
          {drumTabProcessing ? 'Detecting…' : 'Detect Drum Tab'}
        </button>

        {drumTabProcessing && (
          <div className="progress-row">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill active" style={{ width: `${Math.round(drumTabProgress * 100)}%` }} />
            </div>
            <span>{Math.round(drumTabProgress * 100)}%</span>
          </div>
        )}

        {drumTabError && <p className="hint" style={{ color: '#e53e3e' }}>{drumTabError}</p>}

        {drumTabDuration > 0 && (
          <div className="tab-player">
            <div className="tab-player-title">Drum segment</div>
            <div className="stem-scrubber-row">
              <span className="stem-time">{formatTime(drumTabDisplayTime)}</span>
              <input
                ref={drumTabScrubberRef}
                type="range"
                className="stem-scrubber"
                min="0"
                max={drumTabDuration || 1}
                step="0.1"
                defaultValue="0"
                onChange={handleDrumTabScrub}
              />
              <span className="stem-time stem-time-right">{formatTime(drumTabDuration)}</span>
            </div>
            <div className="stem-playback-controls">
              {drumTabIsPlaying ? (
                <button type="button" onClick={pauseDrumTabPlayback}>⏸</button>
              ) : (
                <button type="button" onClick={() => startDrumTabPlayback()}>▶</button>
              )}
              <button type="button" className="btn-stop" onClick={handleDrumTabStop}>⏹</button>
            </div>
          </div>
        )}

        {drumTabText && (
          <div className="tab-display">
            <button
              type="button"
              className="tab-copy-btn"
              onClick={() => navigator.clipboard.writeText(drumTabText)}
            >
              Copy Tab
            </button>
            <pre className="tab-pre">{drumTabText}</pre>
          </div>
        )}
        </>}
      </section>
    </div>
  );
}

export default App;

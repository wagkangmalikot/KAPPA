import { useEffect, useRef, useState } from 'react';
import separationWorkerUrl from './separationWorker.js?worker&url';
import { notesToTab, SUBDIVISIONS } from './tabGenerator';
import { useTabStore } from './tabStore';
import { StringSelector } from './components/StringSelector';
import { TransportBar } from './components/TransportBar';
import { TabTimeline } from './components/TabTimeline';
import { TabGrid } from './components/TabGrid';
import { ChordSheet } from './components/ChordSheet';
import { useTabAudio } from './hooks/useTabAudio';

// ── IndexedDB stem cache ─────────────────────────────────────────
const DB_NAME = 'kappa-stems-cache';
const STORE_NAME = 'stems';

const openCacheDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
  req.onsuccess = (e) => resolve(e.target.result);
  req.onerror = (e) => reject(e.target.error);
});

const getCacheKey = (file) => `${file.name}__${file.size}__${file.lastModified}`;

const loadStemsFromCache = async (file) => {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(getCacheKey(file));
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
};

const saveStemsToCache = async (file, data) => {
  try {
    const db = await openCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, getCacheKey(file));
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch { /* non-fatal */ }
};

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
  const [fromCache, setFromCache] = useState(false);
  const [stems, setStems] = useState({ guitar: '', bass: '', drums: '', vocals: '' });
  const [isSeparated, setIsSeparated] = useState(false);
  const [tabProcessing, setTabProcessing] = useState(false);
  const [tabProgress, setTabProgress] = useState(0);
  const [tabError, setTabError] = useState('');
  const { seekTo: tabSeekTo } = useTabAudio();
  const { clearTab } = useTabStore();
  const leadIsEmpty   = useTabStore(s => s.leadTab.every(r => r.every(c => c === null)));
  const rhythmIsEmpty = useTabStore(s => s.rhythmTab.every(r => r.every(c => c === null)));
  const [guitarFileLabel, setGuitarFileLabel] = useState('');
  const [guitarDuration, setGuitarDuration] = useState(0);
  const [tabStartSec, setTabStartSec] = useState(0);
  const [tabEndSec, setTabEndSec] = useState(0);
  const [tabIsPlaying, setTabIsPlaying] = useState(false);
  const [tabDisplayTime, setTabDisplayTime] = useState(0);
  const [tabDuration, setTabDuration] = useState(0);

  const [activeTabSection, setActiveTabSection] = useState('stems');
  const [tabView, setTabView] = useState('both');

  // Lyrics
  const [lyricsLines, setLyricsLines] = useState([]);
  const [lyricsQuery, setLyricsQuery] = useState('');
  const [lyricsSearching, setLyricsSearching] = useState(false);
  const [lyricsDetecting, setLyricsDetecting] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState('');
  const [lyricsError, setLyricsError] = useState('');
  const [lyricsSource, setLyricsSource] = useState('');

  // Chord detection
  const [chordResults, setChordResults] = useState([]);
  const [chordProcessing, setChordProcessing] = useState(false);
  const [chordProgress, setChordProgress] = useState(0);
  const [chordError, setChordError] = useState('');
  const [chordFileLabel, setChordFileLabel] = useState('');
  const [chordDuration, setChordDuration] = useState(0);
  const [chordStartSec, setChordStartSec] = useState(0);
  const [chordEndSec, setChordEndSec] = useState(0);

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

  const lyricsWorkerRef = useRef(null);
  const chordStemRef = useRef(null);
  const chordRangeRef = useRef(null);
  const chordDraggingRef = useRef(null);

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
    };
  }, []);

  useEffect(() => {
    if (guitarDuration > 0) {
      setTabStartSec(0);
      setTabEndSec(guitarDuration);
    }
  }, [guitarDuration]);

  useEffect(() => {
    const dur = chordDuration > 0 ? chordDuration : guitarDuration;
    if (dur > 0) {
      setChordStartSec(0);
      setChordEndSec(dur);
    }
  }, [chordDuration, guitarDuration]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__setChordResults = setChordResults;
  }, []);

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

  const handleMainFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearPreviousUrls();
    resetPlayerState();
    stopTabNodes();
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioName(file.name);
    setAudioUrl(url);
    previousUrlsRef.current.push(url);
    setIsSeparated(false);
    setFromCache(false);
    setStems({ guitar: '', bass: '', drums: '', vocals: '' });
    guitarStemRef.current = null;
    chordStemRef.current = null;
    stemsDataRef.current = {};
    stemBuffersRef.current = {};
    stemDurationRef.current = 0;
    setActiveStemKeys(new Set());
    activeStemKeysRef.current = new Set();
    setProgress(0);
    // Reset guitar tab / chord state
    setGuitarDuration(0);
    setTabDuration(0);
    tabSliceRef.current = null;
    tabAudioBufRef.current = null;
    setTabIsPlaying(false);
    setTabDisplayTime(0);
    tabPlayOffsetRef.current = 0;
    setChordDuration(0);
    setChordResults([]);
    // Auto-decode the file so Guitar Tab and Chords tabs get audio immediately
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await audioContext.close();
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : audioBuffer.getChannelData(0);
      const monoFull = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) monoFull[i] = (left[i] + right[i]) / 2;
      const stemData = {
        left: new Float32Array(left),
        right: new Float32Array(right),
        sampleRate: audioBuffer.sampleRate,
      };
      guitarStemRef.current = stemData;
      chordStemRef.current = stemData;
      tabSliceRef.current = { mono: monoFull, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration };
      setGuitarDuration(audioBuffer.duration);
      setTabDuration(audioBuffer.duration);
    } catch (err) {
      console.error('Could not pre-decode audio:', err);
    }
  };

  const handleReset = () => {
    clearPreviousUrls();
    resetPlayerState();
    stopTabNodes();
    audioCtxRef.current?.close();
    setAudioFile(null);
    setAudioName('');
    setAudioUrl('');
    setIsSeparated(false);
    setFromCache(false);
    setProcessing(false);
    setProgress(0);
    setStems({ guitar: '', bass: '', drums: '', vocals: '' });
    guitarStemRef.current = null;
    stemsDataRef.current = {};
    stemBuffersRef.current = {};
    stemDurationRef.current = 0;
    setActiveStemKeys(new Set());
    activeStemKeysRef.current = new Set();
    setGuitarFileLabel('');
    setGuitarDuration(0);
    setTabStartSec(0);
    setTabEndSec(0);
    setTabIsPlaying(false);
    setTabDisplayTime(0);
    setTabDuration(0);
    tabSliceRef.current = null;
    tabAudioBufRef.current = null;
    tabPlayOffsetRef.current = 0;
    setTabProcessing(false);
    setTabProgress(0);
    setTabError('');
    setChordResults([]);
    setChordProcessing(false);
    setChordProgress(0);
    setChordError('');
    setChordFileLabel('');
    setChordDuration(0);
    setChordStartSec(0);
    setChordEndSec(0);
    chordStemRef.current = null;
    setLyricsLines([]);
    setLyricsQuery('');
    setLyricsStatus('');
    setLyricsError('');
    setLyricsSource('');
    clearTab();
  };

  const initializeWorker = () => {
    const worker = new Worker(separationWorkerUrl, { type: 'module' });
    return worker;
  };

  const createWavBlob = (left, right, sampleRate) => {
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

    return new Blob([view], { type: 'audio/wav' });
  };

  const createStemUrl = (stem, sampleRate) => {
    if (!stem || !stem.left || !stem.right) return '';
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

  const applyStemResult = (result, sampleRate) => {
    sampleRateRef.current = sampleRate;

    const stemUrls = {};
    for (const name of ['guitar', 'bass', 'drums', 'vocals']) {
      stemUrls[name] = createStemUrl(result[name], sampleRate);
    }

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

    const allKeys = new Set(['guitar', 'bass', 'drums', 'vocals']);
    setActiveStemKeys(allKeys);
    activeStemKeysRef.current = new Set(allKeys);

    setStems(stemUrls);
    setIsSeparated(true);
    setDisplayTime(0);
    playOffsetRef.current = 0;
    setProgress(1);
  };

  const handleSeparate = async () => {
    if (!audioFile) return;
    setProcessing(true);
    setFromCache(false);
    setProgress(0);
    setIsSeparated(false);
    resetPlayerState();

    try {
      const cached = await loadStemsFromCache(audioFile);
      if (cached) {
        setFromCache(true);
        setProgress(1);
        applyStemResult(cached, cached.sampleRate);
        return;
      }

      setProgress(0.1);
      const arrayBuffer = await audioFile.arrayBuffer();
      setProgress(0.2);

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setProgress(0.3);

      const left = audioBuffer.numberOfChannels > 0
        ? audioBuffer.getChannelData(0)
        : new Float32Array(audioBuffer.length);
      const right = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : left;

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
            setProgress(0.5 + event.data.progress * 0.4);
          } else if (type === 'status' || type === 'downloadProgress') {
            resetTimeout();
          }
        };

        const handleError = (error) => {
          clearTimeout(timeoutId);
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          reject(new Error(`Worker error: ${error.message || error}`));
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        const leftArray = new Float32Array(left);
        const rightArray = new Float32Array(right);
        worker.postMessage(
          { type: 'separate', data: { left: leftArray, right: rightArray } },
          [leftArray.buffer, rightArray.buffer]
        );
      });

      setProgress(0.75);

      try {
        const sampleRate = audioBuffer.sampleRate;
        applyStemResult(result, sampleRate);
        saveStemsToCache(audioFile, {
          sampleRate,
          guitar: { left: stemsDataRef.current.guitar.left, right: stemsDataRef.current.guitar.right },
          bass:   { left: stemsDataRef.current.bass.left,   right: stemsDataRef.current.bass.right   },
          drums:  { left: stemsDataRef.current.drums.left,  right: stemsDataRef.current.drums.right  },
          vocals: { left: stemsDataRef.current.vocals.left, right: stemsDataRef.current.vocals.right },
        });
      } catch (wavError) {
        alert(`Failed to create WAV files: ${wavError.message}`);
      }
    } catch (error) {
      console.error('Separation error:', error);
      alert(`Separation failed: ${error.message || error}`);
    } finally {
      setProcessing(false);
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
    playbackStartCtxTimeRef.current = startAt - offset;

    const duration = stemDurationRef.current;
    const tick = () => {
      const t = Math.min(ctx.currentTime - playbackStartCtxTimeRef.current, duration);
      setDisplayTime(t);
      if (scrubberRef.current) scrubberRef.current.value = String(t);
      // Sync tab timeline playhead with stem playback time
      const { bpm: sBpm, totalBeats: sTotalBeats, setPlayheadBeat } = useTabStore.getState();
      const tabRelT = t - tabStartSec;
      if (sTotalBeats > 0 && tabRelT >= 0) {
        const beat = Math.min(sTotalBeats - 1, Math.floor(tabRelT * ((sBpm || 120) / 60) * SUBDIVISIONS));
        setPlayheadBeat(beat);
      }
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
      const { bpm, totalBeats, setPlayheadBeat } = useTabStore.getState();
      const beat = Math.min(totalBeats - 1, Math.floor(t * ((bpm || 120) / 60) * SUBDIVISIONS));
      if (beat >= 0) setPlayheadBeat(beat);
      if (t < duration) {
        tabRafRef.current = requestAnimationFrame(tick);
      } else {
        stopTabNodes();
        setTabIsPlaying(false);
        setTabDisplayTime(0);
        tabPlayOffsetRef.current = 0;
        if (tabScrubberRef.current) tabScrubberRef.current.value = '0';
        useTabStore.getState().setPlayheadBeat(0);
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
    const { bpm, totalBeats, setPlayheadBeat } = useTabStore.getState();
    const beat = Math.min(totalBeats - 1, Math.max(0, Math.floor(newTime * ((bpm || 120) / 60) * SUBDIVISIONS)));
    setPlayheadBeat(beat);
    if (tabIsPlaying) startTabPlayback(newTime);
  };

  // ── Lyrics ──────────────────────────────────────────────────────

  function parseLRC(text) {
    const lines = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^\[(\d{1,2}):(\d{2}(?:\.\d+)?)\](.*)/);
      if (!m) continue;
      const start = parseInt(m[1]) * 60 + parseFloat(m[2]);
      const str = m[3].trim();
      if (str) lines.push({ text: str, start, end: null });
    }
    for (let i = 0; i < lines.length - 1; i++) lines[i].end = lines[i + 1].start;
    if (lines.length) lines[lines.length - 1].end = lines[lines.length - 1].start + 4;
    return lines;
  }

  function wordsToLines(words) {
    const lines = [];
    let cur = null;
    for (const w of words) {
      if (!cur) {
        cur = { text: w.word, start: w.start, end: w.end };
      } else if (w.start - cur.end > 0.8) {
        lines.push(cur);
        cur = { text: w.word, start: w.start, end: w.end };
      } else {
        cur.text += ' ' + w.word;
        cur.end = w.end;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const searchLyrics = async () => {
    const q = lyricsQuery.trim();
    if (!q) return;
    setLyricsSearching(true);
    setLyricsError('');
    setLyricsLines([]);
    setLyricsSource('');
    try {
      const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`LRClib ${res.status}`);
      const results = await res.json();
      const match = results.find(r => r.syncedLyrics);
      if (!match) {
        setLyricsError('No synced lyrics found on LRClib. Try a different title or detect from audio below.');
        return;
      }
      const lines = parseLRC(match.syncedLyrics);
      setLyricsLines(lines);
      setLyricsSource(`"${match.trackName}" by ${match.artistName} (LRClib)`);
    } catch (err) {
      setLyricsError(`Search failed: ${err.message}`);
    } finally {
      setLyricsSearching(false);
    }
  };

  const detectLyricsFromAudio = async () => {
    let sourceData = null;
    if (stemsDataRef.current?.vocals) {
      const v = stemsDataRef.current.vocals;
      sourceData = { left: v.left, right: v.right, sampleRate: v.sampleRate };
    } else if (audioFile) {
      try {
        const ab = await audioFile.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        await ctx.close();
        sourceData = {
          left: buf.getChannelData(0),
          right: buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0),
          sampleRate: buf.sampleRate,
        };
      } catch { /* fall through */ }
    }
    if (!sourceData && guitarStemRef.current) sourceData = guitarStemRef.current;
    if (!sourceData) {
      setLyricsError('No audio loaded. Upload a song or separate stems first.');
      return;
    }

    setLyricsDetecting(true);
    setLyricsError('');
    setLyricsLines([]);
    setLyricsSource('');
    setLyricsStatus('Preparing audio…');

    try {
      const { left, right, sampleRate } = sourceData;
      const mono = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
      const targetSR = 16000;
      const targetLen = Math.floor(mono.length * targetSR / sampleRate);
      const offCtx = new OfflineAudioContext(1, targetLen, targetSR);
      const inBuf = offCtx.createBuffer(1, mono.length, sampleRate);
      inBuf.copyToChannel(mono, 0);
      const src = offCtx.createBufferSource();
      src.buffer = inBuf;
      src.connect(offCtx.destination);
      src.start();
      const resampled = await offCtx.startRendering();
      const audio16k = new Float32Array(resampled.getChannelData(0));

      if (!lyricsWorkerRef.current) {
        lyricsWorkerRef.current = new Worker(
          new URL('./lyricsWorker.js', import.meta.url),
          { type: 'module' }
        );
      }

      const words = await new Promise((resolve, reject) => {
        const worker = lyricsWorkerRef.current;
        const handler = ({ data }) => {
          if (data.type === 'status') {
            setLyricsStatus(data.msg);
          } else if (data.type === 'dl') {
            if (data.p?.status === 'progress') {
              setLyricsStatus(`Downloading model… ${Math.round(data.p.progress ?? 0)}%`);
            }
          } else if (data.type === 'result') {
            worker.removeEventListener('message', handler);
            resolve(data.words);
          } else if (data.type === 'error') {
            worker.removeEventListener('message', handler);
            reject(new Error(data.message));
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'transcribe', audio: audio16k }, [audio16k.buffer]);
      });

      const lines = wordsToLines(words);
      setLyricsLines(lines);
      setLyricsSource(`Detected via Whisper (${lines.length} lines)`);
      setLyricsStatus('');
    } catch (err) {
      setLyricsError(err.message);
      setLyricsStatus('');
    } finally {
      setLyricsDetecting(false);
    }
  };

  // ── Chord detection ──────────────────────────────────────────────

  const handleChordFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setChordResults([]);
    setChordError('');
    setChordDuration(0);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const left = audioBuffer.numberOfChannels > 0
        ? audioBuffer.getChannelData(0)
        : new Float32Array(audioBuffer.length);
      const right = audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : left;
      chordStemRef.current = {
        left: new Float32Array(left),
        right: new Float32Array(right),
        sampleRate: audioBuffer.sampleRate,
      };
      setChordFileLabel(file.name);
      setChordDuration(audioBuffer.duration);
    } catch (err) {
      setChordError(`Could not decode audio file: ${err.message}`);
    }
  };

  const detectChordsHandler = async () => {
    const stemData = chordStemRef.current ?? guitarStemRef.current;
    if (!stemData) return;
    setChordProcessing(true);
    setChordProgress(0);
    setChordError('');
    setChordResults([]);
    try {
      const { detectChords } = await import('./chordDetector.js');
      const { left, right, sampleRate } = stemData;
      const fullDuration = left.length / sampleRate;
      const dur = chordDuration > 0 ? chordDuration : guitarDuration;
      const startSec = Math.max(0, chordStartSec);
      const endSec = Math.min(fullDuration, chordEndSec > 0 && chordEndSec <= dur ? chordEndSec : fullDuration);
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.floor(endSec * sampleRate);

      const mono = new Float32Array(endSample - startSample);
      for (let i = startSample; i < endSample; i++) {
        mono[i - startSample] = (left[i] + right[i]) / 2;
      }

      const targetSR = 11025;
      const targetLength = Math.floor(mono.length * targetSR / sampleRate);
      const tmpCtx = new AudioContext();
      const inputBuffer = tmpCtx.createBuffer(1, mono.length, sampleRate);
      inputBuffer.copyToChannel(mono, 0);
      const offlineCtx = new OfflineAudioContext(1, targetLength, targetSR);
      const source = offlineCtx.createBufferSource();
      source.buffer = inputBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const resampled = await offlineCtx.startRendering();
      await tmpCtx.close();

      const segments = await detectChords(resampled.getChannelData(0), targetSR, setChordProgress);

      if (segments.length === 0) {
        setChordError('No chords detected. Try a longer segment or audio with clear harmonic content.');
      } else {
        setChordResults(segments);
      }
    } catch (err) {
      console.error('Chord detection error:', err);
      setChordError(`Chord detection failed: ${err.message}`);
    } finally {
      setChordProcessing(false);
    }
  };

  const handleChordRangePointerDown = (e) => {
    const handle = e.target.closest('[data-handle]');
    if (!handle) return;
    chordDraggingRef.current = handle.dataset.handle;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleChordRangePointerMove = (e) => {
    if (!chordDraggingRef.current || !chordRangeRef.current) return;
    const effectiveDur = chordDuration > 0 ? chordDuration : guitarDuration;
    const rect = chordRangeRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * effectiveDur;
    if (chordDraggingRef.current === 'start') {
      setChordStartSec(Math.min(time, chordEndSec - 0.5));
    } else {
      setChordEndSec(Math.max(time, chordStartSec + 0.5));
    }
  };

  const handleChordRangePointerUp = () => { chordDraggingRef.current = null; };

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

  const handleRangePointerUp = () => { draggingHandleRef.current = null; };

  const handleGuitarFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTabError('');
    setTabDuration(0);
    tabSliceRef.current = null;
    tabAudioBufRef.current = null;
    stopTabNodes();
    setTabIsPlaying(false);
    setTabDisplayTime(0);
    tabPlayOffsetRef.current = 0;
    if (tabScrubberRef.current) tabScrubberRef.current.value = '0';
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
      const monoFull = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) monoFull[i] = (left[i] + right[i]) / 2;
      guitarStemRef.current = {
        left: new Float32Array(left),
        right: new Float32Array(right),
        sampleRate: audioBuffer.sampleRate,
      };
      tabSliceRef.current = { mono: monoFull, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration };
      setGuitarFileLabel(file.name);
      setGuitarDuration(audioBuffer.duration);
      setTabDuration(audioBuffer.duration);
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
    clearTab();

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

      const MIN_NOTE_DURATION = 0.05;
      const notes = outputToNotesPoly(
        frames, onsets,
        0.4,
        0.2,
        MIN_NOTE_DURATION,
        true,
        1320,
        80,
      );
      const notesTimed = noteFramesToTime(notes);
      const filtered = notesTimed.filter((n) => n.amplitude >= 0.25);

      if (filtered.length === 0) {
        setTabError('No guitar notes detected above confidence threshold.');
      } else {
        const { bpm, stringCount } = useTabStore.getState();
        const { tab, techniques, leadTab, leadTechniques, rhythmTab, rhythmTechniques, totalBeats } =
          notesToTab(filtered, bpm, stringCount);
        useTabStore.getState().loadTab(
          tab, techniques,
          leadTab, leadTechniques,
          rhythmTab, rhythmTechniques,
          totalBeats,
        );
      }
    } catch (err) {
      console.error('Tab detection error:', err);
      setTabError(`Tab detection failed: ${err.message}`);
    } finally {
      setTabProcessing(false);
    }
  };

  const handleDownloadMix = () => {
    const activeKeys = [...activeStemKeys];
    if (activeKeys.length === 0) return;

    const sampleRate = sampleRateRef.current;
    const length = stemsDataRef.current[activeKeys[0]].left.length;
    const mixed = { left: new Float32Array(length), right: new Float32Array(length) };

    for (const key of activeKeys) {
      const d = stemsDataRef.current[key];
      for (let i = 0; i < length; i++) {
        mixed.left[i] += d.left[i];
        mixed.right[i] += d.right[i];
      }
    }

    let peak = 0;
    for (let i = 0; i < length; i++) {
      peak = Math.max(peak, Math.abs(mixed.left[i]), Math.abs(mixed.right[i]));
    }
    if (peak > 1) {
      for (let i = 0; i < length; i++) {
        mixed.left[i] /= peak;
        mixed.right[i] /= peak;
      }
    }

    const blob = createWavBlob(mixed.left, mixed.right, sampleRate);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${audioName.replace(/\.[^.]+$/, '')}-mix.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stemPlayerPct = stemDurationRef.current > 0 ? (displayTime / stemDurationRef.current) * 100 : 0;

  return (
    <div className="app-shell">

      {/* ── TOP BAR ── */}
      <div className="top-bar">
        <span className="top-bar-logo">KAPPA</span>

        {audioName ? (
          <label className="top-bar-file" title="Load a different file">
            <div className="tbf-dot" />
            <span className="tbf-name">{audioName}</span>
            <input type="file" accept="audio/*" onChange={handleMainFile} style={{ display: 'none' }} />
          </label>
        ) : (
          <label className="top-bar-file">
            <span className="tbf-prompt">🎵 Load audio…</span>
            <input type="file" accept="audio/*" onChange={handleMainFile} style={{ display: 'none' }} />
          </label>
        )}

        {isSeparated && (
          <div className="top-bar-player">
            <span className="tbp-time">{formatTime(displayTime)}</span>
            <div className="tbp-scrub">
              <div className="tbp-fill" style={{ width: `${stemPlayerPct}%` }} />
              <input
                ref={scrubberRef}
                type="range"
                className="tbp-input"
                min="0"
                max={stemDurationRef.current || 1}
                step="0.1"
                defaultValue="0"
                onChange={handleScrub}
              />
              <div className="tbp-thumb" style={{ left: `${stemPlayerPct}%` }} />
            </div>
            <span className="tbp-time">{formatTime(stemDurationRef.current)}</span>
          </div>
        )}

        <div className="top-bar-controls">
          {isSeparated && (
            isPlaying ? (
              <button className="tb-btn primary" onClick={pausePlayback}>⏸ Pause</button>
            ) : (
              <button className="tb-btn primary" onClick={() => startPlayback()} disabled={activeStemKeys.size === 0}>▶ Play</button>
            )
          )}
          {isSeparated && (
            <button className="tb-btn" onClick={handleStop}>⏹</button>
          )}
          {isSeparated && activeStemKeys.size > 0 && (
            <button className="tb-btn" onClick={handleDownloadMix} title="Download active stems as mix">⬇ Mix</button>
          )}
          {audioName && (
            <button className="tb-btn danger" onClick={handleReset}>✕ Reset</button>
          )}
        </div>
      </div>

      {/* ── TAB NAV ── */}
      <nav className="kappa-nav">
        <button
          className={`kappa-nav-btn${activeTabSection === 'stems' ? ' active' : ''}`}
          onClick={() => setActiveTabSection('stems')}
        >⚡ Stems</button>
        <button
          className={`kappa-nav-btn${activeTabSection === 'guitar' ? ' active' : ''}`}
          onClick={() => setActiveTabSection('guitar')}
        >🎸 Guitar Tab</button>
        <button
          className={`kappa-nav-btn${activeTabSection === 'chords' ? ' active' : ''}`}
          onClick={() => setActiveTabSection('chords')}
        >🎵 Chords</button>
      </nav>

      {/* ══ STEMS TAB ══ */}
      {activeTabSection === 'stems' && (
        <div className="workspace">
          <aside className="controls-panel">
            <div>
              <div className="panel-label">Audio Source</div>
              {!audioName ? (
                <label className="upload-zone">
                  <div className="uz-icon">🎵</div>
                  <div className="uz-text">Tap to load audio</div>
                  <div className="uz-hint">MP3 · WAV · FLAC · AIFF</div>
                  <input type="file" accept="audio/*" onChange={handleMainFile} />
                </label>
              ) : (
                <div className="file-pill">
                  <span className="fp-icon">📄</span>
                  <span className="fp-name">{audioName}</span>
                </div>
              )}
            </div>

            <button className="btn-action" onClick={handleSeparate} disabled={!audioFile || processing}>
              {processing ? 'Separating…' : 'Separate Stems'}
            </button>

            {(processing || isSeparated) && (
              <div className="progress-row">
                <div className="progress-bar-bg">
                  <div className={`progress-bar-fill${processing ? ' active' : ''}`} style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <span>{Math.round(progress * 100)}%</span>
              </div>
            )}
            {fromCache && !processing && <p className="hint">✓ Loaded from cache</p>}

            {isSeparated && (
              <div>
                <div className="panel-label">Active Stems</div>
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
                      >⬇</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <div className="main-area">
            {processing && (
              <div className="processing-panel">
                <div className="waveform-animation">
                  {Array.from({ length: 14 }, (_, i) => (
                    <span key={i} style={{ animationDelay: `${((i * 0.09) % 0.45).toFixed(2)}s` }} />
                  ))}
                </div>
                <p className="processing-status">{fromCache ? 'Loading from cache…' : 'Separating stems…'}</p>
                {instrumentTypes.map(({ key }) => (
                  <div key={key} className="skeleton-card">
                    <div className="skeleton-icon" />
                    <div className="skeleton-lines">
                      <div className="skeleton-line" />
                      <div className="skeleton-line short" />
                    </div>
                  </div>
                ))}
                <p className="hint" style={{ textAlign: 'center' }}>First run downloads ~172 MB model.</p>
              </div>
            )}
            {isSeparated && !processing && (
              <>
                <div className="main-title">Stem Previews</div>
                <div className="stem-wave-grid">
                  {instrumentTypes.map(({ key, label, emoji }) => (
                    <div key={key} className="stem-wave-card" style={{ opacity: activeStemKeys.has(key) ? 1 : 0.4 }}>
                      <div className="stem-wave-label">{emoji} {label}</div>
                      <audio controls src={stems[key]} />
                    </div>
                  ))}
                </div>
              </>
            )}
            {!audioName && !processing && (
              <p className="hint" style={{ marginTop: 40, textAlign: 'center' }}>
                Load an audio file from the left panel, then click Separate Stems.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══ GUITAR TAB ══ */}
      {activeTabSection === 'guitar' && (
        <div className="workspace">
          <aside className="controls-panel">
            <div>
              <div className="panel-label">Guitar Audio</div>
              {guitarDuration > 0 ? (
                <div className="file-pill">
                  <span className="fp-icon">🎸</span>
                  <span className="fp-name">
                    {isSeparated ? `Guitar stem · ${audioName}` : audioName}
                  </span>
                </div>
              ) : (
                <p className="hint" style={{ textAlign: 'center', padding: '10px 0' }}>
                  Load audio using the ♪ button in the top bar
                </p>
              )}
            </div>

            {guitarDuration > 0 && (
              <div>
                <div className="panel-label">Range</div>
                <div
                  className="range-selector"
                  ref={rangeRef}
                  onPointerDown={handleRangePointerDown}
                  onPointerMove={handleRangePointerMove}
                  onPointerUp={handleRangePointerUp}
                >
                  <div className="range-track">
                    <div className="range-fill" style={{ left: `${(tabStartSec / guitarDuration) * 100}%`, width: `${((tabEndSec - tabStartSec) / guitarDuration) * 100}%` }} />
                  </div>
                  <div className="range-handle" data-handle="start" style={{ left: `${(tabStartSec / guitarDuration) * 100}%` }} />
                  <div className="range-handle" data-handle="end" style={{ left: `${(tabEndSec / guitarDuration) * 100}%` }} />
                  <div className="range-times">
                    <span>{formatTime(tabStartSec)}</span>
                    <span>{formatTime(tabEndSec)}</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="panel-label">Strings</div>
              <StringSelector />
            </div>

            <button className="btn-action" onClick={detectTab} disabled={tabProcessing || !guitarStemRef.current}>
              {tabProcessing ? 'Detecting…' : 'Detect Guitar Tab'}
            </button>

            {tabProcessing && (
              <div className="progress-row">
                <div className="progress-bar-bg">
                  <div className={`progress-bar-fill${tabProcessing ? ' active' : ''}`} style={{ width: `${Math.round(tabProgress * 100)}%` }} />
                </div>
                <span>{Math.round(tabProgress * 100)}%</span>
              </div>
            )}

            {tabError && <p className="hint" style={{ color: 'var(--danger)' }}>{tabError}</p>}

            <div>
              <div className="panel-label">Playback</div>
              {guitarDuration > 0 && (
                <div className="stem-scrubber-row" style={{ marginBottom: 8 }}>
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
                  <span className="stem-time">{formatTime(tabDuration)}</span>
                </div>
              )}
              <TransportBar
                onPlay={() => startTabPlayback()}
                onPause={pauseTabPlayback}
                onStop={handleTabStop}
                isPlayingAudio={tabIsPlaying}
                hasAudio={guitarDuration > 0}
              />
            </div>
          </aside>

          <div className="main-area">
            <TabTimeline onSeek={tabSeekTo} />
            <div className="tab-view-toggle">
              <button className={`tvt-btn${tabView === 'lead'   ? ' active' : ''}`} onClick={() => setTabView('lead')}>🎸 Lead</button>
              <button className={`tvt-btn${tabView === 'rhythm' ? ' active' : ''}`} onClick={() => setTabView('rhythm')}>🎵 Rhythm</button>
              <button className={`tvt-btn${tabView === 'both'   ? ' active' : ''}`} onClick={() => setTabView('both')}>Both</button>
            </div>
            <div className="lead-rhythm-split">
              {(tabView === 'lead' || tabView === 'both') && (
                <div>
                  {tabView === 'both' && <div className="tab-section-header">🎸 Lead</div>}
                  {!leadIsEmpty && (
                    <TabGrid
                      source="lead"
                      lyricsLines={lyricsLines}
                      tabStartSec={tabStartSec}
                      lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                    />
                  )}
                </div>
              )}
              {tabView === 'both' && !leadIsEmpty && !rhythmIsEmpty && (
                <div className="tab-section-divider" />
              )}
              {(tabView === 'rhythm' || tabView === 'both') && (
                <div>
                  {tabView === 'both' && <div className="tab-section-header">🎵 Rhythm</div>}
                  {!rhythmIsEmpty && (
                    <TabGrid
                      source="rhythm"
                      lyricsLines={lyricsLines}
                      tabStartSec={tabStartSec}
                      lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
                    />
                  )}
                </div>
              )}
            </div>
            <LyricsPanel
              query={lyricsQuery}
              onQueryChange={setLyricsQuery}
              onSearch={searchLyrics}
              searching={lyricsSearching}
              detecting={lyricsDetecting}
              status={lyricsStatus}
              error={lyricsError}
              source={lyricsSource}
              onDetect={detectLyricsFromAudio}
              hasAudio={!!(stemsDataRef.current?.vocals || audioFile || guitarStemRef.current)}
            />
          </div>
        </div>
      )}

      {/* ══ CHORDS TAB ══ */}
      {activeTabSection === 'chords' && (() => {
        const effectiveDur = chordDuration > 0 ? chordDuration : guitarDuration;
        const hasAudio = !!(chordStemRef.current || guitarStemRef.current);
        return (
          <div className="workspace">
            <aside className="controls-panel">
              <div>
                <div className="panel-label">Audio</div>
                {(guitarDuration > 0 || chordDuration > 0) ? (
                  <div className="file-pill">
                    <span className="fp-icon">🎵</span>
                    <span className="fp-name">
                      {isSeparated ? `Guitar stem · ${audioName}` : audioName}
                    </span>
                  </div>
                ) : (
                  <p className="hint" style={{ textAlign: 'center', padding: '10px 0' }}>
                    Load audio using the ♪ button in the top bar
                  </p>
                )}
              </div>

              {effectiveDur > 0 && (
                <div>
                  <div className="panel-label">Range</div>
                  <div
                    className="range-selector"
                    ref={chordRangeRef}
                    onPointerDown={handleChordRangePointerDown}
                    onPointerMove={handleChordRangePointerMove}
                    onPointerUp={handleChordRangePointerUp}
                  >
                    <div className="range-track">
                      <div className="range-fill" style={{ left: `${(chordStartSec / effectiveDur) * 100}%`, width: `${((chordEndSec - chordStartSec) / effectiveDur) * 100}%` }} />
                    </div>
                    <div className="range-handle" data-handle="start" style={{ left: `${(chordStartSec / effectiveDur) * 100}%` }} />
                    <div className="range-handle" data-handle="end" style={{ left: `${(chordEndSec / effectiveDur) * 100}%` }} />
                    <div className="range-times">
                      <span>{formatTime(chordStartSec)}</span>
                      <span>{formatTime(chordEndSec)}</span>
                    </div>
                  </div>
                </div>
              )}

              <button className="btn-action" onClick={detectChordsHandler} disabled={chordProcessing || !hasAudio}>
                {chordProcessing ? 'Detecting…' : 'Detect Chords'}
              </button>

              {chordProcessing && (
                <div className="progress-row">
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill active" style={{ width: `${Math.round(chordProgress * 100)}%` }} />
                  </div>
                  <span>{Math.round(chordProgress * 100)}%</span>
                </div>
              )}

              {chordError && <p className="hint" style={{ color: 'var(--danger)' }}>{chordError}</p>}
            </aside>

            <div className="main-area">
              <ChordSheet
                segments={chordResults}
                lyricsLines={lyricsLines}
                chordStartSec={chordStartSec}
                lyricsCurrentTime={tabIsPlaying ? tabDisplayTime + tabStartSec : isPlaying ? displayTime : null}
              />
              <LyricsPanel
                query={lyricsQuery}
                onQueryChange={setLyricsQuery}
                onSearch={searchLyrics}
                searching={lyricsSearching}
                detecting={lyricsDetecting}
                status={lyricsStatus}
                error={lyricsError}
                source={lyricsSource}
                onDetect={detectLyricsFromAudio}
                hasAudio={!!(stemsDataRef.current?.vocals || audioFile || guitarStemRef.current)}
              />
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function LyricsPanel({ query, onQueryChange, onSearch, searching, detecting, status, error, source, onDetect, hasAudio }) {
  return (
    <div className="lyrics-panel">
      <div className="lyrics-panel-title">Lyrics</div>
      <div className="lyrics-search-row">
        <input
          className="lyrics-search-input"
          type="text"
          placeholder="Artist – Song title"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch()}
        />
        <button type="button" onClick={onSearch} disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {source && <p className="lyrics-source">✓ {source}</p>}
      {status && <p className="lyrics-status">{status}</p>}
      {error && <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</p>}
      <div className="lyrics-audio-row">
        <button type="button" onClick={onDetect} disabled={detecting || !hasAudio}>
          {detecting ? 'Detecting…' : 'Detect from Audio'}
        </button>
        <span className="lyrics-audio-hint">
          {hasAudio ? 'Uses Whisper AI — first run downloads ~80 MB model' : 'Load audio first'}
        </span>
      </div>
    </div>
  );
}

export default App;

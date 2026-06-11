import { useEffect, useRef, useState } from 'react';
import separationWorkerUrl from './separationWorker.js?url';

const GUITAR_STRINGS = [
  { name: 'e', openMidi: 64 },
  { name: 'B', openMidi: 59 },
  { name: 'G', openMidi: 55 },
  { name: 'D', openMidi: 50 },
  { name: 'A', openMidi: 45 },
  { name: 'E', openMidi: 40 },
];

function findBestPosition(midiNotes) {
  // Scan all 5-fret windows (0-4, 1-5, ..., 20-24) and pick the one
  // that covers the most notes, preferring lower positions on ties.
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
  // Prefer a string/fret inside [position, position+4]; fall back to lowest fret.
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
  const BIN_SIZE = 0.25;
  const COLS_PER_LINE = 32;

  const position = findBestPosition(notes.map((n) => n.pitchMidi));

  const maxTime = Math.max(...notes.map((n) => n.startTimeSeconds));
  const totalCols = Math.ceil(maxTime / BIN_SIZE) + 1;

  const grid = GUITAR_STRINGS.map(() => new Array(totalCols).fill(null));

  // Group notes by time column
  const binMap = new Map();
  for (const note of notes) {
    const col = Math.floor(note.startTimeSeconds / BIN_SIZE);
    if (!binMap.has(col)) binMap.set(col, []);
    binMap.get(col).push(note);
  }

  // Assign notes to strings — most confident first, no two notes on the same string
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

const instrumentTypes = [
  { key: 'original', label: 'Original' },
  { key: 'guitar',   label: 'Guitar/Other' },
  { key: 'bass',     label: 'Bass' },
  { key: 'drums',    label: 'Drums' },
  { key: 'vocals',   label: 'Vocals' },
];

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [selectedInstrument, setSelectedInstrument] = useState('original');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState({ guitar: '', bass: '', drums: '', vocals: '' });
  const [isSeparated, setIsSeparated] = useState(false);
  const [tabText, setTabText] = useState('');
  const [tabProcessing, setTabProcessing] = useState(false);
  const [tabProgress, setTabProgress] = useState(0);
  const [tabError, setTabError] = useState('');
  const [guitarFileLabel, setGuitarFileLabel] = useState('');
  const processorRef = useRef(null);
  const previousUrlsRef = useRef([]);
  const guitarStemRef = useRef(null); // { left: Float32Array, right: Float32Array, sampleRate: number }
  const sampleRateRef = useRef(44100);

  useEffect(() => {
    // Worker will handle ONNX initialization
    // This effect ensures proper cleanup when component unmounts
    return () => {
      if (processorRef.current) {
        processorRef.current.terminate?.();
      }
      clearPreviousUrls();
    };
  }, []);

  const clearPreviousUrls = () => {
    previousUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previousUrlsRef.current = [];
  };

  const handleMainFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearPreviousUrls();
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioName(file.name);
    setAudioUrl(url);
    previousUrlsRef.current.push(url);
    setSelectedInstrument('original');
    setIsSeparated(false);
    setStems({ guitar: '', bass: '', drums: '', vocals: '' });
    guitarStemRef.current = null;
    setProgress(0);
  };

  const setInstrument = (instrumentKey) => {
    setSelectedInstrument(instrumentKey);
  };

  const initializeWorker = () => {
    // Always create a fresh worker for each operation
    // This prevents issues with previous operations hanging
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

    const floatTo16BitPCM = (output, offset, input) => {
      for (let i = 0; i < input.length; i += 1) {
        let sample = Math.max(-1, Math.min(1, input[i]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        output.setInt16(offset, sample, true);
        offset += 2;
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
      // Ensure arrays are Float32Array for WAV creation
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

      // Use Web Worker for separation to keep UI responsive
      const result = await new Promise((resolve, reject) => {
        const worker = initializeWorker();

        const SEGMENT_TIMEOUT = 600000; // 10 min per segment (WASM is slow)
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
          const { type, result, error, message } = event.data;

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
            const { progress: segProg, currentSegment, totalSegments } = event.data;
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

        // Use Transferable objects to avoid copying large audio buffers
        const leftArray = new Float32Array(left);
        const rightArray = new Float32Array(right);

        console.log(`Sending separate message to worker (left: ${leftArray.length}, right: ${rightArray.length})...`);
        worker.postMessage(
          {
            type: 'separate',
            data: {
              left: leftArray,
              right: rightArray,
            },
          },
          [leftArray.buffer, rightArray.buffer] // Transfer ownership of the buffers
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

        guitarStemRef.current = {
          left: result.guitar.left,
          right: result.guitar.right,
          sampleRate,
        };
        setGuitarFileLabel('');

        setStems(stemUrls);
        setSelectedInstrument('original');
        setIsSeparated(true);
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

  const handleGuitarFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTabText('');
    setTabError('');
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
      const mono = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;

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

      const MIN_NOTE_DURATION = 0.2;
      const notes = outputToNotesPoly(
        frames, onsets,
        0.65,  // onsetThreshold — higher = fewer ghost notes
        0.5,   // frameThreshold
        MIN_NOTE_DURATION,
        true,  // inferOnsets
        1320,  // maxFrequency — E6, top of guitar range
        80,    // minFrequency — E2, open low E string
      );
      const notesTimed = noteFramesToTime(notes);
      const filtered = notesTimed.filter((n) => n.amplitude >= 0.6);

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

  const selectedInstrumentLabel = instrumentTypes.find((instrument) => instrument.key === selectedInstrument)?.label || 'Original';
  const currentAudioSrc = selectedInstrument === 'original' ? audioUrl : stems[selectedInstrument];

  return (
    <div className="app-shell">
      <header>
        <h1>Local Stem Separator</h1>
        <p>Load a local audio file and separate it into stems directly in the browser using Demucs.</p>
      </header>

      <section className="card">
        <h2>Main audio source</h2>
        <label>
          Local audio file:
          <input type="file" accept="audio/*" onChange={handleMainFile} />
        </label>
        {audioName && (
          <div className="audio-player">
            <strong>Loaded file:</strong> {audioName}
            <audio controls src={audioUrl} />
          </div>
        )}
        <button type="button" onClick={handleSeparate} disabled={!audioFile || processing}>
          {processing ? 'Separating...' : 'Separate Stems'}
        </button>
        <div className="progress-row">
          <div className="progress-bar-bg">
            <div className={`progress-bar-fill${processing ? ' active' : ''}`} style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        {processing && <p className="hint">First run downloads a large model and then processes the audio.</p>}
      </section>

      <section className="card">
        <h2>Instrument selection</h2>
        <p>Choose the stem you want to hear from the separated output.</p>
        <div className="instrument-buttons">
          {instrumentTypes.map((instrument) => (
            <button
              key={instrument.key}
              type="button"
              className={selectedInstrument === instrument.key ? 'active' : ''}
              onClick={() => setInstrument(instrument.key)}
            >
              {instrument.label}
            </button>
          ))}
        </div>
        <p className="hint">Selected: {selectedInstrumentLabel}</p>
      </section>

      <section className="card">
        <h2>Audio player</h2>
        {selectedInstrument !== 'original' && !stems[selectedInstrument] && (
          <p className="hint">No stem available yet. Separate the local file first.</p>
        )}
        {currentAudioSrc ? (
          <div className="audio-player">
            <strong>Playing:</strong> {selectedInstrument === 'original' ? audioName : `${selectedInstrumentLabel} stem`}
            <audio controls src={currentAudioSrc} />
          </div>
        ) : (
          <p className="hint">Choose a local file and click "Separate Stems" to get individual stems.</p>
        )}
      </section>

      {isSeparated && (
        <section className="card">
          <h2>Separated stems</h2>
          <p>These stems were generated from your selected local file.</p>
          {instrumentTypes.filter((instrument) => instrument.key !== 'original').map((instrument) => (
            <div key={instrument.key} className="stem-preview">
              <strong>{instrument.label}</strong>
              {stems[instrument.key] ? (
                <audio controls src={stems[instrument.key]} />
              ) : (
                <p className="hint">Not available yet.</p>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Guitar Tab</h2>
        <p>Detect notes and generate an ASCII tab from a guitar stem.</p>

        <label>
          Upload a pre-separated guitar file:
          <input type="file" accept="audio/*" onChange={handleGuitarFile} />
        </label>

        {guitarFileLabel && (
          <p className="hint">Source: {guitarFileLabel}</p>
        )}
        {!guitarFileLabel && guitarStemRef.current && (
          <p className="hint">Source: Guitar/Other stem from separation</p>
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

        {tabError && <p className="hint" style={{ color: '#ef4444' }}>{tabError}</p>}

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
      </section>

      <section className="card notes">
        <h2>Notes</h2>
        <ul>
          <li>This app separates local audio files directly in the browser using Demucs.</li>
          <li>YouTube preview is for listening only; separation works on uploaded local files.</li>
          <li>The first separation download is large (~172MB) and can take time.</li>
        </ul>
      </section>
    </div>
  );
}

export default App;

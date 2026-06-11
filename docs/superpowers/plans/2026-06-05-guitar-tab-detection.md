# Guitar Tab Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch to a 6-stem ONNX model for clean guitar isolation, then add Basic Pitch-powered ASCII tab detection on the guitar stem.

**Architecture:** The separation worker is rewritten with a custom `SixStemSeparator` class that handles the 6-stem model's output shape `(1,6,2,N)`. The raw guitar stem is stored in a ref on the main thread. Tab detection runs on the main thread using `@spotify/basic-pitch` (TF.js-backed, async, non-blocking). MIDI notes are mapped to lowest-fret guitar positions and rendered as ASCII tab.

**Tech Stack:** React 18, ONNX Runtime Web, `@spotify/basic-pitch`, Web Audio API (`OfflineAudioContext` for 22050 Hz resampling), Vite.

---

## File Map

| File | Role |
|------|------|
| `src/separationWorker.js` | Rewrite: custom `SixStemSeparator` for 6-stem model, same message protocol |
| `src/App.jsx` | Remove YouTube; update stems state/UI; add guitarStemRef; add tab detection + display |
| `src/index.css` | Add tab `<pre>` block and copy button styles |
| `package.json` | Add `@spotify/basic-pitch` |

No new files are created. `tabWorker.js` is NOT used — Basic Pitch runs on the main thread via its own internal async scheduling.

---

## Task 1: Remove YouTube Field

**Files:** Modify `src/App.jsx`

- [ ] **Step 1: Remove YouTube state and memo**

In `src/App.jsx`, delete these lines:

```jsx
// DELETE these 2 lines
const [youtubeUrl, setYoutubeUrl] = useState('');

// DELETE this entire useMemo block (lines ~40-54)
const youtubeEmbedUrl = useMemo(() => {
  if (!youtubeUrl) return '';
  try {
    const url = new URL(youtubeUrl.startsWith('http') ? youtubeUrl : `https://${youtubeUrl}`);
    let videoId = '';
    if (url.hostname.includes('youtube.com')) {
      videoId = url.searchParams.get('v') || '';
    } else if (url.hostname === 'youtu.be') {
      videoId = url.pathname.slice(1);
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
  } catch {
    return '';
  }
}, [youtubeUrl]);
```

- [ ] **Step 2: Remove YouTube JSX**

In the JSX return, delete:

```jsx
// DELETE this label block
<label>
  YouTube URL:
  <input
    type="text"
    placeholder="https://www.youtube.com/watch?v=..."
    value={youtubeUrl}
    onChange={(event) => setYoutubeUrl(event.target.value)}
  />
</label>

// DELETE this conditional block
{youtubeEmbedUrl && (
  <div className="video-preview">
    <iframe
      title="YouTube preview"
      src={youtubeEmbedUrl}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  </div>
)}
```

Also remove `useMemo` from the React import since it's no longer used:
```jsx
// Before
import { useEffect, useMemo, useRef, useState } from 'react';
// After
import { useEffect, useRef, useState } from 'react';
```

- [ ] **Step 3: Verify the app still renders**

Run `npm run dev` and confirm the page loads with no console errors and no YouTube field visible.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: remove YouTube URL field"
```

---

## Task 2: Install Basic Pitch

**Files:** `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install @spotify/basic-pitch
```

- [ ] **Step 2: Verify install**

```bash
node -e "require('@spotify/basic-pitch'); console.log('ok')"
```

Expected output: `ok` (no errors).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @spotify/basic-pitch dependency"
```

---

## Task 3: Rewrite separationWorker.js with SixStemSeparator

**Files:** Rewrite `src/separationWorker.js`

The 6-stem model (`htdemucs_6s_fp16weights.onnx`):
- Input: `(1, 2, 343980)` — stereo waveform (same as 4-stem model)
- Output: `(1, 6, 2, 343980)` — 6 stems × 2 channels
- Stem order by index: 0=drums, 1=bass, 2=other, 3=vocals, 4=guitar, 5=piano

The worker message protocol is **unchanged**: `downloadProgress`, `segmentProgress`, `status`, `result`, `error`.

- [ ] **Step 1: Replace separationWorker.js entirely**

```js
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';

const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx';
const TRAINING_SAMPLES = 343980;
const SEGMENT_OVERLAP = 0.25;
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = self.navigator?.hardwareConcurrency ?? 4;

class SixStemSeparator {
  constructor({ onDownloadProgress, onProgress }) {
    this.onDownloadProgress = onDownloadProgress ?? (() => {});
    this.onProgress = onProgress ?? (() => {});
    this.session = null;
  }

  async loadModel() {
    const response = await fetch(MODEL_URL);
    const total = parseInt(response.headers.get('Content-Length') ?? '0', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total > 0) this.onDownloadProgress(loaded, total);
    }

    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }

    this.session = await ort.InferenceSession.create(buffer.buffer, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'basic',
    });
  }

  async separate(left, right) {
    const totalSamples = left.length;
    const stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
    const numSegments = Math.ceil((totalSamples - TRAINING_SAMPLES) / stride) + 1;

    const outputs = STEM_NAMES.map(() => ({
      left: new Float32Array(totalSamples),
      right: new Float32Array(totalSamples),
    }));
    const weights = new Float32Array(totalSamples);

    let segIdx = 0;
    for (let start = 0; start < totalSamples; start += stride) {
      const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
      const segLen = end - start;

      const waveform = new Float32Array(2 * TRAINING_SAMPLES);
      waveform.set(left.subarray(start, end), 0);
      waveform.set(right.subarray(start, end), TRAINING_SAMPLES);

      const inputTensor = new ort.Tensor('float32', waveform, [1, 2, TRAINING_SAMPLES]);
      const feeds = { [this.session.inputNames[0]]: inputTensor };
      const result = await this.session.run(feeds);

      // Output shape: (1, 6, 2, TRAINING_SAMPLES)
      const outData = result[this.session.outputNames[0]].data;

      const overlapWindow = new Float32Array(segLen);
      for (let i = 0; i < segLen; i++) {
        const fadeIn = Math.min(i / (stride * 0.5), 1);
        const fadeOut = Math.min((segLen - i) / (stride * 0.5), 1);
        overlapWindow[i] = Math.min(fadeIn, fadeOut);
      }

      for (let t = 0; t < 6; t++) {
        for (let i = 0; i < segLen && start + i < totalSamples; i++) {
          const lIdx = t * 2 * TRAINING_SAMPLES + i;
          const rIdx = t * 2 * TRAINING_SAMPLES + TRAINING_SAMPLES + i;
          outputs[t].left[start + i] += outData[lIdx] * overlapWindow[i];
          outputs[t].right[start + i] += outData[rIdx] * overlapWindow[i];
        }
      }

      for (let i = 0; i < segLen && start + i < totalSamples; i++) {
        weights[start + i] += overlapWindow[i];
      }

      segIdx++;
      this.onProgress({ progress: segIdx / numSegments, currentSegment: segIdx, totalSegments: numSegments });
    }

    for (let t = 0; t < 6; t++) {
      for (let i = 0; i < totalSamples; i++) {
        if (weights[i] > 0) {
          outputs[t].left[i] /= weights[i];
          outputs[t].right[i] /= weights[i];
        }
      }
    }

    return Object.fromEntries(STEM_NAMES.map((name, t) => [name, outputs[t]]));
  }
}

let separator = null;

self.onmessage = async (event) => {
  const { type, data } = event.data;
  try {
    if (type === 'separate') {
      const { left, right } = data;

      self.postMessage({ type: 'status', message: 'Initializing separator...' });

      if (!separator) {
        separator = new SixStemSeparator({
          onDownloadProgress: (loaded, total) => {
            self.postMessage({ type: 'downloadProgress', loaded, total });
          },
          onProgress: ({ progress, currentSegment, totalSegments }) => {
            self.postMessage({ type: 'segmentProgress', progress, currentSegment, totalSegments });
          },
        });
        await separator.loadModel();
      }

      self.postMessage({ type: 'status', message: 'Running separation...' });

      const stems = await separator.separate(new Float32Array(left), new Float32Array(right));

      const resultData = {};
      for (const name of ['drums', 'bass', 'other', 'vocals', 'guitar']) {
        resultData[name] = {
          left: stems[name].left.slice(),
          right: stems[name].right.slice(),
        };
      }

      self.postMessage({ type: 'result', result: resultData });
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
};
```

Note: piano is excluded from `resultData` to avoid transferring unused data.

- [ ] **Step 2: Restart the dev server and open the app**

```bash
npm run dev
```

Load an audio file and click "Separate Stems". The console should show:
- Model download progress (136MB download on first run)
- `segmentProgress` messages as each chunk finishes
- No errors

- [ ] **Step 3: Commit**

```bash
git add src/separationWorker.js
git commit -m "feat: switch to htdemucs 6-stem model with custom SixStemSeparator"
```

---

## Task 4: Update App.jsx — Stems State and Instrument Selector

**Files:** Modify `src/App.jsx`

- [ ] **Step 1: Update instrumentTypes and stems initial state**

Replace the `instrumentTypes` array:

```jsx
// Replace the old instrumentTypes array with:
const instrumentTypes = [
  { key: 'original', label: 'Original' },
  { key: 'guitar',   label: 'Guitar' },
  { key: 'bass',     label: 'Bass' },
  { key: 'drums',    label: 'Drums' },
  { key: 'vocals',   label: 'Vocals' },
  { key: 'other',    label: 'Other' },
];
```

Replace the `stems` initial state:

```jsx
// Replace:
const [stems, setStems] = useState({ vocals: '', drums: '', bass: '', other: '' });
// With:
const [stems, setStems] = useState({ guitar: '', bass: '', drums: '', vocals: '', other: '' });
```

- [ ] **Step 2: Add guitarStemRef and sampleRateRef**

After `const processorRef = useRef(null);`, add:

```jsx
const guitarStemRef = useRef(null); // stores { left: Float32Array, right: Float32Array, sampleRate: number }
const sampleRateRef = useRef(44100);
```

- [ ] **Step 3: Update handleMainFile to reset new state**

In `handleMainFile`, replace:
```jsx
setStems({ vocals: '', drums: '', bass: '', other: '' });
```
With:
```jsx
setStems({ guitar: '', bass: '', drums: '', vocals: '', other: '' });
guitarStemRef.current = null;
```

- [ ] **Step 4: Update handleSeparate to handle 6 stems**

In `handleSeparate`, after `console.log('Separation complete, creating stem URLs...');`, replace the entire stem URL creation block with:

```jsx
console.log('Creating stem URLs...');
const sampleRate = audioBuffer.sampleRate;
sampleRateRef.current = sampleRate;

const stemUrls = {};
for (const name of ['guitar', 'bass', 'drums', 'vocals', 'other']) {
  stemUrls[name] = createStemUrl(result[name], sampleRate);
}

// Store raw guitar stem for tab detection
guitarStemRef.current = {
  left: result.guitar.left,
  right: result.guitar.right,
  sampleRate,
};

setStems(stemUrls);
setSelectedInstrument('original');
setIsSeparated(true);
setProgress(1);
console.log('UI updated, separation complete');
```

- [ ] **Step 5: Fix currentAudioSrc to use 'original' instead of 'all'**

Replace:
```jsx
const currentAudioSrc = selectedInstrument === 'all' ? audioUrl : stems[selectedInstrument];
```
With:
```jsx
const currentAudioSrc = selectedInstrument === 'original' ? audioUrl : stems[selectedInstrument];
```

- [ ] **Step 6: Update the "Separated stems" section**

Replace:
```jsx
{instrumentTypes.filter((instrument) => instrument.key !== 'all').map((instrument) => (
```
With:
```jsx
{instrumentTypes.filter((instrument) => instrument.key !== 'original').map((instrument) => (
```

- [ ] **Step 7: Verify stems UI works**

Run the app, separate a file, and confirm the instrument selector shows Original/Guitar/Bass/Drums/Vocals/Other, and clicking each plays the correct stem.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat: update stems UI for 6-stem model"
```

---

## Task 5: Add Tab Detection Logic

**Files:** Modify `src/App.jsx`

Basic Pitch runs on the main thread. The pipeline:
1. Mix guitar stem to mono: `mono[i] = (left[i] + right[i]) / 2`
2. Create an `AudioBuffer` at the original sample rate
3. Resample to 22050 Hz (Basic Pitch's required rate) via `OfflineAudioContext`
4. Run `BasicPitch.evaluateModel()` — async, accumulates frames/onsets/contours via callback
5. Call `outputToNotesPoly()` then `noteFramesToTime()` for timed note list
6. Filter notes with `amplitude < 0.5`
7. Pass to `renderAsciiTab()` (added in Task 6)

- [ ] **Step 1: Add tab state variables**

After `const [isSeparated, setIsSeparated] = useState(false);`, add:

```jsx
const [tabText, setTabText] = useState('');
const [tabProcessing, setTabProcessing] = useState(false);
const [tabProgress, setTabProgress] = useState(0);
const [tabError, setTabError] = useState('');
```

- [ ] **Step 2: Add the detectTab function**

Add this function after `handleSeparate`:

```jsx
const detectTab = async () => {
  const stemData = guitarStemRef.current;
  if (!stemData) return;

  setTabProcessing(true);
  setTabProgress(0);
  setTabError('');
  setTabText('');

  try {
    const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');

    // Mix stereo to mono
    const { left, right, sampleRate } = stemData;
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;

    // Build AudioBuffer at original sample rate
    const audioCtx = new AudioContext();
    const inputBuffer = audioCtx.createBuffer(1, mono.length, sampleRate);
    inputBuffer.copyToChannel(mono, 0);

    // Resample to 22050 Hz (Basic Pitch requirement)
    const targetSampleRate = 22050;
    const targetLength = Math.floor(mono.length * targetSampleRate / sampleRate);
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = inputBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const resampledBuffer = await offlineCtx.startRendering();

    // Run Basic Pitch
    const MODEL_URL = 'https://unpkg.com/@spotify/basic-pitch@0.0.6/src/';
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

    const MIN_NOTE_DURATION = 0.127; // ~3 frames at 22050/256 hop
    const notes = outputToNotesPoly(frames, onsets, 0.5, 0.5, MIN_NOTE_DURATION);
    const notesTimed = noteFramesToTime(notes);
    const filtered = notesTimed.filter((n) => n.amplitude >= 0.5);

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
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add detectTab function using Basic Pitch"
```

---

## Task 6: Add ASCII Tab Renderer

**Files:** Modify `src/App.jsx`

- [ ] **Step 1: Add renderAsciiTab function**

Add this pure function **before** the `App` component (at module scope, after imports):

```jsx
// Standard tuning: string name → open MIDI note number
const GUITAR_STRINGS = [
  { name: 'e', openMidi: 64 }, // high e
  { name: 'B', openMidi: 59 },
  { name: 'G', openMidi: 55 },
  { name: 'D', openMidi: 50 },
  { name: 'A', openMidi: 45 },
  { name: 'E', openMidi: 40 }, // low E
];

function midiToFret(midi) {
  // Find lowest fret position across all strings
  let best = null;
  for (const str of GUITAR_STRINGS) {
    const fret = midi - str.openMidi;
    if (fret >= 0 && fret <= 24) {
      if (best === null || fret < best.fret) {
        best = { stringName: str.name, fret };
      }
    }
  }
  return best; // null if out of guitar range
}

function renderAsciiTab(notes) {
  const BIN_SIZE = 0.25; // seconds per column
  const COLS_PER_LINE = 32;

  // Find total columns needed
  const maxTime = Math.max(...notes.map((n) => n.startTimeSeconds));
  const totalCols = Math.ceil(maxTime / BIN_SIZE) + 1;

  // Build a grid: grid[stringIdx][colIdx] = fret number string or '-'
  const grid = GUITAR_STRINGS.map(() => new Array(totalCols).fill(null));

  for (const note of notes) {
    const mapped = midiToFret(note.pitchMidi);
    if (!mapped) continue;
    const col = Math.floor(note.startTimeSeconds / BIN_SIZE);
    const strIdx = GUITAR_STRINGS.findIndex((s) => s.name === mapped.stringName);
    // If collision, keep highest fret (last-write wins across notes sorted by time)
    if (grid[strIdx][col] === null || mapped.fret > grid[strIdx][col]) {
      grid[strIdx][col] = mapped.fret;
    }
  }

  // Render lines in chunks of COLS_PER_LINE
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
    lines.push(''); // blank line between sections
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Verify the function in browser console**

After `npm run dev`, open the console and test:

```js
// Paste and run this to verify renderAsciiTab works
const notes = [
  { startTimeSeconds: 0.0, pitchMidi: 64, amplitude: 0.9 },  // open high e
  { startTimeSeconds: 0.5, pitchMidi: 67, amplitude: 0.8 },  // 3rd fret high e
  { startTimeSeconds: 1.0, pitchMidi: 45, amplitude: 0.7 },  // open A
];
```

You can't call `renderAsciiTab` from the console directly, but after running a separation and tab detection, the output should show recognizable fret numbers for those MIDI values.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add MIDI-to-ASCII tab renderer"
```

---

## Task 7: Add Tab UI Section

**Files:** Modify `src/App.jsx`

- [ ] **Step 1: Add tab section to JSX**

After the `{isSeparated && (...)}` separated stems section, add:

```jsx
{isSeparated && (
  <section className="card">
    <h2>Guitar Tab</h2>
    <p>Detect notes from the isolated guitar stem and generate a guitar tab.</p>
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
)}
```

- [ ] **Step 2: Verify the section appears after separation**

Run the app, separate a file, and confirm the "Guitar Tab" card appears below the separated stems section with the "Detect Guitar Tab" button enabled.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add guitar tab UI section"
```

---

## Task 8: Add CSS for Tab Display

**Files:** Modify `src/index.css`

- [ ] **Step 1: Add tab styles**

Append to the end of `src/index.css`:

```css
.tab-display {
  margin-top: 14px;
  position: relative;
}

.tab-copy-btn {
  margin-top: 0;
  margin-bottom: 8px;
  padding: 6px 12px;
  font-size: 13px;
  background: #374151;
}

.tab-copy-btn:hover {
  background: #4b5563;
}

.tab-pre {
  background: #0d1117;
  color: #22c55e;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 16px;
  border-radius: 10px;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 480px;
  white-space: pre;
  margin: 0;
  border: 1px solid #374151;
}
```

- [ ] **Step 2: Verify tab display styling**

Run a full separation + tab detection and confirm:
- The tab appears in a dark scrollable box with green monospace text
- The "Copy Tab" button is visible above the tab
- The box scrolls horizontally for wide tabs and vertically for long songs

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add guitar tab display styles"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Remove YouTube field → Task 1
  - ✅ 6-stem model (htdemucs_6s_fp16) → Task 3
  - ✅ Guitar, Bass, Drums as primary stems → Task 4
  - ✅ Raw guitar stem stored for tab detection → Task 4 (guitarStemRef)
  - ✅ Basic Pitch on guitar stem → Task 5
  - ✅ Amplitude filter ≥ 0.5 → Task 5
  - ✅ MIDI → lowest fret mapping → Task 6
  - ✅ 0.25s time bins → Task 6
  - ✅ ASCII tab with 32 cols/line wrap → Task 6
  - ✅ Copy-to-clipboard button → Task 7
  - ✅ Progress bar during tab detection → Task 7
  - ✅ Error for no detected notes → Task 5
  - ✅ CSS for tab display → Task 8

- **No placeholders:** All steps contain full code.

- **Type consistency:**
  - `guitarStemRef.current` shape `{ left, right, sampleRate }` written in Task 4, read in Task 5 ✅
  - `renderAsciiTab(notes)` defined in Task 6, called in Task 5 ✅
  - `NoteEventTime` properties (`pitchMidi`, `startTimeSeconds`, `amplitude`) used consistently ✅
  - Stem names `['guitar', 'bass', 'drums', 'vocals', 'other']` consistent across Task 3, 4 ✅

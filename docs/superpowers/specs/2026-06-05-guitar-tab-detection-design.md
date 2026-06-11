# Guitar Tab Detection — Design

**Date:** 2026-06-05
**Status:** Approved

## Overview

Add guitar-focused stem separation and guitar tab detection to the JAM browser app. Switch from a 4-stem model (vocals/drums/bass/other) to a 6-stem model (drums/bass/other/vocals/guitar/piano) so guitar is a clean, dedicated stem. After separation, the user can trigger Basic Pitch pitch detection on the guitar stem to generate a static ASCII guitar tab.

## Goals

- Guitar, Bass, Drums as primary stems (with cleaner guitar isolation)
- Remove YouTube URL field (unused for separation)
- Static ASCII tab generated from the guitar stem after separation

## Non-Goals

- Lead vs rhythm guitar splitting (no browser-ready model exists)
- Synchronized/scrolling tab (static only)
- Tab export to .gp/.gpx/.musicxml

---

## Changes

### 1. Remove YouTube Field

Remove from `App.jsx`:
- `youtubeUrl` state
- `youtubeEmbedUrl` useMemo
- YouTube URL `<label>` + `<input>`
- YouTube `<iframe>` preview block

No other files affected.

---

### 2. Switch to 6-Stem Model

**New model URL:**
```
https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx
```

**Model specs:**
- Size: 136MB (fp16 weights — smaller than current 181MB 4-stem model)
- Input: `(1, 2, 343980)` float32 stereo @ 44100 Hz — identical to current model
- Output: `(1, 6, 2, 343980)` float32 — 6 stems
- Stem order: `[drums, bass, other, vocals, guitar, piano]` (indices 0–5)

---

### 3. Custom 6-Stem Separator (`separationWorker.js`)

Replace `DemucsProcessor` from `demucs-web` (hardcoded for 4-stem) with a custom `SixStemSeparator` class inside the worker.

**Responsibilities:**
- Load ONNX model via `ort.InferenceSession.create()`
- Download progress via `onDownloadProgress` callback
- `separate(left, right)` method:
  - Chunks audio into `TRAINING_SAMPLES = 343980` segments with 25% overlap
  - Runs each chunk through ONNX (single waveform input, no magSpec)
  - Overlap-add reconstruction for all 6 stems
  - Calls `onProgress` after each chunk
  - Returns `{ drums, bass, other, vocals, guitar, piano }` — each `{ left, right }` Float32Array

**Constants (unchanged from current):**
```js
const TRAINING_SAMPLES = 343980;
const SEGMENT_OVERLAP = 0.25;
```

**ONNX session options:**
```js
{ executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'basic' }
```

**Worker message protocol (unchanged):**
- `downloadProgress` — model fetch progress
- `segmentProgress` — per-chunk inference progress
- `status` — phase label
- `result` — final stems
- `error` — failure

---

### 4. Updated Stems UI (`App.jsx`)

**Primary stems (shown prominently):**
- Guitar
- Bass
- Drums

**Secondary stems (shown but less prominent):**
- Vocals
- Other

**Removed stems from UI:** Piano (not musically relevant to the feature goal)

**Instrument selector** updates from current 4-option list to:
```js
[
  { key: 'original', label: 'Original' },   // replaces 'all'
  { key: 'guitar',   label: 'Guitar' },
  { key: 'bass',     label: 'Bass' },
  { key: 'drums',    label: 'Drums' },
  { key: 'vocals',   label: 'Vocals' },
  { key: 'other',    label: 'Other' },
]
```

---

### 5. Guitar Tab Detection

#### `tabWorker.js` (new file)

**Input:** `{ left: Float32Array, right: Float32Array }` from the guitar stem, plus `sampleRate`.

**Pipeline:**
1. Mix stereo to mono: `mono[i] = (left[i] + right[i]) / 2`
2. Run `@spotify/basic-pitch` — outputs notes with `{ pitchMidi, startTimeSeconds, durationSeconds, amplitude }`
3. Filter notes where `amplitude < 0.5`
4. Return sorted note array

**Install:** `npm install @spotify/basic-pitch`

**Worker message protocol:**
- `tabProgress` — Basic Pitch inference progress
- `tabResult` — filtered notes array
- `error` — failure

#### Tab Rendering (`App.jsx`, inline)

**MIDI → fret mapping (standard tuning E A D G B e):**

| String | Open MIDI | Range |
|--------|-----------|-------|
| E (low) | 40 | 40–64 |
| A | 45 | 45–69 |
| D | 50 | 50–74 |
| G | 55 | 55–79 |
| B | 59 | 59–83 |
| e (high) | 64 | 64–88 |

For each note: find all (string, fret) combinations where `fret = midi - openMidi`, pick the one with lowest fret number (lowest position fingering).

**Time binning:** Group notes into 0.25-second columns. Notes in the same bin that share a string take the highest-fret winner (last wins).

**ASCII output format:**
```
e|---0---3---5---|
B|---1---3---5---|
G|---0---0---5---|
D|---2---0---5---|
A|---3---2---3---|
E|-------3-------|
```

Max 32 columns per line, then wrap to a new set of 6 rows.

#### Tab UI (`App.jsx`)

- "Detect Guitar Tab" button appears after separation completes (guitar stem required)
- Disabled while detection is running
- Progress bar during Basic Pitch inference
- Scrollable `<pre>` block: dark background, green monospace text, max-height with overflow-y scroll
- Copy-to-clipboard button

---

## Data Flow

```
Local audio file
  → separationWorker.js
      - htdemucs_6s_fp16 (webgpu → wasm fallback)
      - overlap-add chunking
  → { guitar, bass, drums, vocals, other } stems
  → Stems UI (instrument selector + audio player)

[User clicks "Detect Guitar Tab"]
  → tabWorker.js
      - Basic Pitch on guitar stem (mono mix)
      - confidence filter ≥ 0.5
  → notes[] { pitchMidi, startTimeSeconds }
  → MIDI-to-fret mapping
  → ASCII tab string
  → <pre> display + copy button
```

---

## Files

| File | Change |
|------|--------|
| `src/App.jsx` | Remove YouTube; update stems list; add tab button, progress, display |
| `src/separationWorker.js` | Replace DemucsProcessor with SixStemSeparator; new model URL |
| `src/tabWorker.js` | New — Basic Pitch detection + note filtering |
| `src/index.css` | Add tab display styles (pre block, copy button) |
| `package.json` | Add `@spotify/basic-pitch` dependency |

---

## Error Handling

- If 6-stem model fails to load: show error, do not fall back silently to 4-stem (user would expect guitar stem)
- If Basic Pitch fails: show error message in tab section, keep audio player functional
- If no notes detected above confidence threshold: show "No guitar detected in this section"
- WebGPU unavailable: ONNX falls back to WASM automatically (existing behavior)

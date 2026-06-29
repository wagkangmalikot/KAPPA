import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import { DemucsProcessor, CONSTANTS, prepareModelInput, standaloneMask, standaloneIspec } from 'demucs-web';

const { TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, TRACKS } = CONSTANTS;

// 0.1 overlap instead of library default 0.25 → ~20% fewer inference calls
const OVERLAP = 0.1;

const numThreads = self.navigator?.hardwareConcurrency ?? 4;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = numThreads;
ort.env.wasm.simd = true;
if (ort.env.webgpu) ort.env.webgpu.powerPreference = 'high-performance';

let session = null;

const loadSession = async () => {
  if (session) return session;

  const proc = new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
      executionMode: 'parallel',
      interOpNumThreads: numThreads,
      intraOpNumThreads: numThreads,
      enableMemPattern: true,
      enableCpuMemArena: true,
    },
    onLog: (phase, msg) => self.postMessage({ type: 'log', message: `[${phase}] ${msg}` }),
    onDownloadProgress: (loaded, total) => {
      if (total > 0) self.postMessage({ type: 'downloadProgress', loaded, total });
    },
  });

  await proc.loadModel(CONSTANTS.DEFAULT_MODEL_URL);
  session = proc.session;
  return session;
};

async function separateFast(leftChannel, rightChannel, sess) {
  const totalSamples = leftChannel.length;
  const stride = Math.floor(TRAINING_SAMPLES * (1 - OVERLAP));
  const numSegments = Math.ceil(Math.max(1, totalSamples - TRAINING_SAMPLES) / stride) + 1;
  const numTracks = TRACKS.length;

  const outputs = Array.from({ length: numTracks }, () => ({
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
  }));
  const weights = new Float32Array(totalSamples);

  // Allocate segment buffers once and reuse across all segments
  const segLeft = new Float32Array(TRAINING_SAMPLES);
  const segRight = new Float32Array(TRAINING_SAMPLES);

  // Pre-build the overlap window for full-length segments (only last may differ)
  const fullWindow = new Float32Array(TRAINING_SAMPLES);
  const halfStride = stride * 0.5;
  for (let i = 0; i < TRAINING_SAMPLES; i++) {
    const fadeIn = Math.min(i / halfStride, 1);
    const fadeOut = Math.min((TRAINING_SAMPLES - i) / halfStride, 1);
    fullWindow[i] = Math.min(fadeIn, fadeOut);
  }

  let segmentIdx = 0;

  for (let start = 0; start < totalSamples; start += stride) {
    const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
    const segmentLength = end - start;

    segLeft.fill(0);
    segRight.fill(0);
    for (let i = 0; i < segmentLength; i++) {
      segLeft[i] = leftChannel[start + i];
      segRight[i] = rightChannel[start + i];
    }

    const input = prepareModelInput(segLeft, segRight);

    const feeds = {};
    feeds[sess.inputNames[0]] = new ort.Tensor('float32', input.waveform, [1, 2, TRAINING_SAMPLES]);
    if (sess.inputNames.length > 1) {
      feeds[sess.inputNames[1]] = new ort.Tensor('float32', input.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);
    }

    const inferResults = await sess.run(feeds);

    let timeData = null, timeShape = null, freqData = null;
    for (const name of sess.outputNames) {
      const tensor = inferResults[name];
      if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
        timeData = tensor.data;
        timeShape = tensor.dims;
      } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
        freqData = tensor.data;
      }
    }

    if (!timeData) throw new Error('Could not find time-domain output tensor');

    const numChannels = timeShape[2];
    const samples = timeShape[3];

    // Combine time-domain + frequency-domain outputs (htdemucs hybrid model)
    let combinedOutputs = null;
    if (freqData) {
      const trackSpecs = standaloneMask(freqData);
      combinedOutputs = [];
      for (let t = 0; t < numTracks; t++) {
        const freqOut = standaloneIspec(trackSpecs[t], TRAINING_SAMPLES);
        const combined = { left: new Float32Array(samples), right: new Float32Array(samples) };
        const base = t * numChannels * samples;
        for (let i = 0; i < samples; i++) {
          combined.left[i]  = timeData[base + i]           + (freqOut.left[i]  || 0);
          combined.right[i] = timeData[base + samples + i] + (freqOut.right[i] || 0);
        }
        combinedOutputs.push(combined);
      }
    }

    // Use pre-built window for full segments, build a short one only for the last segment
    const window = segmentLength === TRAINING_SAMPLES
      ? fullWindow
      : (() => {
          const w = new Float32Array(segmentLength);
          for (let i = 0; i < segmentLength; i++) {
            w[i] = Math.min(Math.min(i / halfStride, 1), Math.min((segmentLength - i) / halfStride, 1));
          }
          return w;
        })();

    for (let t = 0; t < numTracks; t++) {
      const outL = outputs[t].left;
      const outR = outputs[t].right;
      if (combinedOutputs) {
        const cl = combinedOutputs[t].left;
        const cr = combinedOutputs[t].right;
        for (let i = 0; i < segmentLength; i++) {
          const w = window[i];
          outL[start + i] += cl[i] * w;
          outR[start + i] += cr[i] * w;
        }
      } else {
        const base = t * numChannels * samples;
        for (let i = 0; i < segmentLength; i++) {
          const w = window[i];
          outL[start + i] += timeData[base + i]           * w;
          outR[start + i] += timeData[base + samples + i] * w;
        }
      }
    }

    for (let i = 0; i < segmentLength; i++) weights[start + i] += window[i];

    segmentIdx++;
    self.postMessage({
      type: 'segmentProgress',
      progress: segmentIdx / numSegments,
      currentSegment: segmentIdx,
      totalSegments: numSegments,
    });
  }

  // Normalize by accumulated overlap weights
  for (let t = 0; t < numTracks; t++) {
    const outL = outputs[t].left;
    const outR = outputs[t].right;
    for (let i = 0; i < totalSamples; i++) {
      if (weights[i] > 0) {
        outL[i] /= weights[i];
        outR[i] /= weights[i];
      }
    }
  }

  return outputs;
}

self.onmessage = async (event) => {
  const { type, data } = event.data;
  try {
    if (type === 'separate') {
      const { left, right } = data;

      self.postMessage({ type: 'status', message: 'Initializing...' });
      const sess = await loadSession();

      self.postMessage({ type: 'status', message: 'Running separation...' });
      const [drums, bass, other, vocals] = await separateFast(left, right, sess);

      // Transfer buffers zero-copy — avoids cloning ~120 MB of audio data
      self.postMessage(
        {
          type: 'result',
          result: {
            drums:  { left: drums.left,  right: drums.right  },
            bass:   { left: bass.left,   right: bass.right   },
            vocals: { left: vocals.left, right: vocals.right },
            guitar: { left: other.left,  right: other.right  },
          },
        },
        [drums.left.buffer, drums.right.buffer, bass.left.buffer, bass.right.buffer,
         other.left.buffer, other.right.buffer, vocals.left.buffer, vocals.right.buffer],
      );
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
};

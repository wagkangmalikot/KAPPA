import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = self.navigator?.hardwareConcurrency ?? 4;

let processor = null;

const initProcessor = async () => {
  if (!processor) {
    processor = new DemucsProcessor({
      ort,
      sessionOptions: {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'basic',
      },
      onProgress: ({ progress, currentSegment, totalSegments }) => {
        self.postMessage({ type: 'segmentProgress', progress, currentSegment, totalSegments });
      },
      onLog: (phase, msg) => {
        self.postMessage({ type: 'log', message: `[${phase}] ${msg}` });
      },
      onDownloadProgress: (loaded, total) => {
        if (total > 0) self.postMessage({ type: 'downloadProgress', loaded, total });
      },
    });
    await processor.loadModel(CONSTANTS.DEFAULT_MODEL_URL);
  }
  return processor;
};

self.onmessage = async (event) => {
  const { type, data } = event.data;
  try {
    if (type === 'separate') {
      const { left, right } = data;

      self.postMessage({ type: 'status', message: 'Initializing processor...' });
      const proc = await initProcessor();

      self.postMessage({ type: 'status', message: 'Running separation...' });
      const result = await proc.separate(new Float32Array(left), new Float32Array(right));

      // 4-stem model output: vocals, drums, bass, other
      // Expose 'other' as 'guitar' since guitar content lives there
      self.postMessage({
        type: 'result',
        result: {
          drums:  { left: result.drums.left.slice(),  right: result.drums.right.slice() },
          bass:   { left: result.bass.left.slice(),   right: result.bass.right.slice() },
          vocals: { left: result.vocals.left.slice(), right: result.vocals.right.slice() },
          guitar: { left: result.other.left.slice(),  right: result.other.right.slice() },
        },
      });
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
};

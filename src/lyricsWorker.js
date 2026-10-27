// Whisper-based lyrics detection. @huggingface/transformers is a dynamic import
// so the worker starts even if the package isn't installed yet.
let transcriber = null;

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;

  let mod;
  try {
    mod = await import('@huggingface/transformers');
  } catch {
    self.postMessage({
      type: 'error',
      message: 'Whisper not installed. Run: npm install @huggingface/transformers',
    });
    return;
  }

  try {
    if (!transcriber) {
      self.postMessage({ type: 'status', msg: 'Loading model…' });
      transcriber = await mod.pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny.en',
        {
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
          device: 'wasm',
          progress_callback: (p) => self.postMessage({ type: 'dl', p }),
        }
      );
    }

    self.postMessage({ type: 'status', msg: 'Transcribing…' });

    const out = await transcriber(data.audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const words = (out.chunks ?? [])
      .map((c) => ({
        word: c.text.trim(),
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3,
      }))
      .filter((w) => w.word.replace(/[\s.,!?;:'"()\-]/g, '').length > 0);

    self.postMessage({ type: 'result', words });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};

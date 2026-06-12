import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // manifest is handled manually via public/manifest.webmanifest
      manifest: false,
      workbox: {
        // Skip large model/WASM files — too big to cache and change rarely
        globIgnores: [
          '**/basic-pitch-model/**',
          '**/*.wasm',
          '**/*.bin',
          '**/*.pack',
        ],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});

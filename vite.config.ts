import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'decode-named-character-reference': path.resolve(
        __dirname,
        'node_modules/decode-named-character-reference/index.js',
      ),
    },
  },
  worker: {
    format: 'es',
  },
});

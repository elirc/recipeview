import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { '@shared': path.resolve(__dirname, 'shared') },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': 'http://localhost:5274',
      '/photos': 'http://localhost:5274',
    },
  },
  build: { outDir: 'dist/web', emptyOutDir: true },
});

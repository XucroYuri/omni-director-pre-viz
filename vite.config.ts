import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      root: path.join(__dirname, 'src/renderer'),
      base: './',
      build: {
        outDir: path.join(__dirname, 'dist/renderer'),
        emptyOutDir: true,
      },
      server: {
        port: 3000,
        host: '127.0.0.1',
        strictPort: true,
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src/renderer'),
          '@shared': path.resolve(__dirname, 'src/shared'),
        }
      }
    };
});

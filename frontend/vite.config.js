import { defineConfig } from 'vite';

export default defineConfig({
  base: '/GIE/',
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

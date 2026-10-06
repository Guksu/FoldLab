import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.FOLDLAB_PORT ?? 4280);
const target = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5280,
    proxy: {
      '/api': target,
      '/demo': target,
      '/measure': target,
      '/ws': { target, ws: true },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});

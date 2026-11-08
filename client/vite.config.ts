import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('..', import.meta.url));

// BASE_PATH is set by the GitHub Pages workflow to `/<repo>/`; locally the site is served from `/`.
export default defineConfig({
  root,
  base: process.env.BASE_PATH || '/',
  envDir: project,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { port: Number(process.env.CLIENT_PORT) || 5173 },
});

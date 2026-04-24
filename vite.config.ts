import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

// Separate build per entry so every shared module is inlined.
// Content scripts in MV3 can't import external ESM chunks at runtime,
// and the popup/service-worker don't share enough code to justify chunking.
const entry = process.env.VITE_ENTRY ?? 'popup';

const entries = {
  popup: {
    input: { popup: resolve(__dirname, 'src/popup/index.html') },
    emptyOutDir: true,
    plugins: [tailwindcss(), viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'public/icons/*.png', dest: 'icons' },
      ],
    }), removeCrossorigin()] as Plugin[],
  },
  'service-worker': {
    input: { 'service-worker': resolve(__dirname, 'src/background/service-worker.ts') },
    emptyOutDir: false,
    plugins: [] as Plugin[],
  },
  content: {
    input: { content: resolve(__dirname, 'src/content/tracker.ts') },
    emptyOutDir: false,
    plugins: [] as Plugin[],
  },
  'content-statscc': {
    input: { 'content-statscc': resolve(__dirname, 'src/content/statscc.ts') },
    emptyOutDir: false,
    plugins: [] as Plugin[],
  },
} as const;

const config = entries[entry as keyof typeof entries];
if (!config) throw new Error(`Unknown VITE_ENTRY: ${entry}`);

export default defineConfig({
  plugins: config.plugins,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: config.emptyOutDir,
    rollupOptions: {
      input: config.input,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // Content scripts in MV3 can't load external ESM chunks.
        // One entry per config => inline all shared modules.
        inlineDynamicImports: true,
      },
    },
  },
});

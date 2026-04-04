import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

import manifest from './manifest.config';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? 'asset';
          if (name.endsWith('.css')) {
            return 'assets/[name][extname]';
          }
          if (/\.(png|svg|jpg|jpeg|gif|webp)$/i.test(name)) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [react(), tailwindcss(), crx({ manifest })],
});

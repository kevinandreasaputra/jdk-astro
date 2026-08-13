// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    envPrefix: ['VITE_', 'PUBLIC_'],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/p5')) {
              return 'p5-chunk';
            }
            if (id.includes('node_modules/@splidejs')) {
              return 'splide-chunk';
            }
            if (id.includes('node_modules/animejs')) {
              return 'animejs-chunk';
            }
            if (id.includes('node_modules/@supabase')) {
              return 'supabase-chunk';
            }
          }
        }
      }
    }
  }
});
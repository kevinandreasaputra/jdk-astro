// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [
      tailwindcss(),
      {
        name: 'serve-public-index',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url) {
              const urlPath = req.url.split('?')[0];
              if (urlPath.endsWith('/') || !path.extname(urlPath)) {
                const normalizedPath = urlPath.endsWith('/') ? urlPath : urlPath + '/';
                const fileToCheck = path.join('public', normalizedPath, 'index.html');
                if (fs.existsSync(fileToCheck)) {
                  req.url = normalizedPath + 'index.html' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
                }
              }
            }
            next();
          });
        }
      }
    ],
    envPrefix: ['VITE_', 'PUBLIC_'],
    build: {
      modulePreload: {
        resolveDependencies() {
          return [];
        }
      },
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
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/authserver': 'http://localhost:8787',
      '/sessionserver': 'http://localhost:8787',
      '/textures': 'http://localhost:8787',
    },
  },
});

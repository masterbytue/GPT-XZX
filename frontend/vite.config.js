import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev server proxies /api to the backend so there are no CORS issues
// and the frontend never needs to know the backend's absolute URL.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});

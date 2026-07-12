import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El frontend nunca conoce la SIMPLE_API_KEY: todo pasa por el backend vía /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

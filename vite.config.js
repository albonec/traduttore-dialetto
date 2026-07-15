import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In sviluppo il backend FastAPI gira a parte: `yarn api` (porta 8000).
    // In produzione (Vercel) /api è la funzione serverless Python.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});

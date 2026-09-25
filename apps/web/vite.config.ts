import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  envDir: '../..',
  plugins: [
    react(),
    {
      name: 'privy-csp-mode',
      transformIndexHtml(html) {
        // Vite injects CSS through a style element while serving locally.
        // Production emits a stylesheet and keeps the stricter policy.
        return html.replace('__VITE_DEV_STYLE__', command === 'serve' ? "'unsafe-inline'" : '').replace('__VITE_DEV_CONNECT__', command === 'serve' ? 'http://localhost:3000 ws://localhost:3000' : '');
      },
    },
  ],
}));

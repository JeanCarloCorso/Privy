import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'privy-csp-mode',
      transformIndexHtml(html) {
        // Vite injects CSS through a style element while serving locally.
        // Production emits a stylesheet and keeps the stricter policy.
        return html.replace('__VITE_DEV_STYLE__', command === 'serve' ? "'unsafe-inline'" : '');
      },
    },
  ],
}));

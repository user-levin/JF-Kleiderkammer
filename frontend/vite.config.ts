import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certDir = path.resolve(__dirname, 'certs');
const httpsConfig = {
  key: fs.readFileSync(path.join(certDir, 'dev-key.pem')),
  cert: fs.readFileSync(path.join(certDir, 'dev-cert.pem'))
};

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src/api'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@constants': path.resolve(__dirname, 'src/constants')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    https: httpsConfig,
    proxy: {
      '/api': {
        target: 'https://localhost',
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: 'https://localhost',
        changeOrigin: true,
        secure: false
      }
    }
  },
  envPrefix: ['VITE_', 'APP_']
});

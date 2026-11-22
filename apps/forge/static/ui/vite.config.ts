import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Forge Custom UI serves static files from build/ with relative paths.
export default defineConfig({ plugins: [react()], base: './', build: { outDir: 'build', emptyOutDir: true, chunkSizeWarningLimit: 2000 } });

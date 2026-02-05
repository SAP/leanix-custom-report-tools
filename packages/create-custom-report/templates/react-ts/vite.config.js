import leanix from '@sap/vite-plugin-leanix-custom-report';
import react from '@vitejs/plugin-react';
// @ts-check
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), leanix()]
});
